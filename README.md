# OpenTestPilot

AI-native open-source test automation platform powered by Claude Code, Playwright, Appium, and structured test manifests.

## Local foundation flow

Requirements: Node.js 20+, pnpm, and the Playwright Chromium browser.

```bash
pnpm install
pnpm exec playwright install chromium
pnpm test
pnpm typecheck
pnpm build
pnpm testpilot manifest validate examples/manifests/login.yaml
pnpm testpilot manifest generate examples/manifests/login.yaml
```

The generated test is standard Playwright TypeScript under `examples/manifests/generated/`. A local run writes `.testpilot/runs/<run-id>/report.json`, `index.html`, generated code, screenshots, DOM, accessibility snapshots, and runner logs:

```bash
pnpm testpilot run examples/manifests/login.yaml
```

The full architecture and dependency-ordered implementation plan are in [`docs/MASTER_IMPLEMENTATION_PLAN.md`](docs/MASTER_IMPLEMENTATION_PLAN.md). The repository now includes the local vertical slice, a tenant-safe Fastify server with optional PostgreSQL persistence, GitHub OAuth/webhook primitives, distributed Runner APIs with Docker isolation policy, MCP bridge, Appium source/evidence adapters, trigger/notification SDKs, a policy-gated Claude Code Worker, and a React dashboard. External GitHub credentials, PostgreSQL/Redis/object-storage deployment, Docker execution, and physical mobile devices remain explicit environment gates.

Team-mode local services are described in [`infra/docker/docker-compose.yml`](infra/docker/docker-compose.yml). Set `DATABASE_URL` to switch the server from in-memory development persistence to PostgreSQL, and set `OPENTESTPILOT_WORKER_ENABLED=true` only when intentionally starting the self-hosted AI Worker.
