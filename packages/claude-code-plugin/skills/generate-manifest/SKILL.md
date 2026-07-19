# Generate Manifest

Write the Manifest YAML that `design-tests` selected, validate it, and iterate on schema errors until it passes. The Manifest is the single source of truth — generated code (`generate-code`) is a deterministic projection of it and is never edited by hand.

## Annotated example (based on `examples/manifests/fixture-login.yaml`)

```yaml
schemaVersion: "1.0.0"        # only "1.0.0" or "1.0" are accepted
id: fixture-login             # stable, kebab-case test id
name: Fixture login
description: Executes a real local browser flow against the fixture app
type: e2e                     # free-form label, e.g. e2e | api | smoke
tags:
  - smoke
priority: high
preconditions: []             # human-readable precondition strings
variables: []                 # [{ name, type?, defaultValue? }]
secrets: []                   # [{ name, provider, reference }] — never a literal value
setup: []                     # steps that run before `steps`, same shape as `steps`
steps:
  - id: login                 # Step id: stable, kebab-case
    description: Sign in      # business-meaningful description
    actions:
      - id: open-login        # Action id: stable, kebab-case
        type: web.goto
        url: http://127.0.0.1:4173/login
      - id: fill-email
        type: web.fill
        selector: "label=メールアドレス"   # or use `target: { label: ... }`
        value: test@example.com
      - id: submit-login
        type: web.click
        selector: "role=button[name=ログイン]"
      - id: assert-dashboard
        type: web.expectVisible
        selector: "[data-testid=dashboard]"
cleanup: []                   # steps that always run after `steps`, e.g. delete test data
artifacts:
  screenshots: after          # none | failure-only | after | before-and-after
  traces: false                # optional
runner:
  minBrowsers:
    - chromium
permissions:
  networkAccess: true
  fileSystem: false            # optional
source:
  repository: local
  path: examples/manifests/fixture-login.yaml
generatedCode:
  path: generated/fixture-login.spec.ts
```

Every one of `schemaVersion, id, name, description, type, tags, priority, preconditions, variables, secrets, setup, steps, cleanup, artifacts, runner, permissions, source, generatedCode` is required at the document root (`packages/manifest-schema/src/index.ts`). `additionalProperties: false` applies everywhere, so unknown keys fail validation — don't invent fields.

## Action catalog (from `SupportedActions` and the schema's `allOf` conditionals)

Fields not listed as required are optional for that action type, but must still be spelled exactly as in the schema (`ManifestAction` in `packages/manifest-schema/src/index.ts`). Every action always needs `id` and `type`.

| Action type | Required fields | Notes |
| --- | --- | --- |
| `web.goto` | `url` | Navigate the browser. |
| `web.fill` | `value`, and one of `selector` / `target` | `target` = `{ role?, name?, label?, text?, testId?, css? }`. |
| `web.click` | one of `selector` / `target` | |
| `web.expectVisible` | one of `selector` / `target` | Assertion. |
| `web.expectText` | `expectedText`, and one of `selector` / `target` | Assertion. |
| `web.screenshot` | — | Optional `selector` to scope the capture. |
| `api.request` | `method`, `url` | Optional: `headers`, `body`, `contentType`, `query`, `pathParams`, `expectedStatus` (number or number[]), `assertHeaders`, `responseSchema` (JSON Schema), `jsonAssertions`, `allowedHosts` (allow-list, enforce it), `capture` (`none`\|`on-failure`\|`always`), `outputs` (map result fields to variables, e.g. `userId: $.id`). |
| `mobile.launch` | `capabilities` | `capabilities` = `{ platform: android\|ios, deviceName, ... }` (see `ManifestMobileCapabilities`). |
| `mobile.tap` | `selector` | |
| `mobile.fill` | `selector`, `value` | |
| `mobile.expectVisible` | `selector` | Assertion. |
| `mobile.expectText` | `selector`, `expectedText` | Assertion. |
| `mobile.screenshot` | — | |
| `mobile.back` | — | |
| `control.if` | `condition`, `children` | Optional `elseChildren`. |
| `control.switch` | `value`, `cases` | `cases` is a map of branch key → `ManifestAction[]`; optional `defaultChildren`. |
| `control.for` | `variable`, `from`, `to`, `children` | Optional `step`. Bounded loop. |
| `control.forEach` | `items`, `variable`, `children` | `items` is a variable reference or literal array. |
| `control.while` | `condition`, `maxAttempts`, `children` | `maxAttempts` is mandatory — unbounded loops are rejected. |
| `control.retry` | `maxAttempts`, `children` | Optional `backoffMs`. |
| `control.try` | `children` | Optional `catch`, `finally`. |
| `control.parallel` / `control.race` | `branches` (min 1) | `branches` is `ManifestAction[][]`. |
| `control.waitUntil` | `condition`, `maxAttempts`, `pollMs`, `children` | Bounded polling wait — use instead of a fixed sleep. |
| `control.break` / `control.continue` / `control.return` | — | Loop/function control flow only. |
| `control.set` | `variable`, `value` | Assigns a variable. |
| `control.call` | `functionName` | Optional `arguments`; calls a `functions[]` entry. |
| `control.timeout` | `timeoutMs`, `children` | Wraps children with a deadline. |
| `custom.action` | `actionType` | Optional `input`, `outputs`. Delegates to a registered Custom Action (see `generate-code`); never a way to bypass the schema. |

For API checks, see `examples/manifests/api-complete.yaml` for a full example with `responseSchema`, `assertHeaders`, `outputs`, and `allowedHosts`.

## Validation loop

- **Local mode:** `testpilot manifest validate <file> --json` → on failure: `{command, ok: false, file, diagnostics: [...]}` where each diagnostic has `code`, `path`, `severity`, `message` (parser-level: e.g. `SCHEMA_INVALID`, `DUPLICATE_ID`, `SECRET_LITERAL`, `INVALID_INTERPOLATION`, `YAML_PARSE_ERROR`). On success: `{command: "manifest.validate", ok: true, diagnostics: []}`.
- **Team mode:** call the `manifest_validate` MCP tool with `{ manifestYaml }` → `{valid, errors, supportedActions}`, where `errors` are raw AJV entries (`instancePath`, `keyword`, `message`, `params`, `schemaPath`). Use `instancePath` (e.g. `/steps/0/actions/1`) to locate the offending action and `params` (e.g. `missingProperty`) to know what to add.
- Fix errors one `instancePath` at a time and re-validate; do not proceed to `generate-code` or `run-tests` until validation reports `valid: true` / `ok: true`.

## Secrets

Declare secrets in the `secrets:` array as `{ name, provider, reference }`, where `reference` must match `^\$\{secret:[A-Za-z_][A-Za-z0-9_]*\}$`. Reference them in action fields with the same `${secret:NAME}` token. A literal secret value anywhere in the document is a schema violation (`not: { required: ['value'] }` on secret entries, and the parser's `SECRET_LITERAL` diagnostic) — never work around this by inlining a value "temporarily."
