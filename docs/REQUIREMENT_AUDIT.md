# Design requirement audit

This is the current audit of the attached platform design against `main`. It records only evidence that was re-run in this working session; external gates are deliberately not marked complete.

## Current verification (2026-07-17)

| Area | Current evidence | Status |
| --- | --- | --- |
| Manifest/DSL | AJV schema, YAML parser, generated TypeScript, nested control-flow and custom-action tests | Implemented for the supported v1 action set |
| Source-first generation | `testpilot source analyze examples/fixtures/web/server.mjs --framework nextjs --output /tmp/opentestpilot-generated.yaml` produced a schema-valid Manifest with source findings and executable actions | Implemented for the supported heuristic analyzers; broad framework inference remains an extension point |
| Web/API execution | `complex-flow.yaml` ran locally as `run-1784243071149-iwqizq`, passed with 5 steps and 9 artifacts including screenshot, trace, network log, generated code, and source map | Passed |
| Team API/editor | Live browser loaded the tenant API, edited Natural language, saved the Manifest, viewed Generated TS and Graph, selected a real run, opened uploaded artifact blobs, and used the live schedule `Run now →` control | Passed for current server-backed editor, overview, schedule, and evidence surface |
| Server result/artifacts | Run `run-eb6ac2d4-93c9-4933-921b-d05b8bb72fae` completed through register → lease → upload 11 artifacts → complete; report SHA256 verified as `3814b80b9b03b26783eec74bf3370a9ecd771f03c57e2909534bd963c2444699` | Passed in the in-memory server path |
| PostgreSQL/Redis/S3 | External acceptance server on PostgreSQL `15432`, Redis `16379`, and MinIO `19000` created org `814d05eb-a781-4f49-9dca-271cc893673f`, registered runner `runner-30bec4c5-fb79-4680-bb99-4ad08f36072b`, leased job `job-7c846bea-2a6d-44dc-b68b-bd88f6ca97bc`, uploaded/fetched one S3 artifact, and completed run `7c846bea-2a6d-44dc-b68b-bd88f6ca97bc` as passed | Passed with real external services; production deployment remains environment-specific |
| Distributed Docker Runner | Fresh `docker build` passed for both runner/server images. Latest `test:docker:smoke` run `run-29dd69fd-a2e9-4181-b6a1-94ec1c4c3e3a` passed through the rebuilt Docker runner → Chromium → artifact upload with 8 artifacts and 0 failures | Passed |
| Runner fleet UI/API | Added tenant-safe `GET /v1/organizations/:organizationId/runners`; queue and server tests cover registration/listing/tenant isolation, and the web UI consumes the live list | Implemented |
| GitHub App | Existing Chrome session showed `OpenTestPilot E2E` installed for `yuga-hashimoto/open-test-pilot`, installation `146977164`, with Checks, Contents, statuses, Issues, and Pull requests write permissions | Installation proof passed; JWT write/check/comment/PR smoke is pending GitHub Mobile sudo approval and private-key handling |
| GitHub run notification | Added tenant-safe `POST /v1/runs/:runId/github-notify`, which creates Check Run, commit status, and optional issue comment through the App token | Code/test gate passed; live write not yet performed |
| AI Worker | `CodexCodeWorker` request `repair-live-2` read the real failed run `run-1784247101958-1ldk4f`, identified the accessible name `ログイン`, returned a correlated structured AgentResult with a Manifest-only repair, and the validated proposal passed as local run `run-1784247382599-ctpnx1` | Failure analysis → Codex repair → Manifest rerun passed; GitHub PR publication remains gated on live App credentials |
| Mobile | Android gate passed on `emulator-5554` (Android 16/API 36) with Appium 3.5.2 + UiAutomator2 8.1.0: direct selector assertion and Manifest launch/assert/screenshot both passed; PNG/page-source/activity/logcat evidence captured under `packages/appium-adapter/.testpilot/mobile-integration/` | Android execution verified; iOS remains protocol/code-generation only because no XCUITest simulator/device is configured |
| Schedules/triggers | Schedule CRUD and cron validation are covered. Live server smoke called `POST /v1/schedules/:scheduleId/trigger` and returned `202`, `trigger: schedule`, and queued run `run-7b49ef35-6221-4c20-8885-11680d9d5c01`; the rebuilt browser `Run now →` control created queued run `run-8003cffc-647f-433c-87e0-7ac0ebac85dd`; webhook signature verification is covered | API/UI trigger path passed; automatic cron daemon and signed webhook deployment remain external operational gates |
| Storage/secrets | Local/S3 adapters, provider SDKs, masking, and retention code are tested; MinIO put/get/delete and the external server artifact round trip passed | Production provider credentials and full administration UI remain deployment-specific |
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
