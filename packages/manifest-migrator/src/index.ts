import { generatePlaywright } from '@open-test-pilot/generator';
import { DefaultManifestSchemaVersion, type Manifest } from '@open-test-pilot/manifest-schema';
import { stringify } from 'yaml';

export interface MigrationOptions { approve: boolean; targetVersion?: string; }
export interface MigrationPreview { changed: boolean; fromVersion: string | undefined; toVersion: string; manifest: Manifest; yamlDiff: string; generatedCodeDiff: string; }

function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown, fallback: string): string { return typeof value === 'string' && value.length > 0 ? value : fallback; }

export function normalizeManifest(input: unknown, targetVersion: string = DefaultManifestSchemaVersion): Manifest {
  const source = record(input);
  const id = stringValue(source['id'], stringValue(source['testId'], stringValue(source['name'], stringValue(source['title'], 'migrated-test')).toLowerCase().replace(/[^a-z0-9]+/g, '-')));
  const steps = Array.isArray(source['steps']) ? source['steps'] : [];
  return {
    schemaVersion: targetVersion,
    id,
    name: stringValue(source['name'], stringValue(source['title'], id)),
    description: stringValue(source['description'], ''),
    type: stringValue(source['type'], 'e2e'),
    tags: Array.isArray(source['tags']) ? source['tags'].filter((tag): tag is string => typeof tag === 'string') : [],
    priority: stringValue(source['priority'], 'normal'),
    preconditions: Array.isArray(source['preconditions']) ? source['preconditions'].filter((item): item is string => typeof item === 'string') : [],
    variables: Array.isArray(source['variables']) ? source['variables'] as Manifest['variables'] : [],
    secrets: Array.isArray(source['secrets']) ? source['secrets'] as Manifest['secrets'] : [],
    setup: Array.isArray(source['setup']) ? source['setup'] as Manifest['setup'] : [],
    steps: steps as Manifest['steps'],
    cleanup: Array.isArray(source['cleanup']) ? source['cleanup'] as Manifest['cleanup'] : [],
    ...(Array.isArray(source['functions']) ? { functions: source['functions'] as NonNullable<Manifest['functions']> } : {}),
    artifacts: { screenshots: 'after', ...record(source['artifacts']) } as Manifest['artifacts'],
    runner: { minBrowsers: ['chromium'], ...record(source['runner']) } as Manifest['runner'],
    permissions: { networkAccess: true, ...record(source['permissions']) } as Manifest['permissions'],
    source: { repository: 'migrated', path: 'manifest.yaml', ...record(source['source']) } as Manifest['source'],
    generatedCode: { path: `generated/${id}.spec.ts`, ...record(source['generatedCode']) } as Manifest['generatedCode'],
  };
}

function lineDiff(before: string, after: string): string {
  const oldLines = before.trimEnd().split('\n');
  const newLines = after.trimEnd().split('\n');
  const output: string[] = [];
  const length = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < length; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine && oldLine !== undefined) output.push(` ${oldLine}`);
    else {
      if (oldLine !== undefined) output.push(`-${oldLine}`);
      if (newLine !== undefined) output.push(`+${newLine}`);
    }
  }
  return output.join('\n');
}

export function diffManifests(before: unknown, after: unknown): string { return lineDiff(stringify(before), stringify(after)); }

export function previewMigration(input: unknown, targetVersion: string = DefaultManifestSchemaVersion): MigrationPreview {
  const source = record(input);
  const manifest = normalizeManifest(input, targetVersion);
  const beforeCode = source['id'] === undefined ? '' : generatePlaywright(normalizeManifest(input, stringValue(source['schemaVersion'], targetVersion))).code;
  const afterCode = generatePlaywright(manifest).code;
  return {
    changed: stringify(input) !== stringify(manifest),
    fromVersion: typeof source['schemaVersion'] === 'string' ? source['schemaVersion'] : undefined,
    toVersion: targetVersion,
    manifest,
    yamlDiff: diffManifests(input, manifest),
    generatedCodeDiff: lineDiff(beforeCode, afterCode),
  };
}

export function migrateManifest(input: unknown, options: MigrationOptions): Manifest {
  if (!options.approve) throw new Error('Manifest migration requires explicit approval');
  return normalizeManifest(input, options.targetVersion ?? DefaultManifestSchemaVersion);
}
