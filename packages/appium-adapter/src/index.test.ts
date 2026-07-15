import { describe, expect, it } from 'vitest';
import { buildAppiumCapabilities, generateWebdriverIoTest, locatorCandidates, parseAndroidUiDump, parseIosAccessibilityJson } from './index.js';

describe('Appium adapter', () => {
  it('builds platform-specific capabilities and parses Android evidence', () => {
    expect(buildAppiumCapabilities({ platform: 'android', deviceName: 'Pixel_8', appPackage: 'com.example', appActivity: '.MainActivity' })).toMatchObject({ platformName: 'android', 'appium:automationName': 'UiAutomator2' });
    const nodes = parseAndroidUiDump('<hierarchy><node resource-id="com.example:id/login" text="Login" class="android.widget.Button" clickable="true" enabled="true" bounds="[0,0][10,10]"/></hierarchy>');
    expect(locatorCandidates(nodes[0] ?? {}, 'android')[0]).toMatchObject({ strategy: 'id', value: 'com.example:id/login' });
  });

  it('parses iOS accessibility evidence and generates independently runnable code', () => {
    const nodes = parseIosAccessibilityJson([{ identifier: 'email', label: 'Email', type: 'XCUIElementTypeTextField' }]);
    expect(locatorCandidates(nodes[0] ?? {}, 'ios')[0]?.value).toBe('email');
    const code = generateWebdriverIoTest({ platform: 'ios', deviceName: 'iPhone 16' }, [{ type: 'tap', locator: { strategy: 'accessibility id', value: 'login', confidence: 0.98, source: 'test' } }]);
    expect(code).toContain("import { remote } from 'webdriverio'");
    expect(code).toContain('deleteSession');
  });
});
