import { describe, expect, it } from 'vitest';
import type { Manifest } from '@open-test-pilot/manifest-schema';
import { runLocal } from './index.js';

const manifest: Manifest = {
  schemaVersion: '1.0.0',
  id: 'missing-target',
  name: 'Missing target',
  description: 'Failure fixture',
  type: 'e2e',
  tags: ['smoke'],
  priority: 'high',
  preconditions: [],
  variables: [],
  secrets: [],
  setup: [],
  steps: [{ id: 'open', actions: [{ id: 'goto', type: 'web.goto', url: 'http://127.0.0.1:4173/' }] }],
  cleanup: [],
  artifacts: { screenshots: 'failure-only' },
  runner: { minBrowsers: ['chromium'] },
  permissions: { networkAccess: true },
  source: { repository: 'local', path: 'tests/missing.yaml' },
  generatedCode: { path: 'generated/missing-target.spec.ts' },
};

describe('runLocal', () => {
  it('writes report JSON and generated code into an isolated run directory', async () => {
    const result = await runLocal(manifest, { rootDir: '.testpilot/test-runner' });
    expect(result.runId).toMatch(/^run-/);
    expect(result.reportPath).toMatch(/report\.json$/);
    expect(result.htmlReportPath).toMatch(/index\.html$/);
    expect(result.generatedCodePath).toMatch(/missing-target\.spec\.ts$/);
  }, 30_000);
});
