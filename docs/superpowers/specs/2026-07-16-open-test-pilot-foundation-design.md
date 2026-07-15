# OpenTestPilot Foundation Design

**Date:** 2026-07-16  
**Status:** Approved for implementation  
**Scope:** First working vertical slice of the complete OpenTestPilot architecture

## Goal

Build the first usable OpenTestPilot slice: a repository-local, code-first Web E2E workflow in which a YAML Manifest is validated, converted to standard Playwright TypeScript, executed in Chromium, and rendered as a local HTML report with step evidence. The public contracts must already support later server, GitHub, mobile, API, distributed Runner, and AI Worker integrations without replacing the core model.

## Design principles

1. The Manifest is the structured test source of truth. Generated TypeScript is a reproducible build artifact, not a second editable source.
2. Runtime contracts are agent-neutral. Claude Code is the first adapter, while Codex and OpenCode can implement the same request and result protocols later.
3. Generated tests remain recognizable Playwright code. OpenTestPilot adds only a thin fixture/reporting layer and may be disabled for standalone execution.
4. Evidence is append-only and linked to stable test, business-step, and action IDs.
5. A failed test is classified before repair. The initial slice records failure evidence and classification hooks; it does not silently modify tests.
6. No external telemetry is sent. Local reports and future server storage use explicit adapters.

## Alternatives considered

### A. Single application first

Put the CLI, parser, runner, report, and future API into one application. This is quick initially but couples the DSL to process and storage concerns, making remote execution and plugin compatibility expensive.

### B. Package contracts first, vertical slice second — selected

Create small TypeScript packages for Manifest, generation, result data, runner protocol, and agent protocol, then implement the local flow on top. This adds a small amount of initial structure but preserves stable boundaries and lets the local runner become the reference implementation for server-managed runners.

### C. Workflow engine first

Start with Temporal or another durable workflow engine. This is appropriate for a production control plane but is too heavy for a serverless local mode and would make the first executable path depend on infrastructure. The workflow boundary will be represented as versioned job contracts first; a durable engine can implement that contract later.

## Architecture

```text
YAML Manifest
    │ parse + normalize + validate
    ▼
Manifest AST ───────────────► JSON Schema / diagnostics
    │ generate
    ▼
Generated Playwright TypeScript + source map
    │ execute
    ▼
Local Runner ───────────────► Result Protocol + Artifact metadata
    │ render
    ▼
.testpilot/runs/<run-id>/index.html

Claude Code Plugin ─────────► Agent Protocol ─────────► CLI / future API
Remote Runner / AI Worker ──► Runner Protocol ─────────► same job/result model
```

The first implementation is a pnpm workspace. Runtime packages do not import UI, database, GitHub, or provider-specific modules. The CLI composes them. Future server mode can reuse the parser, generator, result schema, runner protocol, and storage interfaces unchanged.

## Package boundaries

| Package | Responsibility | Must not own |
| --- | --- | --- |
| `manifest-schema` | Public Manifest types, JSON Schema, schema version constants | YAML I/O or execution |
| `manifest-parser` | YAML parse, normalization, stable-ID and semantic validation | Playwright or filesystem side effects |
| `generator` | Manifest AST to TypeScript, generated metadata, source mapping | Browser execution |
| `result-schema` | Run/step/action/result/artifact contracts and failure categories | Artifact bytes or HTML |
| `runner-protocol` | Versioned job, capability, heartbeat, lease, and result envelopes | Queue implementation |
| `agent-protocol` | Agent-neutral generation/change/repair/run requests | Claude Code process control |
| `playwright-adapter` | Standard Playwright browser operations and evidence hooks | Manifest parsing |
| `local-runner` | Job orchestration, evidence directory, Playwright adapter integration | Remote scheduling |
| `report` | Static report generation from a result directory | Test execution |
| `cli` | User-facing commands and composition | Domain logic |
| `claude-code-plugin` | Claude Code skills, subagents, commands, hooks, MCP surface | Platform persistence |

## Manifest v1

The v1 schema requires `schemaVersion`, `id`, `name`, `description`, `type`, `tags`, `priority`, `preconditions`, `variables`, `secrets`, `setup`, `steps`, `cleanup`, `artifacts`, `runner`, `permissions`, `source`, and `generatedCode`. Every step and action requires a stable `id`. The supported first-slice actions are `web.goto`, `web.fill`, `web.click`, `web.expectVisible`, `web.expectText`, `web.screenshot`, and `api.request`. The schema reserves control nodes (`if`, `forEach`, `retry`, `parallel`, `try`) and custom actions for the next generator increments instead of pretending they already execute.

Expressions use `${env.NAME}`, `${var.NAME}`, `${secret:NAME}`, and `${steps.STEP_ID.OUTPUT}`. Secret values never appear in a Manifest or generated source. The parser emits structured diagnostics with JSON pointer, code, severity, and source location. Unsupported-but-valid future nodes are rejected by the current executor with an actionable diagnostic rather than ignored.

## Generated code

Generation is deterministic for the same normalized Manifest and generator version. The output consists of:

- `generated/<test-id>.spec.ts`: standard Playwright test code;
- `generated/<test-id>.map.json`: Manifest node ID to generated line/range mapping;
- `generated/README.md`: exact standalone execution command and required environment variables.

The generator uses an explicit intermediate representation so control nodes and action plugins can be added without rewriting YAML parsing. Generated code receives a thin reporter fixture through dependency injection; when that fixture is unavailable, the code still uses Playwright primitives. Generated source is always stored in the local run artifact even when the project setting does not commit `generated/`.

## Local execution and evidence

`testpilot run <manifest>` creates a unique run ID and `.testpilot/runs/<run-id>/`. The default capture mode is `after`: one screenshot at each business-step boundary. On failure, the runner additionally captures the current URL, DOM, accessibility snapshot where supported, console messages, and a failure screenshot. Artifacts are written with tenant-ready key segments (`organization/project/run/step/action/type`) even in local mode.

The result model separates:

- run status: `queued`, `running`, `passed`, `failed`, `cancelled`;
- business-step status and duration;
- action status, error, failure category, and artifact references;
- generated-code and Manifest-node mappings;
- environment and browser metadata.

The first adapter uses local files. `StorageAdapter`, `SecretProvider`, `NotificationAdapter`, and `ArtifactRedactor` interfaces are defined before server integrations so S3/MinIO/R2, Vault, cloud secret stores, and GitHub notifications can be added without changing result data.

## Agent and Runner contracts

Agent requests are asynchronous envelopes with `requestId`, `protocolVersion`, repository context, operation (`analyze`, `design`, `generate`, `repair`, `publish`), constraints, and requested artifacts. Results contain structured findings, proposed changes, Manifest/code artifacts, and optional PR intent. No contract contains Claude-specific fields.

Runner jobs contain `jobId`, `runId`, `manifest`, source revision, requested capabilities, execution mode, timeout, retry policy, and artifact policy. A runner advertises capabilities and heartbeats, acquires a lease, emits step/action events, uploads or records artifacts, and closes the lease with a result. Lease, cancellation, duplicate-run, and disconnect behavior are explicit protocol states for later scheduler implementations.

## Failure and repair boundary

The local runner classifies observable failures into `TEST_IMPLEMENTATION_ERROR`, `LOCATOR_CHANGED`, `WAIT_CONDITION_ERROR`, `TEST_DATA_ERROR`, `ENVIRONMENT_ERROR`, `NETWORK_ERROR`, `PRODUCT_DEFECT`, `SPECIFICATION_MISMATCH`, and `UNKNOWN`. Classification is represented in the result schema and report. Repair requests are separate from execution and include evidence references, the failed node mapping, and forbidden changes (no assertion deletion, skip, swallowed exception, weakened expectation, or fixed long sleep). App source changes require an explicit future approval field; the local slice never edits application code.

## Testing strategy

- Schema tests validate required fields, stable IDs, secret-reference handling, and rejection of unknown unsafe shapes.
- Parser tests cover YAML normalization, diagnostics, interpolation tokens, and deterministic output.
- Generator snapshot tests verify standard Playwright output and source maps.
- Runner integration tests use a tiny local HTTP fixture and Chromium when installed; they verify step evidence and failure artifacts.
- Report tests verify generated HTML references only files inside the run directory and renders both success and failure states.
- CLI smoke tests exercise validate → generate → run → report with an example fixture.

Every new behavior follows red-green-refactor. No “implemented” claim is made for a package until its focused tests and the full workspace checks pass.

## Completion boundary for this design

The first slice is complete when a user can run the documented CLI flow against a local Web app, inspect generated Playwright code, see step screenshots and failure details in a local HTML report, and use the Claude Code plugin files to request the same operations. The full platform requirements remain in the master implementation plan and are not represented as completed by this slice.

## Self-review

- No unresolved `TBD` or `TODO` design decisions remain.
- Unsupported future capabilities are explicitly versioned and rejected rather than silently ignored.
- Manifest, generated code, result, agent, and runner responsibilities are separated.
- The local path has no dependency on PostgreSQL, Redis, GitHub credentials, or hosted storage.
- Future server and mobile work can consume the same versioned contracts.
