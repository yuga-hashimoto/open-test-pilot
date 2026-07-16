import { describe, expect, it } from 'vitest';
import { executeMobileActions } from './index.js';

describe.skipIf(process.env['OPENTESTPILOT_MOBILE_E2E'] !== 'true')('Appium Android integration', () => {
  it('executes a real UiAutomator2 assertion against the configured emulator', async () => {
    const result = await executeMobileActions({
      platform: 'android',
      deviceName: process.env['OPENTESTPILOT_ANDROID_DEVICE'] ?? 'emulator-5554',
      appPackage: 'com.android.settings',
      appActivity: '.Settings',
      ...(process.env['OPENTESTPILOT_APPIUM_URL'] === undefined ? {} : { serverUrl: process.env['OPENTESTPILOT_APPIUM_URL'] }),
    }, [{ type: 'assertText', locator: { strategy: 'xpath', value: '//android.widget.TextView[@text="Network & internet"]', confidence: 1, source: 'settings fixture' }, value: 'Network & internet' }]);
    expect(result).toEqual({ status: 'passed', actions: [{ type: 'assertText', status: 'passed' }] });
  }, 60_000);
});
