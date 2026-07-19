# Generate code

Turn a validated Manifest into deterministic, standard test code. Generation is a pure projection: the same Manifest always produces the same code, and the code is disposable — regenerate it, never patch it.

## Command

```bash
testpilot manifest generate <file> --json
```

Output: `{command: "manifest.generate", ok: true, file, diagnostics: [], generatedPath, sourceMapPath}`. If the Manifest still has diagnostics (didn't pass `manifest validate`), generation fails the same way `validate` does — `{ok: false, diagnostics: [...]}` — so validate first (see `generate-manifest`).

- `generatedPath` — resolved from `generatedCode.path` in the Manifest, relative to the Manifest's own directory unless absolute. Web Manifests (any `web.*` action) produce standard Playwright TypeScript; Manifests containing any `mobile.*` action produce Appium/WebdriverIO-style TypeScript instead (`generateMobileAppium` vs `generatePlaywright` in `@open-test-pilot/generator`).
- `sourceMapPath` — `<generatedPath>.map.json`, mapping generated code locations back to Manifest Step/Action IDs. This is what lets `analyze-failure` and the HTML report point at the exact Action that failed.

In team mode there is no separate MCP generation tool: `test_create { organizationId, projectId, name, manifestId, manifestYaml }` validates and stores the Manifest, and the server generates code as part of the run pipeline when `run_start` executes it.

## Rules

- **Never hand-edit generated output.** If the generated TypeScript is wrong, the Manifest or the generator is wrong — fix the Manifest (locator, action, control flow) and regenerate. A manual edit to `generated/*.spec.ts` is silently destroyed on the next `manifest generate` and hides the real defect from the source of truth.
- **Custom logic lives in Custom Action modules, not generated files.** Anything that can't be expressed as a `web.*`/`api.*`/`mobile.*`/`control.*` action becomes a `custom.action` node (`actionType`, `input`, `outputs`) backed by a real TypeScript module registered via `@open-test-pilot/custom-action-sdk`'s `defineAction`/`ActionRegistry`, or a simple `{ [actionType]: CustomActionExecutor }` map passed to `testpilot run <file> --actions <module>`. Keep that module in version control like any other source file — it is reviewed the same way the Manifest is.
- **Inspect before running.** Read the generated code and the source map after generation, especially for a new Manifest or after a nontrivial edit, to confirm the generator produced what the Steps intended (correct selectors, correct assertions, no silently-dropped action).
- **Keep it standard.** Generated web code is plain Playwright (`@playwright/test`) — no proprietary runtime wrapper. This is what `testpilot manifest export --output <dir|zip>` relies on to produce a project a team can run with plain `pnpm install && pnpm test`, independent of OpenTestPilot.

## Next step

Once code is generated, proceed to `run-tests`.
