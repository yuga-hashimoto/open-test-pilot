import { describe, expect, it } from 'vitest';
import { buildAppiumCapabilities, executeMobileActionsWithDriver, generateWebdriverIoTest, locatorCandidates, parseAndroidUiDump, parseIosAccessibilityJson } from './index.js';

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

  it('executes mobile actions through a driver boundary', async () => {
    const calls: string[] = [];
    const driver = { async $(selector: string) { calls.push(`find:${selector}`); return { async click() { calls.push('click'); }, async setValue(value: string) { calls.push(`input:${value}`); }, async getText() { return 'Welcome'; } }; }, async deleteSession() { calls.push('close'); } };
    const result = await executeMobileActionsWithDriver(driver, [{ type: 'tap', locator: { strategy: 'accessibility id', value: 'login', confidence: 1, source: 'test' } }, { type: 'assertText', locator: { strategy: 'id', value: 'welcome', confidence: 1, source: 'test' }, value: 'Welcome' }]);
    expect(result.status).toBe('passed');
    expect(calls).toEqual(['find:~login', 'click', 'find:id=welcome']);
  });
});
