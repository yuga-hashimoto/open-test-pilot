# Contributing

1. Install Node.js LTS, pnpm 10, and the repository dependencies with `pnpm install`.
2. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:web:ui`, and `pnpm build` before opening a pull request.
3. Add or update tests for behavior changes. Browser tests may require `pnpm exec playwright install chromium`; generated changes require `pnpm verify:generated`.
4. Keep secrets out of manifests, commits, logs, and artifacts. Use environment-backed secret references.

Pull requests should explain the user-visible behavior, verification performed, and any environment-only gate. Include the relevant package path from [docs/REPO_MAP.md](docs/REPO_MAP.md) so reviewers and AI agents can find the source of truth quickly.
