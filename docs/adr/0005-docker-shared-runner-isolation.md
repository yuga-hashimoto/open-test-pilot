# ADR 0005: Docker isolation for shared Runners

## Context

Generated TypeScript and Custom Code are user-controlled code and must not execute directly on a shared Runner host.

## Decision

Shared/server-managed Runners execute inside Docker with declared network, filesystem, secret, CPU, memory, and time limits. Host execution is available only for explicitly trusted self-hosted Runners and is visible in UI and audit logs.

## Consequences

Runner images and browser/device capabilities must be registered and versioned. A job that cannot satisfy its capability or policy is rejected before execution.
