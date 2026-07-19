# OpenTestPilot repository guide

This file is the short, machine-readable orientation for AI agents and human contributors. Read it before changing code.

## Source of truth

- Manifest contract: `packages/manifest-schema/src`, parser diagnostics: `packages/manifest-parser/src`.
- Generated code: `packages/generator/src`; generated fixtures are under `examples/manifests/generated/` and must be regenerated, not hand-edited.
- Execution: `packages/local-runner/src` and the Playwright/Appium adapters.
- Team API: `apps/server/src`; dashboard: `apps/web/src`; background daemons: `apps/runner`, `apps/scheduler`, and opt-in `apps/ai-worker`.
- Protocol contracts: `packages/*-protocol/src`. Keep protocol changes backwards-compatible and update their tests.

## Safe change loop

1. Read the nearest package README and `docs/REPO_MAP.md`.
2. Add or update a focused `src/**/*.test.ts` before changing behavior.
3. Run the smallest test, then `pnpm typecheck`, `pnpm test`, and `pnpm build` before handoff.
4. For dashboard changes run `pnpm test:web:ui`.
5. For generated files run `pnpm verify:generated`; do not edit generated output directly.

## Boundaries and safety

- Never put secret values in Manifests, reports, fixtures, logs, or commits. Use secret references and `.env.example` placeholders.
- AI repair is policy-gated and must remain Manifest-only unless a human explicitly changes the policy.
- Local green tests do not prove registry publication, hosted deployment, external credentials, or real device availability. Record those as separate gates.
- Keep tenant and organization IDs explicit in team-mode requests; fail closed on mismatches.

## Navigation

- Human setup: `README.md`, `CONTRIBUTING.md`, `docs/CONFIGURATION.md`.
- Current capability evidence: `docs/CAPABILITY_STATUS.md`.
- Architecture and package ownership: `docs/REPO_MAP.md`, `docs/SYSTEM_ARCHITECTURE.md`.
- Release/operator steps: `docs/DEPLOYMENT.md`, `docs/RELEASE.md`.
