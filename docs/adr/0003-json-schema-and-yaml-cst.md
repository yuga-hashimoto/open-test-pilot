# ADR 0003: JSON Schema with CST-aware YAML parsing

## Context

Manifests need strict validation, source locations, readable diffs, and safe migration.

## Decision

Publish JSON Schema and TypeScript types. Parse YAML with a CST-aware parser so diagnostics and migrations retain line/column information and formatting context. Normalize to JSON for runtime contracts.

## Consequences

Schema validation is portable across CLI, server, and editor. The parser package owns YAML concerns and downstream code never depends on YAML node internals.
