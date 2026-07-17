# Design requirement audit

This is the current audit of the attached platform design against `main`. It records only evidence that was re-run in this working session; external gates are deliberately not marked complete.

## Current verification (2026-07-17)

| Area | Current evidence | Status |
| --- | --- | --- |
| Manifest/DSL | AJV schema, YAML parser, generated TypeScript, nested control-flow and custom-action tests | Implemented for the supported v1 action set |
| Source-first generation | Web and API CLI runs produced schema-valid Manifests with executable actions. The API fixture covers OpenAPI/Swagger/Postman/GraphQL and REST client discovery; the web fixture covers Next.js-style routes and controls. Analyzer tests now cover Next.js App/Pages signals, React Router/Vue/Angular/Remix/Nuxt patterns, Android manifest/navigation/Retrofit, Flutter Bloc/Riverpod/Dio, and iOS URLSession/Alamofire | Implemented for the supported heuristic analyzers; broad framework inference remains an extension point |
| Web/API execution | `complex-flow.yaml` ran locally as `run-1784243071149-iwqizq`, passed with 5 steps and 9 artifacts including screenshot, trace, network log, generated code, and source map | Passed |
| Team API/editor | Live browser loaded the tenant API, edited Natural language, saved the Manifest, viewed Generated TS and Graph, selected a real run, opened uploaded artifact blobs, and used the live schedule `Run now →` control. Fresh Playwright acceptance loaded org `org-91dfe523-0d7f-4c82-b32c-c06062325b95`, opened test `test-754e97eb-a2db-4bb3-8cb4-97e5cfe80def`, displayed the new Versions tab, and rendered action detail for run `run-581e65fc-c153-40c4-ad35-a4d51257a444` | Passed for current server-backed editor, version history, overview, schedule, and evidence surface |
| Server result/artifacts | Run `run-eb6ac2d4-93c9-4933-921b-d05b8bb72fae` completed through register → lease → upload 11 artifacts → complete; report SHA256 verified as `3814b80b9b03b26783eec74bf3370a9ecd771f03c57e2909534bd963c2444699` | Passed in the in-memory server path |
| Manifest history and run detail | Tenant-safe `GET /v1/tests/:id/manifest/versions` reads versioned manifests from memory or PostgreSQL `test_versions`; tenant-safe `GET /v1/runs/:runId/result` returns structured step/action evidence, and the Runs view renders the selected run's action detail | API, repository, Web API client, and UI tests passed |
| PostgreSQL/Redis/S3 | External acceptance server on PostgreSQL `15432`, Redis `16379`, and MinIO `19000` created org `814d05eb-a781-4f49-9dca-271cc893673f`, registered runner `runner-30bec4c5-fb79-4680-bb99-4ad08f36072b`, leased job `job-7c846bea-2a6d-44dc-b68b-bd88f6ca97bc`, uploaded/fetched one S3 artifact, and completed run `7c846bea-2a6d-44dc-b68b-bd88f6ca97bc` as passed | Passed with real external services; production deployment remains environment-specific |
| Distributed Docker Runner | Fresh `docker build` passed for both runner/server images. Latest `test:docker:smoke` run `run-29dd69fd-a2e9-4181-b6a1-94ec1c4c3e3a` passed through the rebuilt Docker runner → Chromium → artifact upload with 8 artifacts and 0 failures | Passed |
| Runner fleet UI/API | Added tenant-safe `GET /v1/organizations/:organizationId/runners`; queue and server tests cover registration/listing/tenant isolation, and the web UI consumes the live list | Implemented |
| GitHub App | Existing Chrome session showed `OpenTestPilot E2E` installed for `yuga-hashimoto/open-test-pilot`, installation `146977164`, with Checks, Contents, statuses, Issues, and Pull requests write permissions. The adapter now reads repository files and paginated open/closed/all PR history. A real GitHub API smoke using the existing `gh` session read `yuga-hashimoto/open-test-pilot`, `examples/manifests/fixture-login.yaml` (SHA `7137a60e9e40ea1360a7301905963dd3ed3a6846`), and one closed PR. The fresh server + Web GitHub view also exposes tenant-safe content/history routes and truthful `503` write gates. | Read path passed against real GitHub; installation and local UI/API boundaries passed; JWT write/check/comment/PR smoke is pending private-key handling |
| GitHub run notification | Added tenant-safe `POST /v1/runs/:runId/github-notify`, which creates Check Run, commit status, and optional issue comment through the App token | Code/test gate passed; live write not yet performed |
| AI Worker | `CodexCodeWorker` request `repair-live-2` read the real failed run `run-1784247101958-1ldk4f`, identified the accessible name `ログイン`, returned a correlated structured AgentResult with a Manifest-only repair, and the validated proposal passed as local run `run-1784247382599-ctpnx1`. A fresh real workflow request `codex-real-1784279967195` cloned/fetched the repository, ran the actual Codex CLI in the prepared workspace, applied its proposed Manifest, validated it, and reran Chromium successfully as `run-1784280036815-bqz59z` with 3 artifacts. The new tenant-safe job API was also exercised end-to-end through create → lease → real Codex analyze-failure → complete on both in-memory and PostgreSQL repositories. | Failure analysis → Codex repair → secure Manifest application → validation → Chromium rerun and persisted AI Worker lifecycle passed; GitHub PR publication remains gated on live App credentials |
| Mobile | Android gate passed on `emulator-5554` (Android 16/API 36) with Appium 3.5.2 + UiAutomator2 8.1.0: direct selector assertion and Manifest launch/assert/screenshot both passed; PNG/page-source/activity/logcat evidence captured under `packages/appium-adapter/.testpilot/mobile-integration/`. iOS was attempted on a real iOS 26.4 simulator with Appium 3.5.2 + XCUITest 11.17.7; WDA `xcodebuild` reached `TEST BUILD SUCCEEDED`, but the XCTest runner did not listen on the forwarded port and Appium timed out creating the session. | Android execution verified; iOS implementation and Xcode build are verified, while WDA runtime startup remains an environment gate |
| Schedules/triggers | Schedule CRUD and cron validation are covered. Live server smoke called `POST /v1/schedules/:scheduleId/trigger` and returned `202`, `trigger: schedule`, and queued run `run-7b49ef35-6221-4c20-8885-11680d9d5c01`; the rebuilt browser `Run now →` control created queued run `run-8003cffc-647f-433c-87e0-7ac0ebac85dd`; the scheduler daemon matched `* * * * *`, created `run-11bdee7b-d660-4e14-b34c-aae0bb12fd33`, and deduplicated the same minute; webhook signature verification is covered | API/UI/daemon trigger paths passed; production uptime/monitoring and signed webhook deployment remain external operational gates |
| Storage/secrets | Local/S3 adapters, provider SDKs, masking, retention, tenant secret CRUD/rotation, encrypted in-memory/PostgreSQL storage, write-only Web UI, and audit events are implemented; plaintext is absent from responses and browser-rendered state. Manifest references are resolved at execution time through injected providers, with env-name fallback for env-backed refs. Custom Action permissions now gate network/filesystem/secrets access, and resolved secret values are redacted from returned run evidence and console/network/runner logs. HTTP integration tests verify the injected token is used without entering the result | Provider-specific external secret lookup and production key rotation remain deployment-specific; runner deployment must supply the corresponding provider registry |
| Tenant administration | Live Settings view loaded projects/members/storage/audit/AI worker data; retention update persisted; secret creation was exercised in a real browser without rendering plaintext | Passed for current tenant-safe administration surface |
| Runner cancellation/concurrency | Scheduler test enforces runner `maxConcurrency`; the real Redis queue on port `16379` completed register → enqueue → lease → cancel and persisted job `job-redis-cancel-1` as `cancelled` | Passed in unit/server tests and live Redis smoke |
| CI/release | CI, docs, generated snapshot, license, security, and release scripts exist | Final fresh command matrix is listed below and must pass before merge |

## Required local gate

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:generated
pnpm license:report
pnpm release:artifacts
pnpm security:audit
git diff --check
```

Passing this gate does not imply that GitHub writes, mobile devices, production PostgreSQL/Redis, or production storage credentials are available. Those require the live gates listed above.
