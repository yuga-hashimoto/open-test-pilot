# ADR 0006: No external telemetry

## Context

The product requirement prohibits anonymous or identifying telemetry, including usage, versions, errors, and organization information.

## Decision

No vendor telemetry SDK or default exporter is included. OpenTelemetry and Prometheus integrations are opt-in and send only to endpoints configured by the self-hosting operator.

## Consequences

Operational visibility is the deployer's responsibility. The product must provide local logs, metrics, and audit data without contacting an external service.
