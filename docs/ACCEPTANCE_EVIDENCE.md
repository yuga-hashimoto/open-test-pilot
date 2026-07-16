# Acceptance evidence (2026-07-17)

This file records executable evidence for the full-design continuation. A passing package test is not treated as proof of a live external integration.

| Scenario | Evidence | Result |
|---|---|---|
| Personal Web | `pnpm testpilot run examples/manifests/fixture-login.yaml` -> `run-1784242163779-krf6kn`; `pnpm testpilot run examples/manifests/complex-flow.yaml --actions examples/custom-actions.mjs` -> `run-1784242164997-e6vogt`; both reports passed. Complex run contained 5 steps, 9 artifacts, screenshots, trace, network log, generated code, and source map. Generated files compiled with standalone `tsc`. | Core Web and mixed flow passed. A real failure->repair->rerun cycle still needs a live repair agent and GitHub write credentials. |
| Team/GitHub | Existing Chrome session showed `OpenTestPilot E2E` installed for `yuga-hashimoto/open-test-pilot`, installation id `146977164`, with checks/code/status/issues/PR read-write permission. | Installation proof passed. App settings are behind GitHub sudo mode; `gh auth status` reports the keyring token invalid, so App JWT/branch/PR/Checks/comment write was not performed. |
| Complex DSL | Generator tests: 9 passed; Manifest schema tests: 52 passed; Playwright adapter tests: 5 passed, including nested control flow and `waitUntil` children. | Passed. |
| Remote Runner | Runner tests: 15 passed. Server tests: 35 passed. | Protocol/API lifecycle passed. Docker image build was attempted; Colima failed with iptables and `/etc/resolv.conf` I/O errors before the image could build. |
| Android/iOS | Appium generator and adapter tests pass; `adb devices` reported no devices; `xcrun simctl list devices available` reported no available devices/runtimes. | Code path verified; device execution is an environment gate. |
| AI Worker | Real `ClaudeCodeWorker` Analyze invocation completed using the authenticated Claude CLI against `b1b718a`, returning structured worker output. | Analyze passed. Full clone->repair->rerun->GitHub PR requires valid GitHub write authentication and remains gated. |

## Repeatable gates

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm verify:generated
pnpm license:report
pnpm release:artifacts
```

The release builder produced `dist/release/release-manifest.json`, the CLI tarball, Apache-2.0 notices, and the deterministic third-party license report.
