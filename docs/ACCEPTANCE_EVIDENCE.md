# Acceptance evidence (2026-07-17)

This file records evidence that was executed, not only code that exists.

| Scenario | Evidence | Result |
| --- | --- | --- |
| Personal Web | `pnpm testpilot run examples/manifests/complex-flow.yaml --actions examples/custom-actions.mjs` produced `run-1784243071149-iwqizq`; report passed with 5 steps and 9 artifacts. The live browser then loaded the team API, edited/saved the Manifest, opened Generated TS and Graph, and selected a passed server run. | Core Web/mixed flow passed. Failure → AI repair → rerun is not claimed. |
| Source-first | `pnpm testpilot source analyze examples/fixtures/web/server.mjs --framework nextjs --output /tmp/opentestpilot-generated.yaml --base-url http://127.0.0.1:4173` produced 3 findings; `pnpm testpilot manifest validate /tmp/opentestpilot-generated.yaml` returned `valid`. | Passed for the implemented analyzer/generator path. |
| Team API/results | Run `run-eb6ac2d4-93c9-4933-921b-d05b8bb72fae` was created, runner registered, job leased, 11 physical artifacts uploaded, job completed `passed`, and report bytes were fetched and SHA256 checked. A second run imported a real `testResults` object through `/results/import`. | Passed on the live in-memory server. |
| Remote Docker Runner | Fresh `docker build` passed for both runner/server images. Latest `test:docker:smoke` created `run-29dd69fd-a2e9-4181-b6a1-94ec1c4c3e3a`; the rebuilt container reached the host fixture via `host.docker.internal`, ran Chromium, uploaded 8 artifacts, and completed with 0 failures. | Passed. |
| Runner UI | Added/listed runner API was covered by server/queue tests. A real browser loaded the rebuilt web app against the restarted server and displayed `live-chromium`, Chromium capability, max concurrency 1, and `heartbeat Now` with zero console errors. | Passed. |
| Team/GitHub | Existing Chrome tab showed `OpenTestPilot E2E` installed for `yuga-hashimoto/open-test-pilot`, installation `146977164`, with write permissions required by the design. The latest GitHub Mobile sudo request displayed digits `40` but timed out before approval. | App installation passed. GitHub Mobile approval/private-key creation and real branch/PR/Check/comment writes remain pending. |
| Complex DSL | Full test suite includes generator, schema, adapter, custom action, branch, loop, parallel, retry, try/finally, and result-import coverage. | Passed in automated tests; the complex fixture also passed as a real local run. |
| AI Worker/Codex | Structured parser and CLI worker tests pass. A direct real Codex probe with `--json --model gpt-5.5` returned a correlated AgentResult. A repository-bound worker probe is not accepted as success because it timed out or returned a repository-access finding. | Adapter path implemented; full analyze-failure → repair → rerun → PR remains open. |
| Android/iOS | Android `emulator-5554` was started locally (Android 16/API 36); Appium 3.5.2 + UiAutomator2 8.1.0 ran the direct assertion and the Android Settings Manifest successfully, including the `Network & internet` text assertion and real 1080x2400 screenshots. Evidence is in `packages/appium-adapter/.testpilot/mobile-integration/`. | Android acceptance path passed. iOS is still an environment gate because no XCUITest simulator/device is configured. |

## Repeatable gates

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:generated
pnpm license:report
pnpm release:artifacts
pnpm security:audit
```
