import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from './index.js';

const manifest = `
schemaVersion: "1.0.0"
id: cli-test
name: CLI test
description: CLI test
type: e2e
tags: [smoke]
priority: high
preconditions: []
variables: []
secrets: []
setup: []
steps: []
cleanup: []
artifacts:
  screenshots: after
runner:
  minBrowsers: [chromium]
permissions:
  networkAccess: true
source:
  repository: local
  path: tests/cli.yaml
generatedCode:
  path: generated/cli-test.spec.ts
`;

describe('testpilot CLI', () => {
  it('imports OpenAPI and writes a schema-valid Manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'testpilot-import-'));
    const input = join(directory, 'openapi.yaml');
    const output = join(directory, 'imported.yaml');
    await writeFile(input, 'openapi: "3.0.0"\ninfo:\n  title: Demo\npaths:\n  /health:\n    get:\n      responses:\n        "200": {}\n', 'utf8');
    const messages: string[] = [];
    expect(await runCli(['import', 'openapi', input, '--output', output], messages)).toBe(0);
    expect(messages).toEqual([`imported: ${input}`, 'operations: 1', `manifest: ${output}`]);
    expect((await import('@open-test-pilot/manifest-parser')).parseManifest(await readFile(output, 'utf8'), output).diagnostics).toEqual([]);
  });

  it('provides actionable help and version output without treating flags as files', async () => {
    const help: string[] = [];
    expect(await runCli(['--help'], help)).toBe(0);
    expect(help.join('\n')).toContain('testpilot manifest validate');
    expect(help.join('\n')).toContain('testpilot source analyze');

    const commandHelp: string[] = [];
    expect(await runCli(['run', '--help'], commandHelp)).toBe(0);
    expect(commandHelp.join('\n')).toContain('testpilot run <manifest>');

    const version: string[] = [];
    expect(await runCli(['--version'], version)).toBe(0);
    expect(version.join('\n')).toMatch(/^testpilot v\d+\.\d+\.\d+$/);
  });

  it('validates and generates a manifest using the documented commands', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'testpilot-cli-'));
    const manifestPath = join(directory, 'test.yaml');
    await writeFile(manifestPath, manifest, 'utf8');
    const output: string[] = [];
    expect(await runCli(['manifest', 'validate', manifestPath], output)).toBe(0);
    expect(await runCli(['manifest', 'generate', manifestPath], output)).toBe(0);
    expect(await readFile(join(directory, 'generated/cli-test.spec.ts'), 'utf8')).toContain("import { test, expect }");
    expect(output.join('\n')).toContain('valid');
  });

  it('generates WebdriverIO code for a mobile manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'testpilot-cli-mobile-'));
    const manifestPath = join(directory, 'mobile.yaml');
    await writeFile(manifestPath, manifest.replace('id: cli-test', 'id: cli-mobile').replace('name: CLI test', 'name: CLI mobile').replace('type: e2e', 'type: mobile').replace('minBrowsers: [chromium]', 'minBrowsers: []').replace('steps: []', `steps:
  - id: settings
    actions:
      - id: launch
        type: mobile.launch
        capabilities:
          platform: android
          deviceName: emulator-5554
      - id: shot
        type: mobile.screenshot
        name: settings`).replace('generated/cli-test.spec.ts', 'generated/cli-mobile.spec.ts'), 'utf8');
    expect(await runCli(['manifest', 'generate', manifestPath], [])).toBe(0);
    expect(await readFile(join(directory, 'generated/cli-mobile.spec.ts'), 'utf8')).toContain("import { remote } from 'webdriverio';");
  });

  it('returns a non-zero exit code for invalid manifests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'testpilot-cli-invalid-'));
    const manifestPath = join(directory, 'invalid.yaml');
    await mkdir(directory, { recursive: true });
    await writeFile(manifestPath, 'id: missing-required-fields\n', 'utf8');
    expect(await runCli(['manifest', 'validate', manifestPath], [])).toBe(1);
  });

  it('previews and explicitly applies manifest migration and produces diffs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'testpilot-cli-migrate-'));
    const legacyPath = join(directory, 'legacy.yaml');
    const currentPath = join(directory, 'current.yaml');
    await writeFile(legacyPath, 'schemaVersion: "0.9.0"\ntestId: legacy\ntitle: Legacy\ntype: web\nsteps: []\n', 'utf8');
    await writeFile(currentPath, 'schemaVersion: "1.0.0"\nid: legacy\nname: Current\n', 'utf8');
    const previewOutput: string[] = [];
    expect(await runCli(['manifest', 'migrate', legacyPath], previewOutput)).toBe(0);
    expect(previewOutput.join('\n')).toContain('migration preview');
    expect((await readFile(legacyPath, 'utf8')).includes('0.9.0')).toBe(true);
    expect(await runCli(['manifest', 'migrate', legacyPath, '--approve'], [])).toBe(0);
    expect((await readFile(legacyPath, 'utf8')).includes('schemaVersion: 1.0.0')).toBe(true);
    const diffOutput: string[] = [];
    expect(await runCli(['manifest', 'diff', legacyPath, currentPath], diffOutput)).toBe(0);
    expect(diffOutput.join('\n')).toContain('-name: Legacy');
  });

  it('loads custom actions from the documented run flag', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'testpilot-cli-actions-'));
    const manifestPath = join(directory, 'custom.yaml');
    const actionPath = join(directory, 'actions.mjs');
    await writeFile(actionPath, "export default { 'test.action': { async execute() { return { ok: true }; } } };\n", 'utf8');
    await writeFile(manifestPath, manifest.replace('id: cli-test', 'id: cli-custom').replace('path: tests/cli.yaml', 'path: tests/cli-custom.yaml').replace('steps: []', 'steps:\n  - id: custom\n    actions:\n      - id: action\n        type: custom.action\n        actionType: test.action\n'), 'utf8');
    const output: string[] = [];
    expect(await runCli(['run', manifestPath, '--actions', actionPath], output)).toBe(0);
    expect(output.join('\n')).toContain('run:');
  });

  it('exports an independent generated project as a ZIP', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'testpilot-cli-export-'));
    const manifestPath = join(directory, 'test.yaml');
    const zipPath = join(directory, 'export.zip');
    await writeFile(manifestPath, manifest, 'utf8');
    const output: string[] = [];
    expect(await runCli(['manifest', 'export', manifestPath, '--output', zipPath], output)).toBe(0);
    const zip = await readFile(zipPath);
    expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(zip.toString('utf8')).toContain('manifest.yaml');
    expect(zip.toString('utf8')).toContain('package.json');
    expect(output.join('\n')).toContain(`exported: ${zipPath}`);
  });
});
