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

  it('executes a mobile Manifest through the Appium driver boundary', async () => {
    const result = await runLocal({
      ...manifest,
      id: 'mobile-local',
      name: 'Mobile local',
      type: 'mobile',
      steps: [{ id: 'mobile-step', actions: [
        { id: 'launch', type: 'mobile.launch', capabilities: { platform: 'android', deviceName: 'emulator-5554', appPackage: 'com.example', appActivity: '.MainActivity' } },
        { id: 'tap', type: 'mobile.tap', selector: 'id=login' },
        { id: 'assert', type: 'mobile.expectText', selector: 'id=welcome', expectedText: 'Welcome' },
      ] }],
      generatedCode: { path: 'generated/mobile-local.spec.ts' },
    }, {
      rootDir: '.testpilot/mobile-local',
      mobileDriver: {
        async $() { return { async click() {}, async setValue() {}, async getText() { return 'Welcome'; }, async waitForDisplayed() {} }; },
        async deleteSession() {},
      },
    });
    expect(result.status).toBe('passed');
    expect(result.steps[0]?.actions.map((action) => action.actionId)).toEqual(['launch', 'tap', 'assert']);
    expect(result.artifacts.some((artifact) => artifact.type === 'generated-code')).toBe(true);
  }, 30_000);
});
