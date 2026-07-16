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

- [ ] Add a manifest fixture containing one stable-ID node for each control form and assertions for bounded-loop requirements.
- [ ] Run `pnpm test -- packages/manifest-schema/src/index.test.ts packages/generator/src/index.test.ts` and record the failing validation or generated-code behavior.
- [ ] Implement the missing schema invariants and generator blocks, including correct `else`, `catch`, `finally`, loop-scope, timeout, and output semantics.
- [ ] Generate the fixture, compile the generated TypeScript with the workspace compiler, and execute it against the real fixture server with Chromium.
- [ ] Commit the generated snapshot and update `docs/MANIFEST_DSL_SPEC.md` with the exact supported forms.

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

- [ ] Add authenticated repository sync, branch/commit metadata, PR creation, Check, Status, and comment routes with explicit response-ID validation.
- [ ] Add API methods and UI controls for the PR workflow and run evidence; URL-encode every path identifier.
- [ ] Exercise the flow against a real GitHub App installation when credentials are present; otherwise run the adapter contract and report the exact capability gate.
- [ ] Re-run the browser flow from OAuth/session configuration through Manifest edit, diff, PR intent, run, artifact, and report retrieval.

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

- [ ] Add result-importer coverage for JUnit, Vitest, Unit, Component, and Integration input variants and stable source mappings.
- [ ] Add retention policy records, purge endpoint, deletion audit event, and server tests for tenant isolation and dry-run behavior.
- [ ] Add Web artifact/evidence views for screenshots, traces, DOM, accessibility, logs, network, locator, retry, and diff metadata.
- [ ] Run local storage and S3-compatible MinIO smoke tests with actual put/get/delete/purge operations.

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

- [ ] Add deterministic generated-code snapshot verification and run it locally.
- [ ] Add dependency license and security checks that fail on unknown or disallowed licenses.
- [ ] Build release artifacts into a clean temporary directory and verify every required file is present.
- [ ] Add the same commands to GitHub Actions and validate the workflow YAML locally.

### Task 5: Execute all available acceptance scenarios and audit evidence

**Files:**
- Modify: `docs/REQUIREMENT_AUDIT.md`
- Modify: `docs/MASTER_IMPLEMENTATION_PLAN.md`
- Create: `docs/ACCEPTANCE_EVIDENCE.md`

- [ ] Run the real personal Web scenario, including a real failure, evidence inspection, manifest repair, and successful rerun.
- [ ] Run the real team PostgreSQL/Redis/Runner scenario and the GitHub App scenario when credentials are available.
- [ ] Run the real complex-flow and remote-Docker scenarios, verifying uploaded artifacts and stored results.
- [ ] Run Android Appium and, if an iOS simulator/device exists, iOS XCUITest; otherwise record the executable capability probe and exact blocker.
- [ ] Run the AI Worker with the configured Codex/OpenCode/Claude adapter and verify clone, analyze, validate, execute, branch, and PR boundaries.
- [ ] Complete a requirement-by-requirement audit and only then decide whether the goal can be marked complete.
