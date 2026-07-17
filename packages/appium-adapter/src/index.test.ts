import { describe, expect, it } from 'vitest';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { buildAppiumCapabilities, ensureAndroidSdkEnv, executeMobileActionsWithDriver, executeMobileManifest, executeMobileManifestWithDriver, generateWebdriverIoTest, locatorCandidates, parseAndroidUiDump, parseIosAccessibilityJson, resolveAndroidSdkPath, type MobileDriver } from './index.js';

describe('Appium adapter', () => {
  it('builds platform-specific capabilities and parses Android evidence', () => {
    expect(buildAppiumCapabilities({ platform: 'android', deviceName: 'Pixel_8', appPackage: 'com.example', appActivity: '.MainActivity' })).toMatchObject({ platformName: 'android', 'appium:automationName': 'UiAutomator2' });
    const nodes = parseAndroidUiDump('<hierarchy><node resource-id="com.example:id/login" text="Login" class="android.widget.Button" clickable="true" enabled="true" bounds="[0,0][10,10]"/></hierarchy>');
    expect(locatorCandidates(nodes[0] ?? {}, 'android')[0]).toMatchObject({ strategy: 'id', value: 'com.example:id/login' });
  });

  it('forwards iOS device, bundle, and WebDriverAgent capabilities', () => {
    expect(buildAppiumCapabilities({ platform: 'ios', deviceName: 'iPhone 16', udid: 'simulator-1', bundleId: 'com.example.app', wdaLocalPort: 8102, useNewWDA: true, wdaLaunchTimeout: 120000, wdaConnectionTimeout: 120000, showXcodeLog: true, noReset: true, simulatorDevicesSetPath: '/tmp/devices' })).toMatchObject({
      platformName: 'ios',
      'appium:udid': 'simulator-1',
      'appium:bundleId': 'com.example.app',
      'appium:automationName': 'XCUITest',
      'appium:wdaLocalPort': 8102,
      'appium:useNewWDA': true,
      'appium:wdaLaunchTimeout': 120000,
      'appium:wdaConnectionTimeout': 120000,
      'appium:showXcodeLog': true,
      'appium:noReset': true,
      'appium:simulatorDevicesSetPath': '/tmp/devices',
    });
  });

  it('parses iOS accessibility evidence and generates independently runnable code', () => {
    const nodes = parseIosAccessibilityJson([{ identifier: 'email', label: 'Email', type: 'XCUIElementTypeTextField' }]);
    expect(locatorCandidates(nodes[0] ?? {}, 'ios')[0]?.value).toBe('email');
    const code = generateWebdriverIoTest({ platform: 'ios', deviceName: 'iPhone 16' }, [{ type: 'tap', locator: { strategy: 'accessibility id', value: 'login', confidence: 0.98, source: 'test' } }]);
    expect(code).toContain("import { remote } from 'webdriverio'");
    expect(code).toContain('deleteSession');
  });

  it('executes mobile actions through a driver boundary', async () => {
    const calls: string[] = [];
    const driver = { async $(selector: string) { calls.push(`find:${selector}`); return { async click() { calls.push('click'); }, async setValue(value: string) { calls.push(`input:${value}`); }, async getText() { return 'Welcome'; } }; }, async deleteSession() { calls.push('close'); } };
    const result = await executeMobileActionsWithDriver(driver, [{ type: 'tap', locator: { strategy: 'accessibility id', value: 'login', confidence: 1, source: 'test' } }, { type: 'assertText', locator: { strategy: 'id', value: 'welcome', confidence: 1, source: 'test' }, value: 'Welcome' }]);
    expect(result.status).toBe('passed');
    expect(calls).toEqual(['find:~login', 'click', 'find:id=welcome']);
  });

  it('returns failure evidence artifacts when a mobile action fails', async () => {
    const driver = {
      async $() { throw new Error('element not found'); },
      async saveScreenshot(path: string) { return path; },
      async getPageSource() { return '<hierarchy />'; },
      async getCurrentActivity() { return '.MainActivity'; },
      async getLogs() { return [{ message: 'uiautomator failure' }]; },
      async deleteSession() {},
    };
    const result = await executeMobileActionsWithDriver(driver, [{ type: 'tap', locator: { strategy: 'id', value: 'missing', confidence: 0.2, source: 'test' } }], { evidenceDir: '.testpilot/mobile-failure' });
    expect(result.status).toBe('failed');
    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'mobile-screenshot' }),
      expect.objectContaining({ type: 'appium-page-source' }),
      expect.objectContaining({ type: 'mobile-activity' }),
      expect.objectContaining({ type: 'appium-log' }),
    ]));
    expect(result.actions[0]).toMatchObject({ type: 'tap', status: 'failed' });
  });

  it('keeps the driver-written PNG when saveScreenshot returns base64', async () => {
    const evidenceDir = '.testpilot/mobile-base64-evidence';
    const driver = {
      async $() { throw new Error('element not found'); },
      async saveScreenshot(path: string) { await writeFile(path, Buffer.from('PNG')); return Buffer.from('base64-return').toString('base64'); },
      async deleteSession() {},
    };
    await executeMobileActionsWithDriver(driver, [{ type: 'tap', locator: { strategy: 'id', value: 'missing', confidence: 0.2, source: 'test' } }], { evidenceDir });
    expect(await readFile(`${evidenceDir}/screenshot.png`, 'utf8')).toBe('PNG');
  });

  it('executes Manifest mobile actions and preserves step/action results', async () => {
    const calls: string[] = [];
    const driver = {
      async $() { return { async click() { calls.push('click'); }, async setValue(value: string) { calls.push(`fill:${value}`); }, async getText() { return 'Welcome'; }, async waitForDisplayed() { calls.push('visible'); } }; },
      async back() { calls.push('back'); },
      async saveScreenshot(path: string) { if (!existsSync(dirname(path))) throw new Error('evidence directory missing'); calls.push('screenshot'); return 'png'; },
      async deleteSession() {},
    };
    const result = await executeMobileManifestWithDriver(driver, {
      id: 'mobile-test',
      steps: [{ id: 'login', actions: [
        { id: 'tap', type: 'mobile.tap', selector: 'id=login' },
        { id: 'fill', type: 'mobile.fill', selector: 'id=email', value: 'user@example.com' },
        { id: 'visible', type: 'mobile.expectVisible', selector: 'id=welcome' },
        { id: 'text', type: 'mobile.expectText', selector: 'id=welcome', expectedText: 'Welcome' },
        { id: 'shot', type: 'mobile.screenshot', name: 'welcome' },
        { id: 'back', type: 'mobile.back' },
      ] }],
    }, { evidenceDir: '.testpilot/mobile-manifest-success-unique' });
    expect(result.status).toBe('passed');
    expect(result.steps[0]).toMatchObject({ stepId: 'login', status: 'passed' });
    expect(result.steps[0]?.actions.map((action) => action.actionId)).toEqual(['tap', 'fill', 'visible', 'text', 'shot', 'back']);
    expect(calls).toEqual(['click', 'fill:user@example.com', 'visible', 'screenshot', 'back']);
  });

  it('creates and cleans up a real-driver session through the Manifest entry point', async () => {
    const result = await executeMobileManifest({ platform: 'android', deviceName: 'emulator-5554' }, { id: 'entry-point', steps: [] }, {
      driverFactory: async () => ({ async $() { return { async click() {}, async setValue() {}, async getText() { return ''; } }; }, async deleteSession() {} }),
    });
    expect(result.status).toBe('passed');
    expect(result.steps).toEqual([]);
  });
});

describe('resolveAndroidSdkPath', () => {
  it('prefers ANDROID_HOME when set', () => {
    expect(resolveAndroidSdkPath({ ANDROID_HOME: '/custom/sdk', ANDROID_SDK_ROOT: '/other' })).toBe('/custom/sdk');
  });

  it('falls back to ANDROID_SDK_ROOT when ANDROID_HOME is absent', () => {
    expect(resolveAndroidSdkPath({ ANDROID_SDK_ROOT: '/root/sdk' })).toBe('/root/sdk');
  });

  it('ignores empty-string env values', () => {
    expect(resolveAndroidSdkPath({ ANDROID_HOME: '  ', ANDROID_SDK_ROOT: '/root/sdk' })).toBe('/root/sdk');
  });

  it('probes the macOS default path when no env var is set', () => {
    expect(resolveAndroidSdkPath({}, { home: '/Users/test', exists: (p) => p === '/Users/test/Library/Android/sdk' })).toBe('/Users/test/Library/Android/sdk');
  });

  it('probes the Linux default path when no env var is set', () => {
    expect(resolveAndroidSdkPath({}, { home: '/home/user', exists: (p) => p === '/home/user/Android/Sdk' })).toBe('/home/user/Android/Sdk');
  });

  it('returns undefined when nothing resolves', () => {
    expect(resolveAndroidSdkPath({}, { home: '/nowhere', exists: () => false })).toBeUndefined();
  });
});

describe('ensureAndroidSdkEnv', () => {
  it('exports ANDROID_HOME and ANDROID_SDK_ROOT when a path resolves', () => {
    const original = { ...process.env };
    delete process.env['ANDROID_HOME'];
    delete process.env['ANDROID_SDK_ROOT'];
    try {
      const resolved = ensureAndroidSdkEnv({ env: { }, home: '/Users/test', exists: (p) => p === '/Users/test/Library/Android/sdk' });
      expect(resolved).toBe('/Users/test/Library/Android/sdk');
      expect(process.env['ANDROID_HOME']).toBe('/Users/test/Library/Android/sdk');
      expect(process.env['ANDROID_SDK_ROOT']).toBe('/Users/test/Library/Android/sdk');
    } finally {
      process.env = original;
    }
  });

  it('does not overwrite an existing ANDROID_HOME', () => {
    const original = { ...process.env };
    try {
      process.env['ANDROID_HOME'] = '/preset';
      const resolved = ensureAndroidSdkEnv({ env: { ANDROID_HOME: '/preset' }, home: '/Users/test', exists: () => true });
      expect(resolved).toBe('/preset');
      expect(process.env['ANDROID_HOME']).toBe('/preset');
    } finally {
      process.env = original;
    }
  });

  it('returns undefined when no SDK is discoverable', () => {
    const original = { ...process.env };
    delete process.env['ANDROID_HOME'];
    delete process.env['ANDROID_SDK_ROOT'];
    try {
      expect(ensureAndroidSdkEnv({ env: {}, home: '/nowhere', exists: () => false })).toBeUndefined();
      expect(process.env['ANDROID_HOME']).toBeUndefined();
    } finally {
      process.env = original;
    }
  });
});

describe('executeMobileManifestWithDriver', () => {
  function mockDriver(overrides: Partial<MobileDriver> = {}): { driver: MobileDriver; calls: string[] } {
    const calls: string[] = [];
    const driver: MobileDriver = {
      async $(selector: string) {
        calls.push(`find:${selector}`);
        return {
          async click() { calls.push('click'); },
          async setValue(value: string) { calls.push(`input:${value}`); },
          async getText() { calls.push('getText'); return 'Welcome'; },
          async waitForDisplayed() { calls.push('waitForDisplayed'); },
        };
      },
      async deleteSession() { calls.push('close'); },
      async back() { calls.push('back'); },
      async saveScreenshot(_path: string) { calls.push('screenshot'); return 'ok'; },
      async getPageSource() { calls.push('pageSource'); return '<hierarchy><node text="Hello"/></hierarchy>'; },
      async getCurrentActivity() { calls.push('activity'); return 'com.example.MainActivity'; },
      async getLogs(_type?: string) { calls.push('logs'); return [{ level: 'INFO', message: 'test' }]; },
      ...overrides,
    };
    return { driver, calls };
  }

  it('executes all mobile manifest actions through a driver boundary', async () => {
    const { driver, calls } = mockDriver();
    const manifest = {
      id: 'android-test',
      steps: [{
        id: 'login',
        actions: [
          { id: 'launch', type: 'mobile.launch' as const },
          { id: 'tap', type: 'mobile.tap' as const, selector: 'id=com.example:id/login' },
          { id: 'fill', type: 'mobile.fill' as const, selector: 'id=com.example:id/email', value: 'user@example.com' },
          { id: 'assert', type: 'mobile.expectText' as const, selector: 'id=com.example:id/welcome', expectedText: 'Welcome' },
          { id: 'shot', type: 'mobile.screenshot' as const, name: 'welcome' },
          { id: 'back', type: 'mobile.back' as const },
        ],
      }],
    };

    const result = await executeMobileManifestWithDriver(driver, manifest);

    expect(result.status).toBe('passed');
    expect(result.steps[0]?.status).toBe('passed');
    expect(result.steps[0]?.actions.map((a) => a.actionId)).toEqual(['launch', 'tap', 'fill', 'assert', 'shot', 'back']);
    expect(calls).toEqual([
      'find:id=com.example:id/login', 'click',
      'find:id=com.example:id/email', 'input:user@example.com',
      'find:id=com.example:id/welcome', 'getText',
      'screenshot',
      'back',
    ]);
  });

  it('collects structured failure artifacts on action failure', async () => {
    const { driver } = mockDriver({
      async $(selector: string) {
        if (selector.includes('welcome')) throw new Error('Element not found: welcome');
        return {
          async click() {},
          async setValue(_value: string) {},
          async getText() { return 'OK'; },
          async waitForDisplayed() {},
        };
      },
    });

    const manifest = {
      id: 'android-fail',
      steps: [{
        id: 'broken',
        actions: [
          { id: 'tap-ok', type: 'mobile.tap' as const, selector: 'id=com.example:id/ok' },
          { id: 'tap-fail', type: 'mobile.tap' as const, selector: 'id=com.example:id/welcome' },
        ],
      }],
    };

    const result = await executeMobileManifestWithDriver(driver, manifest, { evidenceDir: '.testpilot/appium-failure' });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Element not found');
    expect(result.steps[0]?.status).toBe('failed');
    expect(result.steps[0]?.actions[0]?.status).toBe('passed');
    expect(result.steps[0]?.actions[1]?.status).toBe('failed');
    expect(result.steps[0]?.actions[1]?.artifacts?.length).toBeGreaterThan(0);

    const artifactTypes = (result.steps[0]?.actions[1]?.artifacts ?? []).map((a) => a.type);
    expect(artifactTypes).toEqual(expect.arrayContaining(['mobile-screenshot', 'appium-page-source', 'mobile-activity', 'appium-log']));
  });

  it('marks evidence as unavailable when driver lacks capabilities', async () => {
    const driver: MobileDriver = {
      async $(selector: string) {
        throw new Error('element not found');
      },
      async deleteSession() {},
    };

    const manifest = {
      id: 'android-minimal',
      steps: [{
        id: 'fail',
        actions: [{ id: 'tap', type: 'mobile.tap' as const, selector: 'id=missing' }],
      }],
    };

    const result = await executeMobileManifestWithDriver(driver, manifest);

    expect(result.status).toBe('failed');
    const artifacts = result.steps[0]?.actions[0]?.artifacts ?? [];
    expect(artifacts.some((a) => a.unavailableReason !== undefined)).toBe(true);
    expect(artifacts.some((a) => a.type === 'mobile-screenshot' && (a.unavailableReason?.includes('does not expose') ?? false))).toBe(true);
  });

  it('captures configured after screenshots and exposes them on the final action', async () => {
    const { driver, calls } = mockDriver();
    const result = await executeMobileManifestWithDriver(driver, {
      id: 'android-after',
      steps: [{ id: 'home', actions: [{ id: 'tap', type: 'mobile.tap', selector: 'id=home' }] }],
    }, { evidenceDir: '.testpilot/appium-after', screenshotMode: 'after' });

    expect(result.status).toBe('passed');
    expect(calls).toContain('screenshot');
    expect(result.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'screenshot/home-after.png' })]));
    expect(result.steps[0]?.actions[0]?.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'screenshot/home-after.png' })]));
  });

  it('captures before and after evidence for each mobile action', async () => {
    const { driver, calls } = mockDriver();
    const result = await executeMobileManifestWithDriver(driver, {
      id: 'android-before-after',
      steps: [{ id: 'home', actions: [{ id: 'tap', type: 'mobile.tap', selector: 'id=home' }] }],
    }, { evidenceDir: '.testpilot/appium-before-after', screenshotMode: 'before-and-after' });

    expect(result.status).toBe('passed');
    expect(calls.filter((call) => call === 'screenshot')).toHaveLength(3);
    expect(result.steps[0]?.actions[0]?.artifacts?.map((artifact) => artifact.path)).toEqual([
      'screenshot/home-tap-before.png',
      'screenshot/home-tap-after.png',
      'screenshot/home-after.png',
    ]);
  });
});
