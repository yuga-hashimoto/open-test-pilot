# Deployment

Personal mode requires Node.js, pnpm, Playwright browsers, and a repository-local `.testpilot/` directory. Team mode runs API, Web, PostgreSQL, queue, object storage, and Runner services using Docker Compose. Kubernetes deployment supplies API/Web/Runner/AI Worker Deployments, PostgreSQL/Redis-compatible external dependencies, S3-compatible storage, Secrets, NetworkPolicies, and Helm values.

All observability exporters are disabled by default. Operators configure internal logs, Prometheus, Grafana, and OpenTelemetry destinations explicitly.

## Kubernetes / Helm

The chart deploys the API, a tenant-safe configuration Secret, Service, and PodDisruptionBudget. Runner, Scheduler, AI Worker, and Ingress resources are opt-in values so a control plane can be installed before external credentials and runner capacity are available.

```bash
helm lint infra/helm/opentestpilot
helm upgrade --install opentestpilot infra/helm/opentestpilot \
  --set-string config.databaseUrl="$DATABASE_URL" \
  --set-string config.redisUrl="$REDIS_URL"
```

When `config.authRequired=true` and any daemon is enabled, provide the short-lived GitHub OAuth session token through `config.sessionToken`; the chart injects it as `OPENTESTPILOT_SESSION_TOKEN` and never places it in a command argument. Enable the workers explicitly:

```bash
helm upgrade --install opentestpilot infra/helm/opentestpilot \
  --set runner.enabled=true \
  --set-string runner.organizationId="$OPENTESTPILOT_ORGANIZATION_ID" \
  --set scheduler.enabled=true \
  --set-string scheduler.organizationIds="$OPENTESTPILOT_ORGANIZATION_ID" \
  --set aiWorker.enabled=true \
  --set-string aiWorker.organizationId="$OPENTESTPILOT_ORGANIZATION_ID" \
  --set-string config.sessionToken="$OPENTESTPILOT_SESSION_TOKEN"
```

For hosted OAuth and GitHub App operations, create an external Secret named by `github.existingSecret` with `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`, `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, `GITHUB_WEBHOOK_SECRET`, and `GITHUB_PRIVATE_KEY` keys. The chart injects scalar values as environment variables and mounts the private key read-only at `github.privateKeyPath`.

The AI Worker image (`infra/docker/Dockerfile.ai-worker`) contains the daemon and both supported CLI entry points; operators still provide the corresponding provider credentials through their runtime secret manager. For private GitHub repositories, set `OPENTESTPILOT_GIT_TOKEN` through that secret manager (or set `aiWorker.gitTokenSecret` to a Secret containing `GIT_TOKEN`); the daemon passes it to Git without putting it in clone/fetch arguments. Docker Compose exposes the same worker behind the `ai-worker` profile.
