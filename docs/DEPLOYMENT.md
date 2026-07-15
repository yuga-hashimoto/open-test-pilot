# Deployment

Personal mode requires Node.js, pnpm, Playwright browsers, and a repository-local `.testpilot/` directory. Team mode runs API, Web, PostgreSQL, queue, object storage, and Runner services using Docker Compose. Kubernetes deployment supplies API/Web/Runner/AI Worker Deployments, PostgreSQL/Redis-compatible external dependencies, S3-compatible storage, Secrets, NetworkPolicies, and Helm values.

All observability exporters are disabled by default. Operators configure internal logs, Prometheus, Grafana, and OpenTelemetry destinations explicitly.
