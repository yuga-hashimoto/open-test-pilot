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
