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

describe.skipIf(process.env['OPENTESTPILOT_IOS_E2E'] !== 'true')('Appium iOS integration', () => {
  it('executes an iOS Manifest and captures a real step screenshot', async () => {
    const capabilities = {
      platform: 'ios' as const,
      deviceName: process.env['OPENTESTPILOT_IOS_DEVICE'] ?? 'iPhone 16',
      ...(process.env['OPENTESTPILOT_IOS_UDID'] === undefined ? {} : { udid: process.env['OPENTESTPILOT_IOS_UDID'] }),
      bundleId: process.env['OPENTESTPILOT_IOS_BUNDLE_ID'] ?? 'com.apple.Preferences',
      ...(process.env['OPENTESTPILOT_IOS_WDA_PORT'] === undefined ? {} : { wdaLocalPort: Number(process.env['OPENTESTPILOT_IOS_WDA_PORT']) }),
      ...(process.env['OPENTESTPILOT_IOS_APPIUM_URL'] === undefined ? {} : { serverUrl: process.env['OPENTESTPILOT_IOS_APPIUM_URL'] }),
      useNewWDA: process.env['OPENTESTPILOT_IOS_USE_NEW_WDA'] !== 'false',
      wdaLaunchTimeout: Number(process.env['OPENTESTPILOT_IOS_WDA_LAUNCH_TIMEOUT'] ?? 120000),
      wdaConnectionTimeout: Number(process.env['OPENTESTPILOT_IOS_WDA_CONNECTION_TIMEOUT'] ?? 120000),
      showXcodeLog: process.env['OPENTESTPILOT_IOS_SHOW_XCODE_LOG'] !== 'false',
      noReset: process.env['OPENTESTPILOT_IOS_NO_RESET'] !== 'false',
      ...(process.env['OPENTESTPILOT_IOS_SIMULATOR_DEVICES_SET_PATH'] === undefined ? {} : { simulatorDevicesSetPath: process.env['OPENTESTPILOT_IOS_SIMULATOR_DEVICES_SET_PATH'] }),
    };
    const selector = process.env['OPENTESTPILOT_IOS_SELECTOR'] ?? '//XCUIElementTypeApplication';
    const result = await executeMobileManifest(capabilities, {
      id: 'ios-settings-manifest',
      steps: [{ id: 'settings', actions: [
        { id: 'launch', type: 'mobile.launch', capabilities },
        { id: 'assert-app', type: 'mobile.expectVisible', selector },
        { id: 'screenshot', type: 'mobile.screenshot', name: 'ios-settings' },
      ] }],
    }, { evidenceDir: '.testpilot/ios-mobile-integration' });
    expect(result.status).toBe('passed');
    expect(result.steps[0]?.actions.map((action) => action.actionId)).toEqual(['launch', 'assert-app', 'screenshot']);
    expect(result.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'mobile-screenshot' })]));
  }, 180_000);
});
