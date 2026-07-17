# Migration guide

## 0.1.x

Install the CLI package from the release bundle and validate existing manifests before running them:

```bash
pnpm testpilot manifest validate path/to/test.yaml
```

Manifests remain the source of truth. Generated TypeScript should be regenerated after a schema or manifest migration:

```bash
pnpm testpilot manifest generate path/to/test.yaml
```

For team mode, apply every SQL file in `migrations/` in filename order. The migrations are append-only and include tenant isolation, repository synchronization, auth sessions, encrypted secret values, and AI Worker jobs. Take a database backup before applying a new release.

The release bundle includes Dockerfiles, `docker-compose.yml`, the Helm chart, examples, the Claude Code Plugin, migrations, and the changelog. Existing deployments can roll the server first, then Scheduler/Runner/AI Worker images; all daemons use tenant-scoped API contracts and must receive the matching session token.
