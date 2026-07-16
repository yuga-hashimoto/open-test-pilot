# OpenTestPilot Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the production-facing integrations that were still represented only by local reference adapters after the initial main integration.

**Architecture:** Keep the local mode available, but select PostgreSQL, Redis, S3/MinIO, and GitHub-backed behavior from explicit environment configuration. The Web UI, Runner, MCP, and AI Worker all use the same tenant-scoped HTTP and protocol contracts.

**Tech Stack:** TypeScript, Fastify, PostgreSQL RLS, Redis, S3-compatible storage, React/Vite, WebdriverIO/Appium, GitHub REST API, Claude Code CLI, Vitest, Docker Compose, Helm.

## Global Constraints

- Organization context is mandatory on tenant-owned reads and writes.
- Shared Runner execution is Docker-isolated and cannot use trusted-host mode.
- Repair proposals may modify YAML manifests and source maps only; product-code edits require explicit policy outside this worker.
- External credentials, Docker daemon access, and physical mobile devices are verified only when present; tests must not fake those gates as production success.

## Completed Tasks

- [x] Fast-forward `codex/team-server` into `main` and push `origin/main`.
- [x] Connect the React dashboard to the server API when `VITE_OPENTESTPILOT_*` values are configured.
- [x] Add Redis-backed execution queue with runner registration, lease, heartbeat, duplicate prevention, and completion.
- [x] Add PostgreSQL repository with transaction-local RLS tenant context and live container verification.
- [x] Add local/S3 artifact storage and Runner artifact upload/read routes.
- [x] Add GitHub App branch, commit, PR, Checks, status, and comment operations.
- [x] Add AI repair proposal publishing as a draft PR with manifest-only path validation.
- [x] Add WebdriverIO mobile session execution boundary and Vault secret provider.
- [x] Make Run state transition through queue and Runner completion instead of auto-passing on a timer.
- [x] Add source analyzers, API adapter, failure-analysis policy, result importers, tenant authorization package, Helm chart, and changelog.

## Verification Gates

- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] Live PostgreSQL container: organization/project/test/run CRUD and RLS-scoped reads.
- [x] Live Redis container: register/enqueue/lease/complete.
- [x] Live Fastify + PostgreSQL + Redis HTTP flow: create run, Runner lease, artifact upload, completion, passed run.
- [x] GitHub API write flow with real App installation credentials (App ID `4314915`, installation `146977164`; branch/commit/draft PR/check/status/comment smoke completed and cleaned up).
- [ ] Appium emulator/simulator flow with an available device.

Appium remains an environment gate: this machine currently has no Android device in `adb devices`, no available iOS simulator runtime/device in `xcrun simctl list devices available`, and no `appium` executable. The adapter and generated WebdriverIO boundary are covered by unit tests, but no fake device success is claimed.
