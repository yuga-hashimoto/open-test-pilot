# Full Design Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every requirement in the attached OpenTestPilot design from a code-only or policy-gated state to an executable, independently verified state, while preserving the local mode and tenant-safe contracts.

**Architecture:** Extend the existing Manifest/Generator/Runner contracts instead of adding UI-only behavior. Complete the server-backed editor and GitHub workflow through explicit repository interfaces, add release and CI evidence as executable jobs, and treat unavailable iOS hardware or external credentials as capability checks with truthful results rather than simulated passes.

**Tech Stack:** TypeScript strict mode, pnpm, Vitest, Playwright, Fastify, PostgreSQL/RLS, Redis, Docker, GitHub REST/App, React/Vite, WebdriverIO/Appium, Helm, npm packaging.

## Global Constraints

- Git is the source of truth; generated code stores the originating commit SHA.
- Tenant-owned reads and writes require organization context and membership in hosted mode.
- Shared Runner execution is Docker-isolated and rejects host execution.
- Repair proposals may modify YAML manifests and source maps only unless explicit approval is present.
- No external telemetry, secret-bearing fixtures, silent mocks, TODO stubs, or weakened assertions.
- Every task ends with focused tests, a real integration check when the capability exists, and an audit update.

### Task 1: Complete executable Manifest DSL coverage

**Files:**
- Modify: `packages/manifest-schema/src/index.ts`
- Modify: `packages/generator/src/index.ts`
- Modify: `packages/manifest-parser/src/index.ts`
- Test: `packages/manifest-schema/src/index.test.ts`
- Test: `packages/generator/src/index.test.ts`
- Test: `packages/cli/src/index.test.ts`
- Modify: `examples/manifests/complex-flow.yaml`

**Interfaces:** `ManifestAction`, `ManifestFunction`, `createManifestValidator`, `generatePlaywright`, and `testpilot run` remain the public boundary. Generated TypeScript must compile and execute every supported control node, including `switch`, `while`, `retry`, `try/catch/finally`, `timeout`, `parallel`, `race`, `break`, `continue`, `return`, variable assignment, function calls, JSONPath outputs, and multiple assertions.

- [x] Add a manifest fixture containing one stable-ID node for each control form and assertions for bounded-loop requirements.
- [x] Run the focused schema/generator tests and record the validation and generated-code behavior.
- [x] Implement the schema invariants and generator blocks, including `else`, `catch`, `finally`, loop-scope, timeout, and output semantics.
- [x] Generate the fixture, compile the generated TypeScript, and execute it against the real fixture server with Chromium.
- [x] Commit the generated snapshot and update `docs/MANIFEST_DSL_SPEC.md` with the supported forms.

### Task 2: Finish server-backed GitHub and editor workflow

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/postgres.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/main.tsx`
- Test: `apps/server/src/index.test.ts`
- Test: `apps/web/src/api.test.ts`
- Modify: `docs/GITHUB_INTEGRATION.md`

**Interfaces:** GitHub App operations use `GitHubApiClient`; repository, branch, commit, pull-request, check, comment, and manifest records remain organization-scoped. The UI must expose edit, diff, PR creation, result, failure, step, artifact, and report routes without mock-only data when a server is configured.

- [x] Add tenant-safe repository sync, branch/commit metadata, PR intent, Check, Status, and comment boundaries with explicit response-ID validation.
- [x] Add API methods and live UI controls for Manifest edit, diff, schedule/run evidence, artifact bodies, and reports; URL-encode path identifiers.
- [x] Exercise the installed GitHub App surface in the existing authenticated setup and record installation `146977164`.
- [ ] Complete OAuth/session → real GitHub App token → branch/PR/Check/status/comment browser flow; blocked by unavailable current Chrome session/private-key approval, not by local code.

### Task 3: Complete storage lifecycle, result import, and administration surfaces

**Files:**
- Modify: `packages/storage-adapter/src/index.ts`
- Modify: `packages/result-importer/src/index.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/web/src/main.tsx`
- Test: `packages/storage-adapter/src/index.test.ts`
- Test: `packages/result-importer/src/index.test.ts`
- Test: `apps/server/src/index.test.ts`

**Interfaces:** Storage keys are tenant-prefixed; retention deletion returns an auditable count; imported JUnit/Vitest/Unit/Component/Integration results map to the versioned Result Protocol; artifact lists, downloads, purge actions, and deletion audit entries are visible through the API/UI.

- [x] Add result-importer coverage for JUnit, Vitest, Unit, Component, and Integration input variants and stable source mappings.
- [x] Add retention purge, deletion audit events, and server tests for tenant isolation and dry-run behavior.
- [x] Add live Web artifact/evidence views for uploaded screenshots, traces, DOM, accessibility, logs, network, generated code, failures, and reports.
- [x] Run PostgreSQL/Redis/S3-compatible MinIO smoke tests with actual external services; local in-memory and local-storage paths are also verified.

### Task 4: Make CI/release artifacts executable

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `scripts/verify-generated-snapshots.mjs`
- Create: `scripts/check-dependency-licenses.mjs`
- Create: `scripts/build-release-artifacts.mjs`
- Modify: `package.json`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/OSS_GOVERNANCE.md`

**Interfaces:** CI must execute lint, typecheck, unit, integration, E2E, Manifest schema, migration, generated snapshot, Docker, security, dependency-license, npm package, documentation, and example-project checks. Release output must contain npm tarballs, CLI, plugin, Docker/Compose, Helm, migration guide, changelog, and a machine-readable manifest.

- [x] Add deterministic generated-code snapshot verification and run it locally.
- [x] Add dependency license and security checks; the current audit has no high-severity findings.
- [x] Build release artifacts and verify the CLI tarball output.
- [x] Add the same quality gates to GitHub Actions and validate the workflow YAML locally.

### Task 5: Execute all available acceptance scenarios and audit evidence

**Files:**
- Modify: `docs/REQUIREMENT_AUDIT.md`
- Modify: `docs/MASTER_IMPLEMENTATION_PLAN.md`
- Create: `docs/ACCEPTANCE_EVIDENCE.md`

- [x] Run the real personal Web scenario, including a real failure, evidence inspection, Codex Manifest repair, and successful rerun.
- [x] Run the real team PostgreSQL/Redis/MinIO scenario; complete the GitHub App write scenario when external credentials are available.
- [x] Run the real complex-flow and remote-Docker scenarios, verifying uploaded artifacts and stored results.
- [x] Run Android Appium; iOS capability probe is recorded as unavailable because no XCUITest simulator/device is configured.
- [x] Run the AI Worker with the configured Codex adapter and verify analyze-failure, Manifest-only repair, validation, execution, and result upload; branch/PR publication remains GitHub-gated.
- [x] Complete the requirement-by-requirement audit; the remaining unchecked items are external capability gates listed above.

### Task 6: Make scheduled execution operational

**Files:**
- Create: `apps/scheduler/src/index.ts`
- Modify: `packages/trigger-adapter/src/index.ts`
- Modify: `infra/docker/docker-compose.yml`
- Create: `infra/docker/Dockerfile.scheduler`

- [x] Add deterministic five-field cron matching with wildcard, list, range, step, Sunday `0/7`, and standard day-field OR semantics.
- [x] Add tenant-scoped scheduler polling, trigger calls, minute-level duplicate prevention, and an explicit environment-driven daemon entrypoint.
- [x] Add focused unit tests, build the scheduler Docker image, and run a real poll/trigger smoke against the live server.
