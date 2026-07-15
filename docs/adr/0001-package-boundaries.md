# ADR 0001: Package boundaries

## Context

OpenTestPilot must run locally without a server and later support hosted, mobile, GitHub, and AI-worker execution.

## Decision

Keep Manifest, generator, result, agent, runner, adapter, report, storage, and CLI responsibilities in separate TypeScript packages. The CLI and future server compose these packages; core packages do not import UI, database, or vendor-specific auth.

## Consequences

The initial workspace has more files, but local execution is testable without infrastructure and future adapters consume stable contracts.
