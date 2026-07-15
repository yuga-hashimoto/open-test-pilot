import { describe, expect, it } from 'vitest';
import type { Manifest } from '@open-test-pilot/manifest-schema';
import { executeManifest } from './index.js';

const manifest: Manifest = {
  schemaVersion: '1.0.0',
  id: 'local-check',
  name: 'Local check',
  description: 'Checks a local page',
  type: 'e2e',
  tags: ['smoke'],
  priority: 'high',
  preconditions: [],
  variables: [],
  secrets: [],
  setup: [],
  steps: [{
    id: 'home',
    actions: [
      { id: 'goto', type: 'web.goto', url: 'http://127.0.0.1:4173/' },
      { id: 'heading', type: 'web.expectText', selector: 'h1', expectedText: 'OpenTestPilot' },
    ],
  }],
  cleanup: [],
  artifacts: { screenshots: 'after' },
  runner: { minBrowsers: ['chromium'] },
  permissions: { networkAccess: true },
  source: { repository: 'local', path: 'tests/local.yaml' },
  generatedCode: { path: 'generated/local-check.spec.ts' },
};

describe('executeManifest', () => {
  it('returns a structured failed result when the target is unavailable', async () => {
    const result = await executeManifest(manifest, { outputDir: '.testpilot/test-adapter' });
    expect(result.status).toBe('failed');
    expect(result.steps[0]?.actions[0]?.error?.category).toBe('ENVIRONMENT_ERROR');
    expect(result.steps[0]?.actions[0]?.artifacts?.length).toBeGreaterThan(0);
  }, 30_000);
});
