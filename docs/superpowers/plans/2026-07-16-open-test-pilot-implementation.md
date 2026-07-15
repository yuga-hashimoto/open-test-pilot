# OpenTestPilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement OpenTestPilot as a self-hostable, agent-neutral test automation platform whose first production slice validates YAML manifests, generates standard Playwright TypeScript, executes local Chromium tests, and stores inspectable evidence while preserving the contracts needed for the complete platform.

**Architecture:** A pnpm TypeScript monorepo separates Manifest, generator, result, agent, runner, adapter, report, CLI, server, and UI packages. The local runner is the first concrete Runner Protocol implementation; future server-managed and self-hosted runners consume the same versioned envelopes. GitHub App, PostgreSQL, object storage, secrets, scheduling, Appium, and AI Worker integrations are added behind interfaces and vertical tests rather than replacing the local path.

**Tech Stack:** Node.js LTS, pnpm workspaces, TypeScript strict mode, Vitest, AJV, YAML CST parser, Playwright, WebdriverIO/Appium, Fastify, PostgreSQL, Redis-compatible queue, React/Next.js, Monaco, React Flow, Docker, Kubernetes, OpenTelemetry with opt-in destinations only, GitHub OAuth and GitHub App.

## Global Constraints

- TypeScript strict mode; `any` is prohibited in authored public code.
- Manifest, API, Event, Agent, Runner, and Result protocols are versioned.
- YAML Manifest is the structured source of truth; JSON is the normalized internal representation.
- Generated code uses standard Playwright/Appium APIs and remains independently executable.
- All important entities carry `organizationId`; every query, queue key, storage key, and log context enforces tenant scope.
- Secrets are references only in Manifests and are injected at Runner execution time with redaction.
- Shared Runners execute user code inside Docker; host execution is restricted to explicitly trusted self-hosted Runners.
- Product code is never modified by automated repair without explicit approval.
- Repair must not delete or weaken assertions, skip tests, swallow exceptions, or add fixed long sleeps.
- No external telemetry is sent; observability exporters are opt-in and user-configured.
- Every implementation task writes tests before production code and runs focused plus workspace checks.

## File map

### Core packages

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`: workspace scripts and strict compiler/test configuration.
- `packages/manifest-schema/src/index.ts`, `schema.json`, `src/index.test.ts`: Manifest types, JSON Schema, version constants.
- `packages/manifest-parser/src/index.ts`, `src/index.test.ts`: YAML parser, normalization, diagnostics, interpolation validation.
- `packages/result-schema/src/index.ts`, `src/index.test.ts`: run, step, action, artifact, failure, and report contracts.
- `packages/generator/src/index.ts`, `src/index.test.ts`, `src/templates.ts`: deterministic TypeScript generation and source map.
- `packages/playwright-adapter/src/index.ts`, `src/index.test.ts`: browser action mapping and evidence hooks.
- `packages/local-runner/src/index.ts`, `src/index.test.ts`: local job lifecycle, artifact directory, result emission.
- `packages/report/src/index.ts`, `src/index.test.ts`, `src/template.ts`: safe static report generation.
- `packages/cli/src/index.ts`, `src/index.test.ts`: `manifest validate`, `manifest generate`, `run`, `report` commands.
- `packages/agent-protocol/src/index.ts`, `src/index.test.ts`: agent-neutral request/result envelopes.
- `packages/runner-protocol/src/index.ts`, `src/index.test.ts`: jobs, capabilities, leases, heartbeats, cancellation.
- `packages/storage-adapter/src/index.ts`, `packages/secret-provider-sdk/src/index.ts`, `packages/notification-adapter/src/index.ts`: provider interfaces.

### Platform packages

- `apps/server`: Fastify HTTP API, auth, tenant context, jobs, persistence, GitHub, webhooks, OpenAPI.
- `apps/web`: Next.js authenticated console and Manifest editor.
- `apps/runner`: trusted/self-hosted Runner process and Docker execution boundary.
- `apps/ai-worker`: Claude Code headless worker with policy enforcement.
- `packages/mcp-server`: compact MCP tools mapped to the HTTP/agent protocols.
- `packages/claude-code-plugin`: `.claude-plugin`, Skills, subagents, hooks, commands, MCP config, and CLI wrapper.
- `packages/appium-adapter`, `analyzers/*`: mobile adapters and source analyzers.
- `infra/*`: Postgres migrations, Docker Compose, object storage, Kubernetes, and observability manifests.

## Phase 0: Planning and governance

### Task P-001: Publish architecture and ADR set

**Files:**
- Create: `docs/superpowers/specs/2026-07-16-open-test-pilot-foundation-design.md`
- Create: `docs/adr/0001-package-boundaries.md`
- Create: `docs/adr/0002-local-runner-before-workflow-engine.md`
- Create: `docs/adr/0003-json-schema-and-yaml-cst.md`
- Create: `docs/adr/0004-postgres-tenant-isolation.md`
- Create: `docs/adr/0005-docker-shared-runner-isolation.md`
- Create: `docs/adr/0006-no-external-telemetry.md`

**Acceptance:** Each ADR states context, decision, alternatives, consequences, and the protocol affected. No architecture document claims later functionality is already implemented.

### Task P-002: Publish the complete documentation set

**Files:** Create the requested documents under `docs/`: `PRODUCT_REQUIREMENTS.md`, `SYSTEM_ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `DATABASE_DESIGN.md`, `MANIFEST_DSL_SPEC.md`, `GENERATED_CODE_SPEC.md`, `RUNNER_PROTOCOL.md`, `AGENT_PROTOCOL.md`, `MCP_API_SPEC.md`, `HTTP_API_SPEC.md`, `GITHUB_INTEGRATION.md`, `SECURITY_MODEL.md`, `MULTITENANCY.md`, `PLUGIN_SYSTEM.md`, `ARTIFACT_MODEL.md`, `WEB_EDITOR_SPEC.md`, `FAILURE_REPAIR_SPEC.md`, `TEST_STRATEGY.md`, `DEPLOYMENT.md`, and `OSS_GOVERNANCE.md`.

**Acceptance:** Each document contains concrete interfaces, invariants, test gates, and links to the master plan; no empty stubs or “to be decided” sections remain.

## Phase 1: Workspace and contracts

### Task C-001: Bootstrap the strict monorepo

**Files:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.editorconfig`, `README.md`, `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `GOVERNANCE.md`.

- [ ] Write a failing smoke test that imports a workspace package through TypeScript project references.
- [ ] Run `pnpm test` and verify failure because workspace packages do not exist.
- [ ] Add strict compiler options, package scripts (`lint`, `typecheck`, `test`, `build`), and Apache-2.0 governance files.
- [ ] Run `pnpm install`, `pnpm typecheck`, and `pnpm test`; verify the smoke test passes.

### Task C-002: Define the Result Protocol

**Files:** `packages/result-schema/package.json`, `packages/result-schema/src/index.ts`, `packages/result-schema/src/index.test.ts`.

- [ ] Test that a run contains stable IDs, commit/environment metadata, step/action results, artifact references, and one of the required failure categories.
- [ ] Test that secret values cannot be represented in artifact metadata and that invalid statuses are rejected.
- [ ] Implement typed discriminated unions and runtime validation with a versioned `resultProtocolVersion`.
- [ ] Run focused and workspace tests.

### Task C-003: Define Agent and Runner Protocols

**Files:** `packages/agent-protocol/*`, `packages/runner-protocol/*`.

- [ ] Test round-tripping generation, repair, run, heartbeat, lease, cancellation, and capability envelopes.
- [ ] Test duplicate job detection fields (`jobId`, `runId`, source revision) and organization-scoped correlation context.
- [ ] Implement versioned JSON-safe contracts with exhaustive operation/status unions.
- [ ] Run focused and workspace checks.

## Phase 2: Manifest and generation

### Task M-001: Implement Manifest Schema v1

**Files:** `packages/manifest-schema/*`, `examples/manifests/login.yaml`.

- [ ] Test required metadata, variables, secret references, setup/cleanup, business steps, action IDs, artifacts, runner requirements, permissions, source mapping, and generated-code metadata.
- [ ] Test rejection of secret literals and missing stable IDs.
- [ ] Implement JSON Schema and TypeScript types for the supported action set plus versioned reserved control nodes.
- [ ] Run AJV schema tests and snapshot the example normalization input.

### Task M-002: Implement YAML parsing and semantic validation

**Files:** `packages/manifest-parser/*`.

- [ ] Test YAML source locations, duplicate IDs, invalid interpolation tokens, unsupported action diagnostics, and deterministic normalized JSON.
- [ ] Implement CST-preserving parse diagnostics, normalization, and semantic validation without executing actions.
- [ ] Run focused tests and verify diagnostics include JSON pointer and line/column.

### Task M-003: Implement deterministic Playwright generation

**Files:** `packages/generator/*`, `examples/generated/*`.

- [ ] Test generated `web.goto`, `web.fill`, `web.click`, visibility/text assertions, API requests, step boundaries, and source-map mappings.
- [ ] Verify the test fails before generator implementation.
- [ ] Implement a typed intermediate representation and deterministic templates that emit standard Playwright code plus a generated README.
- [ ] Snapshot generated output and run TypeScript compilation on generated fixtures.

### Task M-004: Implement migration and diff commands

**Files:** `packages/manifest-migrator/*`, `packages/cli/src/commands/manifest/*`.

- [ ] Test dry-run migration preview, YAML diff, generated-code diff, explicit approval, and refusal to rewrite without approval.
- [ ] Implement schema-version migration registry and CLI commands `manifest migrate` and `manifest diff`.
- [ ] Run migration tests against at least two schema versions.

## Phase 3: Local execution and report

### Task R-001: Implement Playwright adapter

**Files:** `packages/playwright-adapter/*`.

- [ ] Test action dispatch against a local HTTP fixture and verify Chromium is the default while browser selection is configurable.
- [ ] Test step screenshots, failure screenshot, DOM, accessibility snapshot, URL, console, and network record paths.
- [ ] Implement thin Playwright context/fixture hooks and explicit cleanup on failure.
- [ ] Run adapter integration tests with installed Chromium.

### Task R-002: Implement Local Runner

**Files:** `packages/local-runner/*`, `.testpilot/.gitkeep`.

- [ ] Test run lifecycle, timeout, cancellation, retry metadata, failure classification, and generated-code artifact capture.
- [ ] Test an end-to-end local run creates `report.json`, evidence directories, and no files outside its run directory.
- [ ] Implement job orchestration over the Runner Protocol with local filesystem storage.
- [ ] Run the complete local fixture scenario.

### Task R-003: Implement local HTML report

**Files:** `packages/report/*`.

- [ ] Test success and failure report rendering, safe escaping, artifact links, step/action nesting, and absent optional artifacts.
- [ ] Implement a static HTML report with no external network requests.
- [ ] Run report tests and open the generated report in a local browser smoke test.

### Task R-004: Implement CLI vertical slice

**Files:** `packages/cli/*`, `examples/fixtures/*`, `README.md`.

- [ ] Test `testpilot manifest validate`, `manifest generate`, `testpilot run`, and `testpilot report` exit codes and output paths.
- [ ] Implement command composition using the core packages and document a local Web app flow.
- [ ] Run the full validate → generate → run → report scenario against the fixture app.

## Phase 4: Claude Code and plugin system

### Task A-001: Implement Claude Code Plugin surface

**Files:** `packages/claude-code-plugin/.claude-plugin/plugin.json`, `skills/*/SKILL.md`, `agents/*`, `hooks/*`, `commands/*`, `.mcp.json`, `bin/testpilot`.

- [ ] Test plugin manifest structure, required skills/subagents, and command dispatch help output.
- [ ] Implement repository analysis, design, manifest generation, code generation, run, failure analysis, repair, publish, review, and change-request instructions with safety rules.
- [ ] Run plugin validation and a local CLI invocation from the plugin bin directory.

### Task A-002: Implement agent-neutral MCP server

**Files:** `packages/mcp-server/*`, `docs/MCP_API_SPEC.md`.

- [ ] Test compact tools for organization/project/test/manifest/generated code, async run status/failures/steps, artifacts, repair, PR registration, and report URL.
- [ ] Implement MCP transport adapter over the Agent and Result Protocols; long operations return IDs.
- [ ] Run contract tests against an in-memory local service.

## Phase 5: Source analyzers and repair

### Task S-001: Implement analyzer SDK and JavaScript/TypeScript analyzer

**Files:** `packages/source-analyzer-sdk/*`, `analyzers/javascript/*`, `analyzers/nextjs/*`, `analyzers/react-router/*`, `analyzers/vue/*`, `analyzers/angular/*`.

- [ ] Test normalized route, component, API, form, locator, and source-file findings from fixtures.
- [ ] Implement plugin registry and AST-based extraction; screen exploration is a fallback only after source analysis.
- [ ] Run analyzer fixture tests.

### Task S-002: Implement failure evidence and repair policy

**Files:** `packages/failure-repair/*`, `docs/FAILURE_REPAIR_SPEC.md`.

- [ ] Test all required failure categories and forbidden repair transformations.
- [ ] Implement failure evidence bundle, repair-attempt counter, same-cause stop rule, and diff validation.
- [ ] Run repair policy tests with generated code and Manifest fixtures.

## Phase 6: Team server and tenancy

### Task T-001: Implement PostgreSQL schema and tenant context

**Files:** `apps/server`, `infra/postgres/migrations/*`, `packages/tenant-context/*`, `docs/DATABASE_DESIGN.md`, `docs/MULTITENANCY.md`.

- [ ] Test organization-scoped reads/writes, membership roles, project access, and cross-tenant denial.
- [ ] Implement migrations for the required entities, organization context middleware, repository-scoped keys, and audit logging.
- [ ] Run PostgreSQL integration tests with RLS or equivalent application-level enforcement documented by ADR.

### Task T-002: Implement HTTP API and OpenAPI

**Files:** `apps/server/src/*`, `packages/api-contracts/*`, `docs/HTTP_API_SPEC.md`.

- [ ] Test async run creation/status/failures/report URL, manifest CRUD/versioning, change requests, artifact metadata, and authorization.
- [ ] Implement Fastify routes and OpenAPI generation from shared schemas.
- [ ] Run API integration tests against PostgreSQL.

### Task T-003: Implement GitHub OAuth and GitHub App integration

**Files:** `apps/server/src/github/*`, `packages/github-adapter/*`, `docs/GITHUB_INTEGRATION.md`.

- [ ] Test OAuth identity mapping, installation ownership, repository sync, branch/PR/commit metadata, and permission loss.
- [ ] Implement OAuth-only authentication, GitHub App installation tokens, webhook signature validation, clone/fetch, PR/commit/check/status/comment adapters.
- [ ] Run contract tests with GitHub API fixtures and webhook replay tests.

## Phase 7: Web management and editor

### Task W-001: Implement authenticated Next.js console

**Files:** `apps/web/*`, `packages/shared-ui/*`.

- [ ] Test routes for login, organization/project, test list/detail, runs, runners, schedules, secrets, audit logs, and AI workers.
- [ ] Implement GitHub login callback and tenant-aware navigation.
- [ ] Run Playwright web E2E against the local server.

### Task W-002: Implement Manifest tree/YAML/TypeScript/graph editor

**Files:** `apps/web/src/editor/*`, `packages/editor-model/*`.

- [ ] Test edits to metadata, steps, actions, locators, expectations, variables, control nodes, artifacts, and runner requirements produce a validated Manifest.
- [ ] Implement tree editor as the default, Monaco YAML/TypeScript/custom code views, React Flow graph view, source mapping, diff display, and regenerate-on-save.
- [ ] Run editor E2E and schema/generator snapshot tests.

### Task W-003: Implement PR-based change workflow

**Files:** `apps/server/src/change-requests/*`, `apps/web/src/change-requests/*`.

- [ ] Test branch creation, diff, protected-branch refusal, PR registration, status updates, and direct-commit project policy.
- [ ] Implement default dedicated branches and explicit direct-commit opt-in.
- [ ] Run GitHub adapter integration tests with webhook replay.

## Phase 8: Distributed Runner, storage, secrets, and scheduling

### Task D-001: Implement storage and redaction adapters

**Files:** `packages/storage-adapter/*`, `packages/artifact-redaction/*`, `packages/secret-provider-sdk/*`, `infra/object-storage/*`.

- [ ] Test local, S3-compatible, and MinIO adapters, retention policies, capacity limits, deletion audit events, secret redaction, and sensitive-field masking.
- [ ] Implement metadata-only DB references and pluggable object storage/secret providers.
- [ ] Run adapter tests with MinIO and a local encrypted secret provider.

### Task D-002: Implement Runner registration, leases, and scheduler

**Files:** `apps/server/src/scheduler/*`, `apps/runner/*`, `packages/scheduler/*`.

- [ ] Test priority, labels/capabilities, organization/project concurrency, timeout, cancel, retry, heartbeat loss, fair scheduling, leases, and duplicate prevention.
- [ ] Implement queue and state machine; use a Redis-compatible backend first and keep the durable workflow interface replaceable.
- [ ] Run multi-runner integration tests including disconnect reassignment.

### Task D-003: Implement Docker-isolated shared Runner

**Files:** `apps/runner/src/execution/*`, `infra/docker/*`, `infra/docker-compose/*`.

- [ ] Test declared network/filesystem/secret permissions, CPU/memory/time limits, and host-execution refusal for shared mode.
- [ ] Implement container execution with artifact streaming and trusted host mode only for administrator-configured self-hosted runners.
- [ ] Run container integration tests with a fixture job.

## Phase 9: Mobile, API, and imported results

### Task X-001: Implement API adapter and mixed-flow execution

**Files:** `packages/api-adapter/*`, generator/runtime extensions, examples.

- [ ] Test request methods, headers, query/path/body, status assertions, JSON Schema assertions, extraction, redaction, and cleanup.
- [ ] Implement standard TypeScript HTTP execution and mixed Web+API orchestration.
- [ ] Run fixture API integration tests.

### Task X-002: Implement Appium/WebdriverIO adapter

**Files:** `packages/appium-adapter/*`.

- [ ] Test Android and iOS locator mapping, screenshot, page source, activity/view controller metadata, log collection, and failure artifact links.
- [ ] Implement generated Appium TypeScript using WebdriverIO and capability-driven device selection.
- [ ] Run emulator/simulator integration tests when devices are available; otherwise run protocol tests without claiming device completion.

### Task X-003: Implement Android, Flutter, and iOS analyzers

**Files:** `analyzers/android/*`, `analyzers/flutter/*`, `analyzers/ios/*`.

- [ ] Test extraction of required Activity/Compose/resource ID, Flutter route/widget/key/semantics, and SwiftUI/UIKit/accessibility/API findings.
- [ ] Implement analyzer plugins normalized to the common source-finding schema.
- [ ] Run fixture analysis tests.

### Task X-004: Implement imported Unit/Component/Integration results

**Files:** `packages/result-importers/*`, `apps/server/src/imports/*`.

- [ ] Test Vitest, Jest, JUnit, and generic JUnit-style result normalization.
- [ ] Implement import adapters with commit/run correlation and artifact metadata.
- [ ] Run importer contract tests.

## Phase 10: AI Worker, schedules, notifications, and release

### Task AI-001: Implement Self-hosted Claude Code AI Worker

**Files:** `apps/ai-worker/*`, `packages/claude-adapter/*`.

- [ ] Test organization/repository/branch/runner/secret/policy scoping, max repair attempts, app-code-change refusal, and PR opt-in.
- [ ] Implement clone → headless Claude Code → validate → run → branch → PR → result registration flow using the Agent Protocol.
- [ ] Run worker integration tests with a fake Claude process and real local runner; keep production process adapter explicit.

### Task AI-002: Implement schedules, API triggers, webhooks, and notifications

**Files:** `apps/server/src/triggers/*`, `packages/notification-adapter/*`.

- [ ] Test cron, push, PR, API, webhook, Web, and CLI triggers, deduplication, authorization, and official notification channels only.
- [ ] Implement trigger adapters and Web/GitHub Checks/Status/PR comment notification providers.
- [ ] Run trigger replay and idempotency tests.

### Task Q-001: Implement CI/CD and release artifacts

**Files:** `.github/workflows/*`, `infra/kubernetes/*`, `scripts/*`, `CHANGELOG.md`.

- [ ] Test lint, typecheck, unit, integration, E2E, schema, migration, generator snapshots, Docker, security, license, package, docs, and examples jobs.
- [ ] Implement workflows, Docker images, Compose, Helm chart, npm package builds, CLI distribution, plugin packaging, migration guide, and changelog.
- [ ] Run the complete CI command locally and verify release manifests contain no telemetry endpoint.

## Master acceptance scenarios

1. A local Next.js fixture can be analyzed, manifested, generated, run in Chromium, repaired through evidence-driven requests, and reported in local HTML.
2. A GitHub OAuth user can install the GitHub App, sync a repository, edit a Manifest, create a PR, and see a GitHub Check plus PR comment.
3. A mixed API/Web flow supports setup, loop/condition/parallel/custom action, finally cleanup, and step evidence.
4. A self-hosted Runner registers capabilities, leases a job, executes in Docker, uploads artifacts, and is reassigned after heartbeat loss.
5. Android and iOS projects produce locator candidates, generate Appium code, execute with device evidence, and classify failures.
6. A failed scheduled run produces an AI repair job; a self-hosted Claude Code worker can create a repair branch and optional PR without modifying product code by default.

## Verification and rollback

Each task is independently revertible by package or migration. Database migrations are forward-only with explicit down/rollback procedures documented alongside each migration. Generated code is reproducible from a pinned generator version and Manifest commit. Completion is reported only after the corresponding command output is captured; unavailable browsers, devices, credentials, or external services are recorded as exact blockers, never replaced by a mock claim.
