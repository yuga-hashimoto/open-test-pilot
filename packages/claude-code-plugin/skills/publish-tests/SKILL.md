# Publish tests

Turn a reviewed test (see `review-tests`) into a proposal a human can approve — never a direct change to a protected branch, and never "done" without an explicit human decision recorded.

## Always show the diff

Before proposing anything, present both diffs so the reviewer can see cause and effect together:

1. **Manifest diff** — the YAML change (`testpilot manifest diff <before> <after>` locally, or a plain git diff of the Manifest file). This is the actual source-of-truth change.
2. **Generated-code diff** — the resulting Playwright/Appium TypeScript diff. Since generated code is deterministic, this diff should be fully explained by the Manifest diff; if it isn't (e.g. unrelated formatting churn), investigate before proposing.

## Local / repository mode

- Create a dedicated branch for the change — never commit directly to `main` or another protected branch.
- Open a Pull Request (Draft, if the GitHub integration is configured) containing both diffs and a summary of what was analyzed, designed, generated, run, and (if applicable) repaired, with links to run evidence.
- If the change addresses a suspected product defect rather than a test fix, say so explicitly in the PR description and do not present it as a routine test update.

## Team mode

- Use the GitHub integration to open a dedicated branch and Draft PR (never push straight to a protected branch); register the result with the `pull_request_register { organizationId, url }` MCP tool so the platform tracks it against the run/test.
- Always also call `change_request_create { organizationId, title, description }` — even when a PR exists — so the proposal appears in the dashboard's AI view. The PR is the code artifact; the change request is the human approval gate. Both should reference the same run evidence.
- Treat the proposal as pending until a human moves the change request to `approved` (see `handle-change-request`) or the PR is merged by a human reviewer. `rejected` means stop — do not resubmit the same change without new information.

## Hard rules

- Never push to a protected branch (`main`, release branches) directly, in either mode.
- Never merge your own proposal or bypass required review.
- Never omit the generated-code diff — a reviewer approving a Manifest change without seeing the resulting code is approving blind.
- If secrets, credentials, or tenant data would appear in the diff, stop and redact/reference instead of publishing (see `generate-manifest`'s secrets rules).
