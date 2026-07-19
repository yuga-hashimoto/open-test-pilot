# Generate code

Run `testpilot manifest generate` (add `--json` to receive `{ok, generatedPath, sourceMapPath, diagnostics}` as one parseable object). Inspect the generated TypeScript and source map. Keep generated Web code standard Playwright and keep custom logic as normal TypeScript rather than hiding it in opaque runtime calls.
