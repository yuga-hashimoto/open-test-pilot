# Android Appium execution

The mobile path is now wired from a Manifest through generated WebdriverIO code and the Local Runner into Appium.

## Local execution

Install the Android SDK and make an emulator visible to ADB:

```bash
adb devices
```

Start Appium with the installed UiAutomator2 driver:

```bash
ANDROID_HOME="$HOME/Library/Android/sdk" \
ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
pnpm --filter @open-test-pilot/appium-adapter exec appium --address 127.0.0.1 --port 4723
```

Run the real Android gate:

```bash
OPENTESTPILOT_MOBILE_E2E=true \
ANDROID_HOME="$HOME/Library/Android/sdk" \
ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
pnpm --filter @open-test-pilot/appium-adapter test -- --runInBand
```

Optional environment variables:

- `OPENTESTPILOT_ANDROID_DEVICE` selects the ADB device (default: `emulator-5554`).
- `OPENTESTPILOT_APPIUM_URL` selects the Appium server URL (default: `http://127.0.0.1:4723`).

On a failed mobile action, the adapter records screenshot, Appium page source, current activity, and logcat artifacts when the driver exposes them. Missing driver capabilities are represented as artifacts with `unavailableReason`; they are not silently dropped.

## Verified run

On 2026-07-17, the gate was executed against the real local Android emulator
`emulator-5554` (Android 16 / API 36) with Appium 3.5.2 and UiAutomator2 8.1.0:

```text
Test Files  1 passed (1)
Tests       2 passed (2)
```

The two passing cases were a direct UiAutomator2 assertion and a Manifest
execution containing `mobile.launch`, `mobile.expectText`, and
`mobile.screenshot`. The observed text was `Network & internet`. The run
produced a 1080x2400 PNG screenshot, page source XML, current activity, and
logcat evidence under `packages/appium-adapter/.testpilot/mobile-integration/`.

iOS remains a protocol/code-generation path until an XCUITest simulator or
device is available.
