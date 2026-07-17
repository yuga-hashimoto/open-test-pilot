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
- [x] Appium emulator/simulator flow with available Android and iOS simulators; Android Settings and localized iOS Settings were executed through Appium and produced screenshots/page-source evidence.

The Appium gate was verified on 2026-07-17 with Appium 3.5.2, UiAutomator2 8.1.0 on Android 16/API 36, and XCUITest 11.17.7 with WebDriverAgent 15.1.6 on iOS 26.4.1. The iOS host needed a temporary writable CoreSimulator root because the external-volume default Device Set returned a permission error; the original symlink was restored after verification. Current runtime evidence is recorded in `docs/ACCEPTANCE_EVIDENCE.md` and `docs/REQUIREMENT_AUDIT.md`.
