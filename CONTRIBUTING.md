# Contributing

1. Install Node.js LTS, pnpm 10, and the repository dependencies with `pnpm install`.
2. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before opening a pull request.
3. Add or update tests for behavior changes. Browser tests may require `pnpm exec playwright install chromium`.
4. Keep secrets out of manifests, commits, logs, and artifacts. Use environment-backed secret references.

Pull requests should explain the user-visible behavior, verification performed, and any environment-only gate.
