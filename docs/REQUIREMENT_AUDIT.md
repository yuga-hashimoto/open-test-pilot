# Design requirement audit

This is the live audit of the attached platform design against `main`. It is intentionally explicit about external gates and areas that are not yet complete.

| Design area | Current evidence | Status |
| --- | --- | --- |
| Manifest schema and stable IDs | `packages/manifest-schema`, AJV tests, YAML parser/normalizer | Implemented for the supported v1 action set |
| Web/API/control-flow execution | Playwright adapter, API adapter, complex fixture flow and generated Playwright run | Implemented for supported actions |
| Mobile Manifest path | Mobile schema, WebdriverIO generator, Local Runner branch, Appium adapter, real Android gate | Android implemented; iOS requires an available XCUITest device/simulator |
| Mobile failure evidence | Screenshot, page source, activity, Appium/logcat, unavailable reasons, locator metadata | Implemented and tested |
| Local HTML report | Report package and local runner artifacts | Implemented |
| Server tenant API | Fastify routes, tenant checks, tenant-isolated queue, artifact store, manifest CRUD, result failures/steps; PostgreSQL repository and forced RLS live smoke; result persistence adapters | Core run/result/artifact plus schedules, change requests, repairs, and pull-request records persist through InMemory/PostgreSQL repositories; restart smoke and tenant isolation are verified. `AUTH_REQUIRED=true` enforces a short-lived GitHub OAuth session and organization membership; local mode keeps the explicit tenant-header path |
| MCP contract | 19 declared tools and live `tools/list` smoke test | Implemented; some server resources still expose minimal records |
| GitHub App | Real installation credentials, branch/commit/PR/check/comment smoke flow | Repository metadata and installation access are persisted and synced through a read-only live GitHub App flow; branch/PR/check/comment writes remain policy-gated adapters |
| Distributed Runner | Registration, heartbeat, lease, completion, immutable manifest snapshot, Docker execution, generated/report artifact upload, result/failure/step retrieval, explicit manifest network permission | Implemented for server → Runner → Docker → result/artifact flow, Redis lease expiry reassignment, tenant/capability matching, and heartbeat keepalive; durable retry policy remains an operational gate |
| AI Worker | Policy gate, repair proposal validation, injectable clone/fetch/checkout → Claude → validate → run → optional YAML-only PR workflow | Guarded workflow is implemented and tested; production Claude credentials, repository token injection, and automatic retry/reassignment remain external gates |
| Web editor | Live YAML manifest load/save and tests/runs/schedules views | Tree, Monaco YAML, generated TypeScript, graph, and diff views are implemented; real browser edit/save persisted to the team API; PR workflow and full evidence screens remain partial |
| Storage/secrets | Local/S3-compatible adapters, secret provider SDK, redaction helpers | Local/S3 retention purge plus Vault, AWS Secrets Manager, Google Secret Manager, Azure Key Vault, GitHub Actions, encryption/rotation/masking are implemented and unit-tested; retention administration UI remains partial |
| CI/release | CI workflow, Dockerfiles/Compose, Helm values/templates, OSS governance docs | CI now has explicit plugin/package, docs/Helm, Manifest contract, and clean PostgreSQL migration/RLS gates; signed release/publish automation remains further work |

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

- `pnpm lint`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check` pass on this working tree (39 test files, 268 tests including 2 skips).
- A real browser session loaded a server-backed Manifest, edited YAML, saved it, and queued a run.
- A real Runner leased a server job, executed the immutable Manifest snapshot in the rebuilt Docker image, uploaded generated code/report artifacts, and exposed passed status, failures, steps, and artifact metadata through the tenant API.
- PostgreSQL live smoke persisted one `test_results` row and one `step_results` row; the result was then read back through the API with RLS enabled.
- A live PostgreSQL-backed Repository synced through the configured GitHub App and persisted the GitHub repository ID and installation ID; the installation list API returned one accessible repository.
- A real Android Appium 3.5.2 session on `emulator-5554` ran the CLI Manifest path and produced an HTML report with screenshot evidence.
- A real browser exercised the editor Tree, Monaco YAML, Generated TypeScript, Graph, and Diff views; Monaco edit/save persisted an edited Manifest through the live tenant API.
- A clean temporary PostgreSQL database accepted migrations 001 through 008 in order; schedules, change requests, pull requests, and repair attempts reported both RLS enabled and forced, and `auth_sessions` was present.
- The rebuilt `opentestpilot-server:local` and `opentestpilot-runner:local` images passed build; the Runner image executed a host-reachable Chromium job and returned a passed result with seven container artifacts.
- The AI Worker workflow passed focused tests for safe validation/run/publish gating, and `GitWorkspaceManager` cloned and checked out the repository's real `main` commit in a temporary workspace.

The remaining rows above are explicit scope or external-environment gates, not hidden failures: iOS needs an available XCUITest device/simulator, Monaco/PR workflow needs the hosted editor lane, and release/storage administration need their production matrix and lifecycle UI.
