# Handle change request

Act on a change request that a human is reviewing (created by `publish-tests` via `change_request_create`, or opened directly by a teammate). This is the loop that turns an approval into actual work, and a rejection into a stop.

## Retrieve

- `change_request_get { organizationId, changeRequestId }` for one specific request, or `change_request_list { organizationId }` to enumerate open ones.
- Read `title`, `description`, and `status` (`open` | `approved` | `rejected`). The description should already reference the Manifest/test and run evidence that motivated the request (from `publish-tests`); if it doesn't, look up the related test via `test_get` / `test_get_manifest` / `test_get_generated_code`.

## Interpret status transitions

| Status | Meaning | Action |
| --- | --- | --- |
| `open` | Awaiting human decision. | Do not implement yet. Poll or wait for a status change; you may still gather more evidence in the meantime. |
| `approved` | A human approved the proposal. | Implement: update the Manifest (or Custom Action module), validate, generate, run, and report back. |
| `rejected` | A human declined the proposal. | Stop. Do not reattempt the same change without new information or an explicit new request. Do not silently retry via a different path (e.g. a fresh PR). |

There is no separate "implement" status in the data model — `approved` *is* the signal to implement; treat implementation as the natural next step once you observe that transition, not a status to wait for separately.

## Implement (on `approved`)

1. Update the Manifest (or the referenced Custom Action module) to match what the change request describes.
2. Validate — `testpilot manifest validate <file> --json` or `manifest_validate { manifestYaml }`. Fix any `instancePath`/diagnostic before proceeding.
3. Generate — `testpilot manifest generate <file> --json` (see `generate-code`).
4. Run — `testpilot run <file> --json` or `run_start`/`run_get_status` (see `run-tests`). Treat this as asynchronous in team mode; do not block waiting synchronously.
5. If the run fails, classify with `analyze-failure` and either repair (`repair-tests`) and re-run, or escalate if the failure isn't test-side.
6. Report back: register the resulting diff/PR (`pull_request_register`, per `publish-tests`) and update the change request's status/description with `change_request_update { organizationId, changeRequestId, status, ... }` so the human sees the outcome — do not leave an approved request silently unresolved.

## Guardrails

- Never implement a request that is still `open` — that removes the human decision point the whole flow exists to preserve.
- Never reinterpret a `rejected` request as partial approval.
- Keep the same run-evidence trail (`runId`, failures, report URL) attached to the change request update so a reviewer can trace exactly what changed and why.
