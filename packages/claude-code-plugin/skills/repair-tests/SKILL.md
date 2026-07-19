# Repair tests

Fix a test whose failure was classified as test-side (see `analyze-failure`). Repair is Manifest-only, evidence-backed, and bounded — it is not a license to make a run pass by any means.

## Scope

Repair changes the Manifest (and, transitively, the regenerated code) — never the application/product source. If a fix requires changing product behavior, that isn't a repair; it's a product change, and it goes through the normal product development process, not this skill.

## Allowed changes (each must be justified by evidence from `analyze-failure`)

- Replace a broken locator with a more stable one, following the same preference order as `analyze-repository` (`data-testid`/role+name/label over brittle CSS).
- Add or adjust an explicit wait condition — `control.waitUntil` with a real `condition`, bounded `maxAttempts` and `pollMs` — to fix a genuine race (`WAIT_CONDITION_ERROR`).
- Correct test data: fix `setup`/`variables`/`secrets` references, or add missing `cleanup` so state doesn't leak between runs (`TEST_DATA_ERROR`).
- Fix a genuinely wrong Manifest construct (wrong action type, wrong `expectedStatus`, misordered steps) when evidence shows the Manifest itself was the bug (`TEST_IMPLEMENTATION_ERROR`).

## Forbidden changes (these make a red test look green without fixing anything)

- Deleting or loosening an assertion (`web.expectVisible` → nothing, `expectedStatus: 200` → wildcard, removing an `expectText`/`responseSchema` check) without hard evidence the *expectation itself* was wrong.
- Skipping or removing an action to route around a failure.
- Wrapping a flaky step in a broad `control.try`/catch that swallows the error instead of fixing the cause.
- Adding a fixed, long sleep (a raw delay Action) instead of an explicit, bounded `control.waitUntil` condition.
- Weakening an expectation "just to be safe" without evidence backing the change — every repair must cite the specific failure evidence that motivated it.

## Process

1. Confirm the failure category from `analyze-failure` and the exact evidence (structured error, source-mapped Action ID, DOM/network/trace as relevant).
2. Make the smallest Manifest edit that addresses the root cause.
3. Re-validate (`testpilot manifest validate <file> --json` or `manifest_validate`) and regenerate (`generate-code`).
4. Re-run the smallest relevant scope first if possible, then the full Manifest, to confirm the fix — `testpilot run <file> --json`.
5. If the run still fails with the **same** classified cause, do not repeat the same edit — stop and escalate (see below) rather than trying variations blindly.

## Stopping conditions — escalate instead of continuing

- The repaired test fails again with the identical failure category and root cause after one repair attempt.
- The project/session-defined attempt limit for this test is reached (track attempts; do not loop indefinitely).
- The evidence is ambiguous between a test bug and a product bug (`SPECIFICATION_MISMATCH`) — this was never repairable in the first place; hand off to `analyze-failure`'s escalation path.

When stopping, hand off with full evidence: the failure category, the Manifest diff already attempted, the run's `failures[]`/report, and a plain statement that automated repair did not resolve it — via `change_request_create` (team mode) or a PR/issue comment (local mode), per `publish-tests`.
