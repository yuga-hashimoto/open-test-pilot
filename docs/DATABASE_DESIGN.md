# Database Design

PostgreSQL is the hosted system of record. Required tables are `users`, `organizations`, `organization_memberships`, `projects`, `project_memberships`, `repositories`, `repository_installations`, `branches`, `pull_requests`, `commits`, `tests`, `test_versions`, `manifests`, `generated_codes`, `change_requests`, `runners`, `runner_capabilities`, `runner_groups`, `jobs`, `schedules`, `runs`, `test_results`, `step_results`, `action_results`, `artifacts`, `secrets`, `secret_references`, `environments`, `storage_policies`, `audit_logs`, `github_checks`, `notifications`, `ai_workers`, `repair_attempts`, `plugins`, and `plugin_versions`.

Foreign keys and unique constraints prevent duplicate IDs within a tenant. RLS is defense in depth; application services still require an explicit organization context. Artifact bodies stay outside PostgreSQL; rows contain content hash, storage adapter, tenant-scoped key, size, media type, retention, and deletion state.
