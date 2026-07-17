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

Start the included fixture in a second terminal before running the example. It binds only to `127.0.0.1:4173`, so the flow does not depend on an unrelated application already using port 3000:

```bash
node examples/fixtures/web/server.mjs
pnpm testpilot manifest validate examples/manifests/fixture-login.yaml
pnpm testpilot manifest generate examples/manifests/fixture-login.yaml
pnpm testpilot run examples/manifests/fixture-login.yaml
```

The generated test is standard Playwright TypeScript under `examples/manifests/generated/`. A local run writes `.testpilot/runs/<run-id>/report.json`, `index.html`, generated code, screenshots, DOM, accessibility snapshots, and runner logs. The command exits non-zero on a real browser failure and records the failure evidence:

```bash
pnpm testpilot run examples/manifests/fixture-login.yaml
```

The full architecture and dependency-ordered implementation plan are in [`docs/MASTER_IMPLEMENTATION_PLAN.md`](docs/MASTER_IMPLEMENTATION_PLAN.md). The repository now includes the local vertical slice, a tenant-safe Fastify server with PostgreSQL/Redis/S3 selection, a live API-connected React dashboard, GitHub OAuth/App branch/PR/Checks adapters, distributed Runner execution and artifact upload, MCP bridge, Appium/WebdriverIO execution boundaries, source/API analyzers, trigger/notification SDKs, a policy-gated Claude Code Worker, and Helm/Compose release artifacts. Deployment-specific storage, registry, cluster, and Claude CLI credentials, plus physical mobile devices, remain explicit environment gates.

Team-mode local services are described in [`infra/docker/docker-compose.yml`](infra/docker/docker-compose.yml). Set `DATABASE_URL` to switch the server from in-memory development persistence to PostgreSQL, and set `OPENTESTPILOT_WORKER_ENABLED=true` only when intentionally starting the self-hosted AI Worker.
