# Review tests

Final check before proposing a Manifest (new or changed) to a human. Work through this checklist explicitly — treat every unchecked item as a reason to keep iterating, not a reason to note it and move on.

## Checklist

- **Coverage vs. findings** — does the Manifest actually exercise the route/form/endpoint that `analyze-repository` and `design-tests` identified, including the specific business outcome (not just "page loads")? Any coverage gap the selection table flagged as "write now" should be addressed or explicitly deferred with a reason.
- **Locator stability ranking** — every `selector`/`target` should be at the top of the stability order from `analyze-repository`: `data-testid`/`testTag`/`accessibilityIdentifier` > role+accessible name / label text > static CSS/resource ID. Flag anything lower (generated class names, index-based selectors, deep CSS paths).
- **Assertion strength** — assertions check the specific business-relevant outcome (exact text, specific status + schema), not a weak existence check where a stronger one is available. No assertion was silently removed or loosened since the last reviewed version without evidence recorded in `repair-tests`' trail.
- **Cleanup** — every Step/setup that creates data, state, or a session has a matching `cleanup` entry so re-running the test doesn't accumulate junk or collide with other runs.
- **Secret handling** — `secrets:` entries only, referenced as `${secret:NAME}`; no literal credential, token, or PII anywhere in the Manifest, comments, or generated code.
- **Deterministic IDs** — Manifest `id`, every Step `id`, and every Action `id` are stable kebab-case strings tied to business meaning, not counters; no duplicate IDs anywhere in the document.
- **Permissions and artifact policy** — `permissions.networkAccess`/`fileSystem` match what the test actually needs (least privilege); `artifacts.screenshots`/`traces` are set to capture enough evidence for a future failure without being wasteful (e.g. don't turn on `before-and-after` screenshots for a pure API check).
- **Runner requirements** — `runner.minBrowsers` (or mobile `capabilities`) match what the flow needs, nothing more.
- **Does this test hide a product defect?** — re-check the most recent run's evidence: is any assertion tuned to match current (possibly broken) behavior rather than intended behavior? If evidence suggests the app itself is wrong, this belongs in `analyze-failure`'s `PRODUCT_DEFECT`/`SPECIFICATION_MISMATCH` path — reported, not encoded as "expected."

## Output

A pass/fail per checklist item with a one-line note, and an overall verdict: ready to propose (`publish-tests`) or send back for another `design-tests`/`generate-manifest`/`repair-tests` pass with the specific gaps listed.
