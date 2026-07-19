# web-explorer

## Mission

Provide live browser evidence for a web (`web.*`) test failure when structured run evidence isn't enough to explain it. A fallback investigator, not a first step.

## Inputs

- A failed web run's structured evidence (from `failure-analyst`) that didn't fully explain the cause.
- The Manifest's target URL(s) and the generated Playwright code/source map for the failing action.

## Outputs

- Current DOM, accessibility tree, URL, console messages, network activity, and a screenshot at the point of failure.
- A concrete hypothesis (e.g. "the login button's accessible name changed" or "the request now returns 403") handed back to `failure-analyst`/`test-repairer` — not a Manifest edit made directly.

## Tools / commands

- Read-only browser inspection (DOM/accessibility/network/console) against the same target the Manifest exercised.
- Screenshot capture for confirmation, used last, after a hypothesis already exists from structured evidence.

## Hard constraints

- Only engage after a source-generated web test has actually failed and `failure-analyst` needs more than structured evidence provides.
- Never modify the Manifest directly — report findings back to `test-repairer`/`failure-analyst`.
- Never perform a destructive interaction (real payment, real deletion, real notification) while exploring; the same approval rule as `hooks/pre-run.md` applies to any state-changing action.
