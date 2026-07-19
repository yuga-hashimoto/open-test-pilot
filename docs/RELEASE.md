# Release checklist

Release automation runs on `v*` tags. The workflow first runs the repository gates, builds the four container images, creates `dist/release`, and uploads it as a workflow artifact.

## Local dry run

```bash
pnpm install --frozen-lockfile
pnpm release:artifacts
cat dist/release/release-manifest.json
```

The release directory is a handoff bundle: it contains the license/governance material, examples, Docker and Helm assets, database migrations, the Claude Code plugin, and the CLI tarball. The CLI tarball is a workspace package and is intended to be consumed from a checked-out workspace or a registry publication; it is not evidence that internal packages have been published.

## Before publishing

- Verify `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm verify:generated`, and `pnpm license:report`.
- Inspect `release-manifest.json` and confirm generated files are current.
- Treat npm/GHCR publication, signed assets, hosted deployment, and production secrets as separate gates; record their URLs and versions in the release ticket.
