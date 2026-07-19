# Analyze failure

Evidence-first triage. Determine *why* a test failed before touching anything, and classify it correctly — a wrong classification leads straight to a wrong repair (or a hidden product defect).

## Order of evidence

Read structured data before pixels:

1. **Structured failures first** — `failures[]` from `testpilot run --json`, or `run_get_failures` in team mode: `{ stepId, actionId, type, error: { message, category, stack? } }`. This alone often identifies the cause.
2. **Source map** — `sourceMapPath` from generation ties the failing generated-code location back to the Manifest Action ID, so you're reasoning about the Manifest, not generated TypeScript.
3. **Structured evidence** — DOM snapshot, accessibility tree, console logs, network log/HTTP exchange (`httpExchange` on the action result), trace, and (mobile) Appium page source, resource/accessibility identifiers, activity/view controller, logcat.
4. **Screenshots last** — useful for confirming a hypothesis, not for forming one; a screenshot alone rarely tells you *why*, only *what it looked like*.
5. Only fall back to live exploration (`web-explorer`, `mobile-explorer`) if structured evidence is insufficient to explain the failure.

## Classification taxonomy

Use the `FailureCategory` values from `@open-test-pilot/result-schema` — every failed action is required to carry one:

| Category | Meaning | Typical next step |
| --- | --- | --- |
| `LOCATOR_CHANGED` | Selector/role/label no longer matches the UI. | `repair-tests`: update the locator. |
| `WAIT_CONDITION_ERROR` | Action ran before the app was ready (race, missing wait). | `repair-tests`: add/adjust an explicit `control.waitUntil` or wait-for-state condition — never a fixed sleep. |
| `TEST_DATA_ERROR` | Seed/fixture data missing, stale, or conflicting with another test. | `repair-tests`: fix setup/cleanup or test data. |
| `ENVIRONMENT_ERROR` | Infra/config issue (fixture app not running, wrong base URL, missing credentials). | Fix the environment, not the test; re-run. |
| `NETWORK_ERROR` | Transport-level failure unrelated to the app's behavior (timeout, DNS, connection reset). | Usually re-run; investigate only if persistent. |
| `TEST_IMPLEMENTATION_ERROR` | The Manifest itself is wrong (bad action sequencing, wrong assertion target). | `repair-tests`: fix the Manifest. |
| `SPECIFICATION_MISMATCH` | The app behaves differently from what the test (correctly) expects per spec/requirements — ambiguous whether test or product is "right." | Escalate for human/product decision; do not silently pick a side. |
| `PRODUCT_DEFECT` | The application is genuinely broken; the test caught a real bug. | **Do not touch the test.** Report it (see below). |
| `UNKNOWN` | Not enough evidence yet to classify. | Gather more evidence before proposing any change. |

## Product defects are reported, not "fixed"

If evidence points to `PRODUCT_DEFECT` or `SPECIFICATION_MISMATCH`, the test is doing its job. Do not weaken the assertion, change the selector to match broken behavior, or skip the action to turn the run green. Instead:

- Team mode: call `change_request_create { organizationId, title, description }` describing the defect, the failing Action ID, and the evidence, so it surfaces in the dashboard AI view for a human.
- Local/PR mode: leave the test failing and add a draft PR/issue comment describing the defect with the same evidence, per `publish-tests`.

Only proceed to `repair-tests` for the categories that are genuinely test-side (`LOCATOR_CHANGED`, `WAIT_CONDITION_ERROR`, `TEST_DATA_ERROR`, `TEST_IMPLEMENTATION_ERROR`) or an environment fix outside the test.
