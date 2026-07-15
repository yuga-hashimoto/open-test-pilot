# ADR 0004: PostgreSQL tenant isolation

## Context

Organization data must not leak through API, storage, queue, logs, or artifacts.

## Decision

Every tenant-owned table has `organization_id`, every service call requires tenant context, and hosted deployments use PostgreSQL Row Level Security as defense in depth. Storage and queue keys begin with the organization ID; audit logs record tenant context.

## Consequences

Queries and background jobs must carry context explicitly. Local mode uses a synthetic local organization scope without weakening the hosted invariants.
