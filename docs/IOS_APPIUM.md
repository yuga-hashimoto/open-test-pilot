# iOS Appium execution

The Appium adapter includes `appium-xcuitest-driver` and forwards the simulator/device identifier, application bundle ID, WDA local port, WDA timeouts, reset behavior, and Xcode log setting.

Start an available iOS simulator and Appium with XCUITest:

```bash
xcrun simctl list devices available
pnpm --filter @open-test-pilot/appium-adapter exec appium server \
  --address 127.0.0.1 --port 4725 --use-drivers xcuitest
```

Example capabilities for a simulator are:

```json
{
  "platform": "ios",
  "deviceName": "iPhone 16",
  "udid": "<simulator-udid>",
  "bundleId": "com.example.app",
  "wdaLocalPort": 8102,
  "useNewWDA": true,
  "wdaLaunchTimeout": 120000,
  "wdaConnectionTimeout": 120000,
  "showXcodeLog": true
}
```

The repository includes a real-session integration test. Run it only when an
iOS simulator or device and a working WDA host are available:

```bash
OPENTESTPILOT_IOS_E2E=true \
OPENTESTPILOT_IOS_UDID=<simulator-udid> \
OPENTESTPILOT_IOS_BUNDLE_ID=com.apple.Preferences \
pnpm --filter @open-test-pilot/appium-adapter test -- --run src/mobile.integration.test.ts
```

`OPENTESTPILOT_IOS_DEVICE`, `OPENTESTPILOT_IOS_APPIUM_URL`,
`OPENTESTPILOT_IOS_WDA_PORT`, and the WDA timeout/log/reset variables override
the defaults used by the test. Evidence is written to
`.testpilot/ios-mobile-integration`.

On 2026-07-17 the installed XCUITest driver was exercised against an iOS 26.4 simulator. Xcode reached `TEST BUILD SUCCEEDED` and Appium launched `WebDriverAgentRunner`, but the runner did not expose its HTTP listener on port 8102; Appium therefore returned `ECONNREFUSED` during session creation. This is recorded as a host/Xcode WDA gate, not a passing iOS execution.
