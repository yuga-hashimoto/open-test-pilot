# OpenTestPilot CLI

The `testpilot` CLI validates, generates, exports, and runs OpenTestPilot Manifest files.

```bash
testpilot manifest validate examples/manifests/fixture-login.yaml
testpilot manifest generate examples/manifests/fixture-login.yaml
testpilot manifest export examples/manifests/fixture-login.yaml --output /tmp/fixture-login.zip
testpilot run examples/manifests/fixture-login.yaml
```

The export contains the original Manifest, generated TypeScript, source map, a minimal dependency manifest, and a README for independent execution.
