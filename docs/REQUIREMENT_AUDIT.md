# Design requirement audit

This is the live audit of the attached platform design against `main`. It is intentionally explicit about external gates and areas that are not yet complete.

| Design area | Current evidence | Status |
| --- | --- | --- |
| Manifest schema and stable IDs | `packages/manifest-schema`, AJV tests, YAML parser/normalizer | Implemented for the supported v1 action set |
| Web/API/control-flow execution | Playwright adapter, API adapter, complex fixture flow and generated Playwright run | Implemented for supported actions |
| Mobile Manifest path | Mobile schema, WebdriverIO generator, Local Runner branch, Appium adapter, real Android gate | Android implemented; iOS requires an available XCUITest device/simulator |
| Mobile failure evidence | Screenshot, page source, activity, Appium/logcat, unavailable reasons, locator metadata | Implemented and tested |
| Local HTML report | Report package and local runner artifacts | Implemented |
| Server tenant API | Fastify routes, tenant checks, runner queue, artifact store, manifest CRUD, result failures/steps | Implemented in-memory; PostgreSQL persistence is partial |
| MCP contract | 19 declared tools and live `tools/list` smoke test | Implemented; some server resources still expose minimal records |
| GitHub App | Real installation credentials, branch/commit/PR/check/comment smoke flow | Implemented for the exercised adapter flow; full sync/permission persistence remains partial |
| Distributed Runner | Registration, heartbeat, lease, completion, artifact upload, Docker deny-by-default args | Implemented as protocol/runtime foundation; full server-to-container manifest execution remains partial |
| AI Worker | Policy gate and repair proposal validation | Implemented as a guarded adapter; full clone/Claude/re-run/PR workflow remains partial |
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
