# Security Model

Shared Runners execute generated and custom code in Docker with declared network, filesystem, secret, CPU, memory, and time limits. Secrets are references in Manifests, injected only at execution, redacted from logs/API bodies/artifacts, and protected by role and environment scope.

Repair forbids assertion deletion, skipping, exception swallowing, weakened expectations, fixed long sleeps, and action deletion. Destructive operations and product-code changes require Claude Code-side approval. Audit logs record actor, tenant, repository revision, runner, permissions used, and artifact deletion.
