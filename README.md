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

The full architecture and dependency-ordered implementation plan are in [`docs/MASTER_IMPLEMENTATION_PLAN.md`](docs/MASTER_IMPLEMENTATION_PLAN.md). The current repository implements the Manifest, Parser, Result/Agent/Runner contracts, deterministic Generator, Playwright adapter, Local Runner, HTML report, and CLI foundation. Hosted server, GitHub, distributed Runner, mobile, and AI Worker phases are tracked there and are not claimed as complete.
