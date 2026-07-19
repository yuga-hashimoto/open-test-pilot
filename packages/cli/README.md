# OpenTestPilot CLI

The `testpilot` CLI validates, generates, migrates, compares, exports, analyzes, runs, and reports on OpenTestPilot Manifest files.

```bash
testpilot manifest validate examples/manifests/fixture-login.yaml
testpilot manifest generate examples/manifests/fixture-login.yaml
testpilot manifest export examples/manifests/fixture-login.yaml --output /tmp/fixture-login.zip
testpilot source analyze src/login.ts --platform web --output /tmp/login.yaml
testpilot manifest migrate examples/manifests/fixture-login.yaml
testpilot manifest diff before.yaml after.yaml
testpilot run examples/manifests/fixture-login.yaml
testpilot report .testpilot/runs/<run-id>/report.json

Use `testpilot --help` or `testpilot run --help` for the complete command synopsis. `testpilot --version` prints the CLI version and exits successfully.
```

The export contains the original Manifest, generated TypeScript, source map, a minimal dependency manifest, and a README for independent execution.

## Machine-readable output for agents

`manifest validate`, `manifest generate`, and `run` accept `--json` and print a single JSON object instead of prose. This is the recommended interface for AI agents (Claude Code, the MCP server, CI scripts) that need to parse results reliably:

```bash
testpilot manifest validate examples/manifests/fixture-login.yaml --json
# {"command":"manifest.validate","ok":true,"file":"…","diagnostics":[]}

testpilot run examples/manifests/fixture-login.yaml --json
# {"command":"run","ok":true,"file":"…","runId":"run-…","status":"passed",
#  "reportPath":"…/report.json","htmlReportPath":"…/index.html","failures":[]}
```

`ok` mirrors the process exit code (`true` ⇔ exit 0). Validation problems appear in `diagnostics` (severity, code, path, message); failed runs list each failed action in `failures` with its `stepId`, `actionId`, `type`, and structured `error`.
