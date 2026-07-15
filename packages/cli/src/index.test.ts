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

  it('returns a non-zero exit code for invalid manifests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'testpilot-cli-invalid-'));
    const manifestPath = join(directory, 'invalid.yaml');
    await mkdir(directory, { recursive: true });
    await writeFile(manifestPath, 'id: missing-required-fields\n', 'utf8');
    expect(await runCli(['manifest', 'validate', manifestPath], [])).toBe(1);
  });
});
