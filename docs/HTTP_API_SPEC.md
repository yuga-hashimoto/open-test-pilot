# HTTP API Specification

The HTTP API mirrors the MCP operations and publishes OpenAPI schemas. Runs are asynchronous. Core resources include organizations, projects, repositories, tests, Manifest versions, change requests, runners, schedules, runs, artifacts, and audit logs.

Authentication is GitHub OAuth. GitHub App installation tokens are used for repository operations. Every endpoint resolves organization context before reading or writing and emits an audit event for important changes.
