# Design requirement audit

This is the live audit of the attached platform design against `main`. It is intentionally explicit about external gates and areas that are not yet complete.

| Design area | Current evidence | Status |
| --- | --- | --- |
| Manifest schema and stable IDs | `packages/manifest-schema`, AJV tests, YAML parser/normalizer | Implemented for the supported v1 action set |
| Web/API/control-flow execution | Playwright adapter, API adapter, complex fixture flow and generated Playwright run | Implemented for supported actions |
| Mobile Manifest path | Mobile schema, WebdriverIO generator, Local Runner branch, Appium adapter, real Android gate | Android implemented; iOS requires an available XCUITest device/simulator |
| Mobile failure evidence | Screenshot, page source, activity, Appium/logcat, unavailable reasons, locator metadata | Implemented and tested |
| Local HTML report | Report package and local runner artifacts | Implemented |
| Server tenant API | Fastify routes, tenant checks, tenant-isolated queue, artifact store, manifest CRUD, result failures/steps; PostgreSQL repository and forced RLS live smoke; result persistence adapters | Core run/result persistence is implemented for in-memory and PostgreSQL repositories; artifact metadata remains process-local in the current HTTP composition |
| MCP contract | 19 declared tools and live `tools/list` smoke test | Implemented; some server resources still expose minimal records |
| GitHub App | Real installation credentials, branch/commit/PR/check/comment smoke flow | Implemented for the exercised adapter flow; full sync/permission persistence remains partial |
| Distributed Runner | Registration, heartbeat, lease, completion, immutable manifest snapshot, Docker execution, generated/report artifact upload, result/failure/step retrieval, explicit manifest network permission | Implemented for server → Runner → Docker → result/artifact flow; reconnection/reassignment and multi-runner fairness remain partial |
| AI Worker | Policy gate, repair proposal validation, injectable clone/fetch/checkout → Claude → validate → run → optional YAML-only PR workflow | Guarded workflow is implemented and tested; production Claude credentials, repository token injection, and automatic retry/reassignment remain external gates |
| Web editor | Live YAML manifest load/save and tests/runs/schedules views | Implemented foundation; tree/graph/Monaco/diff views remain partial |
| Storage/secrets | Local/S3-compatible adapters, secret provider SDK, redaction helpers | Implemented foundation; Vault/cloud providers and retention UI remain partial |
| CI/release | CI workflow, Dockerfiles/Compose, Helm values, OSS governance docs | Implemented foundation; complete release matrix needs further work |

## Verified commands

The Android verification command is documented in [ANDROID_APPIUM.md](./ANDROID_APPIUM.md). Before claiming platform completion, rerun the full workspace gate:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

The audit is not a substitute for the remaining product work; it is the checklist used to prevent a passing unit suite from being mistaken for completion of the full design.

Latest evidence from the current working tree:

- `pnpm lint`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check` passed (`228` tests passed, `2` skipped).
- A real browser session loaded a server-backed Manifest, edited YAML, saved it, and queued a run.
- A real Runner leased a server job, executed the immutable Manifest snapshot in the rebuilt Docker image, uploaded generated code/report artifacts, and exposed passed status, failures, steps, and artifact metadata through the tenant API.
- PostgreSQL live smoke persisted one `test_results` row and one `step_results` row; the result was then read back through the API with RLS enabled.
- The AI Worker workflow passed focused tests for safe validation/run/publish gating, and `GitWorkspaceManager` cloned and checked out the repository's real `main` commit in a temporary workspace.

The remaining rows above are explicit scope or external-environment gates, not hidden failures: iOS needs an available XCUITest device/simulator, GitHub sync needs live installation/webhook persistence, editor advanced views need the remaining UI implementation, and release/storage retention need their production matrix and lifecycle services.
