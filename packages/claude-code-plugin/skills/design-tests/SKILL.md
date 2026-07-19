# Design tests

Turn `analyze-repository` findings into a prioritized, justified test selection, then turn the selected candidates into well-shaped Manifest Steps. Selection comes first: never start writing YAML before the selection table below is filled in and reviewable.

## 1. Test selection

Build one candidate row per route/form/endpoint/flow discovered during analysis (or per existing test being reconsidered). Score each on:

- **(a) Revenue and irreversible-flow priority** — checkout, payment, order placement/confirmation, account/data deletion, permission or role changes, auth (login/signup/password reset). These are highest priority regardless of recent activity, because a silent regression here is the most expensive kind.
- **(b) Recent failures and flakiness** — pull recent history via `run_list` (team mode) or local run history/report archive (local mode). A test that fails intermittently or has an open repair is higher priority than a new nice-to-have.
- **(c) Coverage gaps** — a route, form, or API operation found during analysis with no matching Manifest `id`/source path. Cross-reference `test_list` (team mode) or the `examples/manifests/` and project Manifest directory (local mode) against the findings list.
- **(d) Regression risk from recent changes** — files touched in the last N commits or the current diff, matched back to the routes/components they render. A recently modified checkout component ranks above an untouched settings page even if both are technically "coverage gaps."

Produce a selection table before writing any Manifest:

| Candidate | Risk | Effort | Decision |
| --- | --- | --- | --- |
| Checkout: place order with saved card | High (revenue, irreversible) | Medium (multi-step, needs test payment method) | Write now |
| Settings: change display name | Low | Low | Defer |
| Login: existing flaky test (`run_list` shows 3 failures/7d) | High (auth gate) | Low (repair, not new test) | Repair existing |

`Risk` = business impact if this silently breaks. `Effort` = rough Manifest complexity (steps, test data, environment needs). `Decision` = write now / defer / repair existing / report gap only. Get through this table before touching YAML — it is the artifact a human reviews to understand *why* these tests exist.

## 2. Step and Action design rules

- **Business-meaningful Steps.** A Step is a unit a reviewer recognizes ("Sign in", "Add item to cart", "Submit payment") — not one Step per raw Action. Use `description` on every Step to say what business behavior it verifies.
- **Stable kebab-case IDs.** Every Manifest `id`, Step `id`, and Action `id` must be stable across regenerations — derive them from the business action (`open-login`, `fill-email`, `submit-login`, `assert-dashboard`), not from a counter. IDs are how the generated code's source map and failure reports stay meaningful; renaming one is a breaking change to evidence history.
- **Setup and cleanup.** Use `setup` for preconditions the test needs but doesn't verify (seed a test account, obtain a token). Use `cleanup` to reverse any state the test created (delete the test order, revoke the token) so a re-run starts clean — required whenever a test creates data.
- **Data lifecycle.** Prefer data the test creates and owns (via `setup`/`variables`/API `outputs`) over pre-existing fixture data that other tests might mutate concurrently. Reference secrets by name (`secrets:` + `${secret:NAME}`), never inline.
- **Assertion strength.** Assert the specific, business-relevant outcome (`web.expectText` on the confirmation message, `expectedStatus` + `responseSchema` on the API response) rather than a weak existence check when a stronger one is available. Do not soften an assertion just to make a flaky test pass — that belongs in `repair-tests`' forbidden list, not here.
- **Permissions and artifacts.** Set `permissions.networkAccess` honestly, and set `artifacts.screenshots` to a mode that gives future failure analysis enough evidence (`after` or `before-and-after` for UI flows worth debugging; `none` only for pure API contract checks with no browser).
- **Runner requirements.** Set `runner.minBrowsers` to what the flow actually needs; don't request browsers the test doesn't exercise.

## Output

A selection table (above) plus, for each "write now" candidate, a Step/Action outline (IDs, descriptions, setup/cleanup, key assertions) ready to hand to `generate-manifest`.
