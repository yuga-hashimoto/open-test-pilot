# Comprehensive API Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend OpenTestPilot from basic `api.request` checks to reliable functional and contract API testing with a shared HTTP core, API-only execution, safe evidence, and full OpenAPI/Postman import while preserving existing manifests.

**Architecture:** Promote `packages/api-adapter` to the canonical request/assertion core. API-only manifests use a lightweight Fetch transport; mixed Web+API manifests use a Playwright API transport so browser cookies and API state remain shareable. Importers produce the same Manifest IR but remain separate from the heuristic source analyzer.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Playwright APIRequestContext, Node Fetch, AJV, YAML, existing Manifest/Result/Report protocols.

## Global Constraints

- Preserve `schemaVersion: 1.0.0` compatibility by making new API fields optional and retaining default `expectedStatus: 200`.
- Do not add load, stress, soak, chaos, or performance/VU execution to the Manifest DSL.
- Do not fetch external URLs while importing an OpenAPI or Postman document.
- Shared runners must enforce API host allowlists and block loopback, link-local, and cloud metadata addresses unless explicitly allowed by policy.
- Request and response evidence must be redacted before writing `report.json`, artifacts, or HTML.
- Every behavior change requires a failing test before production code and a passing targeted test before moving to the next task.

---

### Task 1: Canonical API core and backward-compatible DSL

**Files:**
- Modify: `packages/manifest-schema/src/index.ts`
- Modify: `packages/manifest-schema/src/index.test.ts`
- Modify: `packages/api-adapter/src/index.ts`
- Modify: `packages/api-adapter/src/index.test.ts`
- Modify: `packages/api-adapter/package.json`

**Interfaces:**
- `ApiAction` gains optional `query`, `pathParams`, `contentType`, `assertHeaders`, `responseSchema`, `timeoutMs`, `capture`, and `allowedHosts`.
- Export `ApiTransport`, `ApiExecutionContext`, `executeApiAction`, `readApiPath`, `assertJsonSchema`, and `assertApiPolicy`.
- Keep `executeApiAction(action, fetcher)` source-compatible with the current two-argument call.

- [x] **Step 1: Write failing tests** for query/path substitution, JSON/text/form bodies, header assertions, JSON Schema assertions, `$.path` extraction, per-request timeout, and host-policy rejection.
- [x] **Step 2: Run `pnpm --filter @open-test-pilot/api-adapter test` and confirm the new cases fail for missing fields/helpers.**
- [x] **Step 3: Add the optional Manifest fields and AJV-backed core assertions.** Normalize `$.email` and `email` to the same path, build query strings with `URLSearchParams`, substitute `{id}` path segments, and preserve the existing default status behavior.
- [x] **Step 4: Run the targeted adapter and manifest-schema tests and confirm they pass.**
- [x] **Step 5: Commit as `feat: add canonical API assertions and request options`.**

### Task 2: Dual transports and API-only local execution

**Files:**
- Modify: `packages/playwright-adapter/src/index.ts`
- Modify: `packages/playwright-adapter/src/index.test.ts`
- Modify: `packages/generator/src/index.ts`
- Modify: `packages/generator/src/index.test.ts`

**Interfaces:**
- `executeApiAction` accepts a normalized transport adapter so Fetch and Playwright use identical assertion logic.
- `executeManifest` detects whether any `web.*` action exists and selects an API-only execution path when none exists; `runLocal` remains the public orchestration entry point.
- Generated API-only TypeScript uses the shared API semantics without launching a browser.

- [x] **Step 1: Add failing tests** proving an API-only Manifest runs with no Chromium executable, while a mixed Manifest still shares the Playwright request context and passes existing `complex-flow.yaml` behavior.
- [x] **Step 2: Run the focused local-runner and adapter tests and confirm the API-only case fails because Chromium is currently required.**
- [x] **Step 3: Implement the Fetch transport and the Playwright transport bridge.** Pass resolved query, path parameters, body, headers, timeout, schema, capture, and policy options through both paths.
- [x] **Step 4: Add API exchange action outputs so later actions can consume status, headers, body, and extracted values consistently.**
- [x] **Step 5: Run focused tests, then `pnpm --filter @open-test-pilot/generator test` and verify generated snapshots.**
- [x] **Step 6: Commit as `feat: support API-only and mixed API transports`.**

### Task 3: Redacted HTTP evidence and failure classification

**Files:**
- Modify: `packages/result-schema/src/index.ts`
- Modify: `packages/result-schema/src/index.test.ts`
- Modify: `packages/report/src/index.ts`
- Modify: `packages/report/src/index.test.ts`
- Modify: `packages/failure-analysis/src/index.ts`
- Modify: `packages/failure-analysis/src/index.test.ts`
- Modify: `packages/local-runner/src/index.ts`

**Interfaces:**
- Add an optional `httpExchange` artifact/detail containing method, URL without secret query values, selected request headers/body, response status/headers/body, and `durationMs`.
- Add `SPECIFICATION_MISMATCH` classification for JSON Schema and contract failures while preserving existing categories.
- Apply `redactSecrets` before every API exchange is serialized or rendered.

- [x] **Step 1: Write failing tests** for secret redaction in captured request/response evidence and schema-failure classification; `capture: none` suppresses exchange attachment and captured exchanges are attached for `capture: always`.
- [x] **Step 2: Run result/report/failure tests and confirm the new assertions fail.**
- [x] **Step 3: Implement structured exchange serialization, HTML rendering, and the contract-failure category.** Do not write raw secret values even when an assertion fails.
- [x] **Step 4: Run targeted tests and inspect a generated `report.json` for absence of the fixture secret.**
- [x] **Step 5: Commit as `feat: add redacted API evidence and contract failures`.**

### Task 4: Full OpenAPI and Postman import

**Files:**
- Create: `packages/api-importer/package.json`
- Create: `packages/api-importer/tsconfig.json`
- Create: `packages/api-importer/vitest.config.ts`
- Create: `packages/api-importer/src/index.ts`
- Create: `packages/api-importer/src/index.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.test.ts`
- Modify: `examples/fixtures/api/openapi.yaml`
- Create: `examples/fixtures/api/postman.collection.json`

**Interfaces:**
- Export `importOpenApi(source, options)` and `importPostmanCollection(source, options)` returning validated Manifest drafts plus an operation report.
- Support OpenAPI 3.0/3.1 paths, parameters, requestBody, response status/schema, servers, and API-key/Bearer security schemes without fetching remote references.
- Support Postman Collection v2.1 request method, URL variables, headers, raw JSON body, and bearer/API-key auth.
- Add CLI commands `testpilot import openapi <file>` and `testpilot import postman <file>`; retain `source analyze` as heuristic discovery.

- [x] **Step 1: Write failing fixture tests** for path×method extraction, path/query parameters, JSON request bodies, `$ref` resolution from local documents, servers, security-to-secret mapping, and Postman v2.1 requests.
- [x] **Step 2: Run the importer tests and confirm the new importer package/commands are absent.**
- [x] **Step 3: Implement a local-only parser/normalizer that emits the common Manifest action shape and reports unsupported constructs explicitly.** Never silently emit a runnable action for an unresolved remote `$ref`.
- [x] **Step 4: Implement CLI output, deterministic YAML, and import summaries.**
- [x] **Step 5: Run import → `manifest validate` → `manifest generate` against the fixture API and confirm all generated actions are schema-valid.**
- [x] **Step 6: Commit as `feat: add OpenAPI and Postman API import`.**

### Task 5: API editor, documentation, and acceptance fixtures

**Files:**
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/style.css`
- Modify: `apps/web/src/api.test.ts`
- Modify: `README.md`
- Modify: `README.ja.md`
- Modify: `docs/MANIFEST_DSL_SPEC.md`
- Modify: `docs/TEST_STRATEGY.md`
- Modify: `docs/REQUIREMENT_AUDIT.md`
- Create: `examples/fixtures/api/server.mjs`
- Create: `examples/manifests/api-complete.yaml`

- [ ] **Step 1: Add dedicated failing API editor tests** for method, URL, query, auth header, body mode, expected status, JSON Schema, capture mode, and host policy fields. Current controls are covered by Web typecheck and existing editor tests; this focused suite remains follow-up work.
- [x] **Step 2: Implement the editor controls and import review surface without exposing secret values.**
- [x] **Step 3: Add a deterministic fixture API covering health success, JSON validation success, and schema-drift failure, with fixture-health and generated-contract checks.**
- [x] **Step 4: Document functional/contract coverage, importer-vs-analyzer semantics, API-only execution, security policy, and the explicit non-goal of load testing.**
- [x] **Step 5: Run the acceptance flow for API-only execution, mixed Web+API adapter behavior, OpenAPI/Postman import, intentional contract failure, redacted report, and the full existing test suite.**
- [x] **Step 6: Commit as `feat: complete API testing acceptance flow`.**

## Final Verification

- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm verify:generated`
- [x] API-only fixture passes with browser binary unavailable.
- [x] Mixed `examples/manifests/complex-flow.yaml` still passes in adapter tests.
- [x] OpenAPI/Postman imports are deterministic and schema-valid.
- [x] Intentional schema drift is reported as `SPECIFICATION_MISMATCH`.
- [x] No configured secret appears in report JSON, HTML, or HTTP artifacts.
- [x] `git diff --check` is clean before committing and pushing `main`.
