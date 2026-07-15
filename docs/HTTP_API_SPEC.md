# HTTP API Specification

The HTTP API mirrors the MCP operations and publishes OpenAPI schemas. Runs are asynchronous. The local server foundation exposes `POST /v1/organizations`, organization-scoped project and test creation/listing, `POST /v1/organizations/{organizationId}/runs`, `GET /v1/runs/{runId}`, `GET /v1/runs/{runId}/report`, and `GET /openapi.json`.

The current local adapter uses an explicit in-process persistence interface; hosted PostgreSQL replaces it without changing route contracts. Every organization-scoped request requires `x-organization-id` matching the path tenant. Production authentication remains GitHub OAuth and is a later T-003 integration.

Authentication is GitHub OAuth. GitHub App installation tokens are used for repository operations. Every endpoint resolves organization context before reading or writing and emits an audit event for important changes.
