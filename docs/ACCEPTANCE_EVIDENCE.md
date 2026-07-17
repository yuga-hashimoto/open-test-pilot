# Acceptance evidence (2026-07-17)

This file records evidence that was executed, not only code that exists.

| Scenario | Evidence | Result |
| --- | --- | --- |
| Personal Web | `pnpm testpilot run examples/manifests/complex-flow.yaml --actions examples/custom-actions.mjs` produced `run-1784243071149-iwqizq`; report passed with 5 steps and 9 artifacts. The live browser then loaded the team API, edited/saved the Manifest, opened Generated TS and Graph, and selected a passed server run. | Core Web/mixed flow passed. |
| Failure → Codex repair → rerun | Intentionally broken `examples/manifests/repair-login.yaml` produced local failed run `run-1784247101958-1ldk4f` with `LOCATOR_CHANGED` evidence. `CodexCodeWorker` request `repair-live-2` returned a correlated structured AgentResult and a Manifest-only proposal changing `role=button[name=Sign in]` to `role=button[name=ログイン]`. The proposed Manifest validated and reran as local passed run `run-1784247382599-ctpnx1` with 4/4 actions passed and 5 artifacts. | Passed locally with real Codex and Chromium. |
| Source-first | `pnpm testpilot source analyze examples/fixtures/web/server.mjs --framework nextjs --output /tmp/opentestpilot-generated.yaml --base-url http://127.0.0.1:4173` produced 3 findings; `pnpm testpilot manifest validate /tmp/opentestpilot-generated.yaml` returned `valid`. | Passed for the implemented analyzer/generator path. |
| Team API/results | Run `run-eb6ac2d4-93c9-4933-921b-d05b8bb72fae` was created, runner registered, job leased, 11 physical artifacts uploaded, job completed `passed`, and report bytes were fetched and SHA256 checked. The Codex repair acceptance also uploaded 11 failure artifacts to server run `run-beb64d45-cbca-400e-ba10-d395d5bd2079` (`failed`, 1 failure) and 5 repaired artifacts to `run-db5cebfe-7a9e-4b6b-867c-974df477f04e` (`passed`, 0 failures); the browser Evidence view opened the live artifact blobs. | Passed on the live in-memory server. |
| External services | PostgreSQL/Redis/MinIO-backed server created org `814d05eb-a781-4f49-9dca-271cc893673f`, leased `job-7c846bea-2a6d-44dc-b68b-bd88f6ca97bc`, uploaded/fetched an S3 artifact, and completed run `7c846bea-2a6d-44dc-b68b-bd88f6ca97bc` as passed. | Passed with real local containers. |
| Remote Docker Runner | Fresh `docker build` passed for both runner/server images. Latest `test:docker:smoke` created `run-29dd69fd-a2e9-4181-b6a1-94ec1c4c3e3a`; the rebuilt container reached the host fixture via `host.docker.internal`, ran Chromium, uploaded 8 artifacts, and completed with 0 failures. | Passed. |
| Runner UI | Added/listed runner API was covered by server/queue tests. A real browser loaded the rebuilt web app against the restarted server and displayed `live-chromium`, Chromium capability, max concurrency 1, and `heartbeat Now` with zero console errors. | Passed. |
| Team/GitHub | Existing Chrome tab showed `OpenTestPilot E2E` installed for `yuga-hashimoto/open-test-pilot`, installation `146977164`, with write permissions required by the design. The latest GitHub Mobile sudo request displayed digits `40` but timed out before approval. | App installation passed. GitHub Mobile approval/private-key creation and real branch/PR/Check/comment writes remain pending. |
| Complex DSL | Full test suite includes generator, schema, adapter, custom action, branch, loop, parallel, retry, try/finally, and result-import coverage. | Passed in automated tests; the complex fixture also passed as a real local run. |
| AI Worker/Codex | Structured parser and CLI worker tests pass. `CodexCodeWorker` request `repair-live-2` read the real failure report and accessibility artifact, returned a correlated structured AgentResult with `proposedChanges.manifest`, and the repaired Manifest passed on the real fixture Chromium flow. | Analyze-failure → Codex repair → Manifest rerun passed. PR publication remains gated on live GitHub App credentials. |
| Schedules/UI evidence | Live server schedule `schedule-552b09a8-40c9-4bf7-99c5-6a5c3716e003` returned `202` from the API trigger and the rebuilt browser displayed `Run now →`; clicking it created queued run `run-8003cffc-647f-433c-87e0-7ac0ebac85dd` and navigated to the live Runs view. | Passed for API/UI trigger path; cron daemon deployment remains operational gate. |
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
