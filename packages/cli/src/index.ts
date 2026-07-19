#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { generateMobileAppium, generatePlaywright } from '@open-test-pilot/generator';
import { importOpenApi, importPostmanCollection, type ApiImportOptions } from '@open-test-pilot/api-importer';
import { runLocal } from '@open-test-pilot/local-runner';
import type { CustomActionExecutor } from '@open-test-pilot/playwright-adapter';
import { diffManifests, migrateManifest, previewMigration } from '@open-test-pilot/manifest-migrator';
import { parseManifest } from '@open-test-pilot/manifest-parser';
import { renderReport } from '@open-test-pilot/report';
import type { TestRunResult } from '@open-test-pilot/result-schema';
import { generateManifestFromSource, type ManifestGenerationOptions } from '@open-test-pilot/source-analyzer';

interface ExportFile { name: string; content: string; }

const CLI_VERSION = '0.1.0';
const HELP = `Usage: testpilot <command>

Commands:
  testpilot manifest validate <file>               Validate a test Manifest
  testpilot manifest generate <file>               Generate an executable test
  testpilot manifest migrate <file> [--approve]    Preview or apply a Manifest migration
  testpilot manifest diff <before> <after>         Compare two Manifests
  testpilot manifest export <file> --output <path> Export a standalone project
  testpilot source analyze <source> [options]      Analyze source into a Manifest
  testpilot import openapi <file> [options]        Import OpenAPI 3.0/3.1 into a Manifest
  testpilot import postman <file> [options]        Import Postman Collection v2.1 into a Manifest
  testpilot run <file> [--actions <module>]        Execute a Manifest locally
  testpilot report <report.json>                   Render an HTML report

Global options:
  --help, -h                                       Show this help
  --version, -v                                    Show the CLI version`;

const RUN_HELP = `Usage: testpilot run <manifest> [--actions <module>]

Executes a validated Manifest with the local runner and writes a report.`;

function writeHelp(args: string[], output: string[]): number | undefined {
  const first = args[0];
  if (first === '--version' || first === '-v') {
    output.push(`testpilot v${CLI_VERSION}`);
    return 0;
  }
  if (first === '--help' || first === '-h') {
    output.push(HELP);
    return 0;
  }
  if (first === 'run' && (args[1] === '--help' || args[1] === '-h')) {
    output.push(RUN_HELP);
    return 0;
  }
  if (first === 'manifest' && (args[1] === '--help' || args[1] === '-h')) {
    output.push(`${HELP}\n\nManifest commands accept --help for this overview.`);
    return 0;
  }
  if (first === 'source' && (args[1] === '--help' || args[1] === '-h')) {
    output.push(`${HELP}\n\nSource analysis options: --platform, --framework, --output, --repository, --base-url, --id, --name, --generated-code`);
    return 0;
  }
  return undefined;
}

function crc32(value: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZip(files: ExportFile[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name.replaceAll('\\', '/'), 'utf8');
    const content = Buffer.from(file.content, 'utf8');
    const header = Buffer.alloc(30 + name.length);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(crc32(content), 14);
    header.writeUInt32LE(content.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(name.length, 26);
    name.copy(header, 30);
    localParts.push(header, content);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc32(content), 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += header.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function exportManifestProject(input: string, outputPath: string): Promise<void> {
  const source = await readFile(input, 'utf8');
  const parsed = parseManifest(source, input);
  if (parsed.diagnostics.length > 0) throw new Error(parsed.diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.path} ${diagnostic.message}`).join('\n'));
  const isMobile = [...parsed.manifest.setup, ...parsed.manifest.steps, ...parsed.manifest.cleanup].some((step) => step.actions.some((action) => action.type.startsWith('mobile.')));
  const generated = isMobile ? generateMobileAppium(parsed.manifest) : generatePlaywright(parsed.manifest);
  const generatedName = basename(parsed.manifest.generatedCode.path);
  const packageJson = {
    name: `${parsed.manifest.id}-generated`,
    private: true,
    type: 'module',
    scripts: { test: isMobile ? 'tsx test.spec.ts' : 'playwright test test.spec.ts' },
    devDependencies: isMobile ? { tsx: '^4.23.1', webdriverio: '^9.20.0' } : { '@playwright/test': '^1.55.0' },
  };
  const files: ExportFile[] = [
    { name: 'manifest.yaml', content: source },
    { name: `generated/${generatedName}`, content: generated.code },
    { name: `generated/${generatedName}.map.json`, content: JSON.stringify(generated.sourceMap, null, 2) },
    { name: 'package.json', content: `${JSON.stringify(packageJson, null, 2)}\n` },
    { name: 'README.md', content: `# ${parsed.manifest.name}\n\nGenerated by OpenTestPilot.\n\nInstall dependencies with pnpm install and run pnpm test.\n` },
  ];
  if (outputPath.toLowerCase().endsWith('.zip')) {
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, buildStoredZip(files));
    return;
  }
  await mkdir(outputPath, { recursive: true });
  for (const file of files) {
    const destination = join(outputPath, file.name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, 'utf8');
  }
}

export async function runCli(args: string[], output: string[] = []): Promise<number> {
  const helpResult = writeHelp(args, output);
  if (helpResult !== undefined) return helpResult;
  const [group, command, input, ...rest] = args;
  if (group === 'manifest' && (command === 'validate' || command === 'generate') && input !== undefined) {
    const source = await readFile(input, 'utf8');
    const parsed = parseManifest(source, input);
    if (parsed.diagnostics.length > 0) {
      parsed.diagnostics.forEach((diagnostic) => output.push(`${diagnostic.severity}: ${diagnostic.code} ${diagnostic.path} ${diagnostic.message}`));
      return 1;
    }
    if (command === 'validate') {
      output.push(`valid: ${input}`);
      return 0;
    }
    const isMobile = [...parsed.manifest.setup, ...parsed.manifest.steps, ...parsed.manifest.cleanup].some((step) => step.actions.some((action) => action.type.startsWith('mobile.')));
    const generated = isMobile ? generateMobileAppium(parsed.manifest) : generatePlaywright(parsed.manifest);
    const generatedPath = isAbsolute(parsed.manifest.generatedCode.path)
      ? parsed.manifest.generatedCode.path
      : resolve(dirname(input), parsed.manifest.generatedCode.path);
    await mkdir(dirname(generatedPath), { recursive: true });
    await writeFile(generatedPath, generated.code, 'utf8');
    await writeFile(`${generatedPath}.map.json`, JSON.stringify(generated.sourceMap, null, 2), 'utf8');
    output.push(`generated: ${generatedPath}`);
    return 0;
  }

  if (group === 'manifest' && command === 'migrate' && input !== undefined) {
    const source = await readFile(input, 'utf8');
    const preview = previewMigration(parseYaml(source));
    if (!rest.includes('--approve')) {
      output.push('migration preview (no files changed):');
      output.push(preview.yamlDiff);
      output.push('pass --approve to write the migrated Manifest');
      return 0;
    }
    await writeFile(input, stringifyYaml(migrateManifest(parseYaml(source), { approve: true })), 'utf8');
    output.push(`migrated: ${input}`);
    output.push('generated-code diff:');
    output.push(preview.generatedCodeDiff);
    return 0;
  }

  if (group === 'manifest' && command === 'diff' && input !== undefined && rest[0] !== undefined) {
    const before = parseYaml(await readFile(input, 'utf8')) as unknown;
    const after = parseYaml(await readFile(rest[0], 'utf8')) as unknown;
    output.push(diffManifests(before, after));
    return 0;
  }

  if (group === 'manifest' && command === 'export' && input !== undefined) {
    const outputFlag = rest.indexOf('--output');
    const destination = outputFlag >= 0 ? rest[outputFlag + 1] : undefined;
    if (destination === undefined || destination.startsWith('--')) {
      output.push('manifest export requires --output <directory|file.zip>');
      return 2;
    }
    await exportManifestProject(input, resolve(destination));
    output.push(`exported: ${resolve(destination)}`);
    return 0;
  }

  if (group === 'source' && command === 'analyze' && input !== undefined) {
    const source = await readFile(input, 'utf8');
    const flags = new Map<string, string>();
    for (let index = 0; index < rest.length; index += 1) {
      const flag = rest[index];
      const value = rest[index + 1];
      if (flag?.startsWith('--') && value !== undefined && !value.startsWith('--')) flags.set(flag.slice(2), value);
    }
    const platform = (flags.get('platform') ?? 'web') as 'web' | 'api' | 'android' | 'flutter' | 'ios';
    const framework = flags.get('framework') as 'javascript' | 'nextjs' | 'react-router' | 'vue' | 'angular' | 'remix' | 'nuxt' | 'openapi' | 'swagger' | 'postman' | 'graphql' | 'android' | 'flutter' | 'ios' | undefined;
    const generationOptions: ManifestGenerationOptions = {};
    const repository = flags.get('repository');
    const baseUrl = flags.get('base-url');
    const id = flags.get('id');
    const name = flags.get('name');
    const generatedCodePath = flags.get('generated-code');
    if (repository !== undefined) generationOptions.repository = repository;
    if (baseUrl !== undefined) generationOptions.baseUrl = baseUrl;
    if (id !== undefined) generationOptions.id = id;
    if (name !== undefined) generationOptions.name = name;
    if (generatedCodePath !== undefined) generationOptions.generatedCodePath = generatedCodePath;
    const generated = generateManifestFromSource({ path: input, content: source, platform, ...(framework === undefined ? {} : { framework }) }, generationOptions);
    const destination = flags.get('output') ?? `${input}.manifest.yaml`;
    await mkdir(dirname(resolve(destination)), { recursive: true });
    await writeFile(destination, stringifyYaml(generated.manifest), 'utf8');
    output.push(`analyzed: ${input}`);
    output.push(`findings: ${generated.findings.length}`);
    output.push(`manifest: ${destination}`);
    return 0;
  }

  if (group === 'import' && (command === 'openapi' || command === 'postman') && input !== undefined) {
    const source = await readFile(input, 'utf8');
    const flags = new Map<string, string>();
    for (let index = 0; index < rest.length; index += 1) {
      const flag = rest[index];
      const value = rest[index + 1];
      if (flag?.startsWith('--') && value !== undefined && !value.startsWith('--')) flags.set(flag.slice(2), value);
    }
    const importOptions: ApiImportOptions = {};
    const baseUrl = flags.get('base-url');
    const id = flags.get('id');
    const name = flags.get('name');
    const repository = flags.get('repository');
    const generatedCodePath = flags.get('generated-code');
    if (baseUrl !== undefined) importOptions.baseUrl = baseUrl;
    if (id !== undefined) importOptions.id = id;
    if (name !== undefined) importOptions.name = name;
    if (repository !== undefined) importOptions.repository = repository;
    if (generatedCodePath !== undefined) importOptions.generatedCodePath = generatedCodePath;
    const imported = command === 'openapi' ? importOpenApi(source, importOptions) : importPostmanCollection(source, importOptions);
    const destination = flags.get('output') ?? `${input}.manifest.yaml`;
    await mkdir(dirname(resolve(destination)), { recursive: true });
    await writeFile(destination, stringifyYaml(imported.manifest), 'utf8');
    output.push(`imported: ${input}`);
    output.push(`operations: ${imported.operations.length}`);
    output.push(`manifest: ${destination}`);
    return 0;
  }

  if (group === 'run' && command !== undefined) {
    const source = await readFile(command, 'utf8');
    const parsed = parseManifest(source, command);
    if (parsed.diagnostics.length > 0) {
      parsed.diagnostics.forEach((diagnostic) => output.push(`${diagnostic.severity}: ${diagnostic.code} ${diagnostic.path} ${diagnostic.message}`));
      return 1;
    }
    const runArgs = input === undefined ? rest : [input, ...rest];
    const actionFlag = runArgs.indexOf('--actions');
    let customActions: Record<string, CustomActionExecutor> | undefined;
    const actionPath = actionFlag >= 0 ? runArgs[actionFlag + 1] : undefined;
    if (actionPath !== undefined) {
      const loaded = await import(resolve(actionPath));
      const loadedActions: unknown = loaded.customActions ?? loaded.default;
      customActions = loadedActions as Record<string, CustomActionExecutor>;
    }
    const result = await runLocal(parsed.manifest, {
      ...(customActions === undefined ? {} : { customActions }),
      ...(actionPath === undefined ? {} : { customActionModule: resolve(actionPath) }),
    });
    output.push(`run: ${result.runId}`);
    output.push(`report: ${result.htmlReportPath}`);
    return result.status === 'passed' ? 0 : 1;
  }

  if (group === 'report' && command !== undefined) {
    const source = await readFile(command, 'utf8');
    const result = JSON.parse(source) as TestRunResult;
    const htmlPath = join(dirname(command), 'index.html');
    await writeFile(htmlPath, renderReport(result), 'utf8');
    output.push(`report: ${htmlPath}`);
    return 0;
  }

  output.push(HELP);
  return 2;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output: string[] = [];
  const exitCode = await runCli(process.argv.slice(2), output);
  output.forEach((line) => console.log(line));
  process.exitCode = exitCode;
}
