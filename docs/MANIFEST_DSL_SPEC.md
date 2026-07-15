# Manifest DSL Specification

Manifest v1 requires `schemaVersion`, `id`, `name`, `description`, `type`, `tags`, `priority`, `preconditions`, `variables`, `secrets`, `setup`, `steps`, `cleanup`, `artifacts`, `runner`, `permissions`, `source`, and `generatedCode`. Business Steps contain ordered Actions and stable IDs.

The language reserves `if`, `switch`, `for`, `forEach`, `while`, `retry`, `try`, `parallel`, `race`, `waitUntil`, `timeout`, `break`, `continue`, `return`, function definitions/calls, and custom Actions. Bounds are mandatory for loops and retries. YAML is validated against JSON Schema and normalized to versioned JSON before execution.
