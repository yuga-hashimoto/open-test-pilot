# OpenTestPilot command

`/testpilot` runs the end-to-end OpenTestPilot workflow: understand the application, pick what to test, write a Manifest, generate real Playwright/Appium code, run it, and turn failures into either a safe repair or a reported defect. It never edits product code and never publishes without human review.

## 0. Choose a mode

- **Local mode** — a repository checkout and the `testpilot` CLI are available. Prefer this for individual use and CI.
- **Team mode** — the OpenTestPilot MCP server (`open-test-pilot`) is configured (`OPENTESTPILOT_URL`, `OPENTESTPILOT_ORGANIZATION_ID`). Use this when the user references a project, dashboard, or existing test/run IDs.

Both modes share the same Manifest and the same guardrails below. Use the matching skill for each step; this command is the sequencing glue.

## Local mode workflow

1. **Analyze** — invoke `analyze-repository`: detect the framework, routes, forms, API clients, and auth flows; collect file:line findings and locator candidates.
2. **Design** — invoke `design-tests`: turn findings into a prioritized selection table (candidate, risk, effort, decision) before writing any YAML.
3. **Draft the Manifest** — scaffold with `testpilot manifest template --type web|api|mobile [--id <id>] [--name <name>] [--output <file>]`, discover fields with `testpilot manifest actions --json`, then flesh it out per `generate-manifest`'s annotated example and action catalog (see also `examples/manifests/fixture-login.yaml` / `examples/manifests/api-complete.yaml`).
4. **Validate** — `testpilot manifest validate <file> --json`. Fix every reported `instancePath` before moving on; do not generate or run an invalid Manifest.
5. **Generate** — `testpilot manifest generate <file> --json` → `{ok, generatedPath, sourceMapPath, diagnostics}`. Inspect the generated TypeScript; never hand-edit it (see `generate-code`).
6. **Run** — `testpilot run <file> --json` → `{ok, runId, status, reportPath, htmlReportPath, failures[]}`. Evidence lands in `.testpilot/runs/<run-id>/`.
7. **Analyze failures** — invoke `analyze-failure`: read `failures[]` and evidence before screenshots; classify each with the `FailureCategory` taxonomy.
8. **Repair (Manifest-only)** — invoke `repair-tests` for locator/timing/data causes; re-validate, re-generate, re-run to confirm. For `PRODUCT_DEFECT` or `SPECIFICATION_MISMATCH`, stop and report instead of repairing.
9. **Review** — invoke `review-tests` against the checklist before proposing anything.
10. **Propose** — invoke `publish-tests`: show the Manifest diff and generated-code diff, open a Draft PR on a dedicated branch, and never push to a protected branch directly.

## Team mode workflow

1. **Select** — call `project_list`, `test_list`, and `run_list` to find the project, existing tests, and recent failure/flake history before deciding what to write or fix.
2. **Validate** — call `manifest_validate { manifestYaml }` → `{valid, errors, supportedActions}`. Iterate until `valid: true`.
3. **Register** — call `test_create { organizationId, projectId, name, manifestId, manifestYaml }` to store the new or updated test.
4. **Run** — call `run_start { organizationId, projectId, testId }` (returns immediately with `runId`); poll `run_get_status { organizationId, runId }` until it leaves `queued`/`running`.
5. **Diagnose** — call `run_get_failures { organizationId, runId }` and `report_get_url { organizationId, runId }` for evidence.
6. **Propose for review** — call `change_request_create { organizationId, title, description }` so the proposal appears in the dashboard AI view. Do not consider work "done" until a human has approved it (`change_request_update` to `approved`); `rejected` means stop.

## Guardrails (both modes)

- Never weaken an assertion, delete a check, or skip an action to make a test pass — see `repair-tests` for the exact allow/forbid list.
- Secrets are referenced (`${secret:NAME}` via the `secrets:` array), never written as literal values in a Manifest, generated file, log, or report.
- A test proposal is not published or merged without explicit human review: a Draft PR and/or a `change_request_create` entry, approved by a person.
- Destructive operations (payment, order confirmation, external notifications, deletion, production URLs) require explicit human approval before a run proceeds — see `hooks/pre-run.md`.
- A suspected product defect is reported (`change_request_create` or a PR comment), never disguised as a passing test.
