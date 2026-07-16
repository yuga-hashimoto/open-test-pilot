import assert from 'node:assert/strict';
import { remote } from 'webdriverio';

const browser = await remote({ protocol: 'http', hostname: '127.0.0.1', port: 4723, path: '/', capabilities: { platformName: 'android', 'appium:deviceName': 'emulator-5554', 'appium:appPackage': 'com.android.settings', 'appium:appActivity': '.Settings', 'appium:automationName': 'UiAutomator2' } });
try {
  // testpilot:step settings
  // testpilot:action launch
  // mobile.launch is represented by the WebdriverIO session above
  // testpilot:action network
  assert.equal(await (await browser.$('//android.widget.TextView[@text="Network & internet"]')).getText(), 'Network & internet');
  // testpilot:action screenshot
  await browser.saveScreenshot('artifacts/settings.png');
} finally {
  await browser.deleteSession();
}
