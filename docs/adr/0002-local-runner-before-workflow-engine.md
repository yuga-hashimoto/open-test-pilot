# ADR 0002: Local Runner before a workflow engine

## Context

Local-only mode is a first-class requirement, while hosted execution needs durable jobs, leases, cancellation, and retries.

## Decision

Define a versioned Runner Protocol and implement a local state machine first. Add Redis-backed scheduling for team mode and retain a replaceable durable-workflow interface; adopt Temporal only if operational requirements justify it after the protocol is proven.

## Consequences

The local CLI has no infrastructure dependency. Hosted mode must implement persistence and worker recovery before claiming durable execution.
