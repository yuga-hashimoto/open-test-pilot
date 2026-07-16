import { beforeAll, describe, expect, it } from 'vitest';
import { ensureAndroidSdkEnv, executeMobileActions, executeMobileManifest } from './index.js';

describe.skipIf(process.env['OPENTESTPILOT_MOBILE_E2E'] !== 'true')('Appium Android integration', () => {
  beforeAll(() => { ensureAndroidSdkEnv(); });

  it('executes a real UiAutomator2 assertion against the configured emulator', async () => {
    const result = await executeMobileActions({
      platform: 'android',
      deviceName: process.env['OPENTESTPILOT_ANDROID_DEVICE'] ?? 'emulator-5554',
      appPackage: 'com.android.settings',
      appActivity: '.Settings',
      ...(process.env['OPENTESTPILOT_APPIUM_URL'] === undefined ? {} : { serverUrl: process.env['OPENTESTPILOT_APPIUM_URL'] }),
    }, [{ type: 'assertText', locator: { strategy: 'xpath', value: '//android.widget.TextView[@text="Network & internet"]', confidence: 1, source: 'settings fixture' }, value: 'Network & internet' }]);
    expect(result).toMatchObject({ status: 'passed', actions: [{ type: 'assertText', status: 'passed' }] });
  }, 60_000);

  it('executes a mobile Manifest and captures a real step screenshot', async () => {
    const capabilities = {
      platform: 'android' as const,
      deviceName: process.env['OPENTESTPILOT_ANDROID_DEVICE'] ?? 'emulator-5554',
      appPackage: 'com.android.settings',
      appActivity: '.Settings',
      ...(process.env['OPENTESTPILOT_APPIUM_URL'] === undefined ? {} : { serverUrl: process.env['OPENTESTPILOT_APPIUM_URL'] }),
    };
    const result = await executeMobileManifest(capabilities, {
      id: 'android-settings-manifest',
      steps: [{ id: 'settings', actions: [
        { id: 'launch', type: 'mobile.launch', capabilities },
        { id: 'assert-network', type: 'mobile.expectText', selector: '//android.widget.TextView[@text="Network & internet"]', expectedText: 'Network & internet' },
        { id: 'screenshot', type: 'mobile.screenshot', name: 'settings-network' },
      ] }],
    }, { evidenceDir: '.testpilot/mobile-integration' });
    expect(result.status).toBe('passed');
    expect(result.steps[0]?.actions.map((action) => action.actionId)).toEqual(['launch', 'assert-network', 'screenshot']);
    expect(result.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'mobile-screenshot' })]));
  }, 60_000);
});
