# Run tests

Execute the generated test and capture evidence. A run is asynchronous in team mode and effectively synchronous (but still potentially long) locally — never assume completion without checking status.

## Local mode

```bash
testpilot run <manifest> --json [--actions <module>]
```

Output: a single JSON object — `{command: "run", ok, file, runId, status, reportPath, htmlReportPath, failures}`. `ok` is `true` only when `status === "passed"`; the process exit code mirrors this (`0` pass, `1` fail). `failures` is a flattened array of every failed action: `{ stepId, actionId, type, error }` — read this before opening any screenshot or report.

If the Manifest uses `custom.action` nodes, pass `--actions <module>` pointing at a module exporting `customActions` (or a default export) as `{ [actionType]: CustomActionExecutor }`.

Evidence is written to `.testpilot/runs/<run-id>/`:

```text
.testpilot/runs/<run-id>/
├── report.json          # machine-readable TestRunResult (see result-schema)
├── index.html            # human-readable report (htmlReportPath)
├── generated-code/
├── screenshot/
└── logs/
```

The exact contents depend on the Manifest's `artifacts` policy and which actions ran (DOM/accessibility snapshots and network logs may also appear). To (re)render the HTML report from a saved `report.json`: `testpilot report <report.json>`.

## Team mode (MCP)

1. `run_start { organizationId, projectId, testId }` → returns immediately with `{ runId, status: "queued" }`. Never block waiting inline; this is a fire-and-poll operation.
2. Poll `run_get_status { organizationId, runId }` until status leaves `queued`/`running` (`passed` | `failed` | `cancelled`).
3. `run_get_failures { organizationId, runId }` → failure summaries for a failed run.
4. `report_get_url { organizationId, runId }` → the report URL once evidence is ready.
5. For step-level detail: `run_get_step { organizationId, runId, stepId }`. To compare against a previous run: `run_compare { organizationId, runId, baselineRunId }`.

## Preserve run metadata

Every `TestRunResult` carries `metadata: { browser, browserVersion, viewport, commit?, branch?, environment? }` alongside per-step/per-action timing (`startedAt`/`endedAt`) and status. Keep this metadata intact when relaying results — it is what makes a failure reproducible and comparable across runs (`run_compare`), and what `analyze-failure` uses to rule out "it was a different environment."

## After the run

- `status: "passed"` — proceed to `review-tests` if this was a new/changed test, otherwise done.
- `status: "failed"` — proceed to `analyze-failure` with the `failures[]` array (or `run_get_failures` result) in hand; do not start debugging from the HTML report alone.
- `status: "cancelled"` — treat as inconclusive; re-run before drawing conclusions.
