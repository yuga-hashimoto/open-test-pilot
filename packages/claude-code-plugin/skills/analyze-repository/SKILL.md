# Analyze repository

Source-first repository analysis. Understand the application by reading its code before ever opening a browser or emulator. The output is a normalized findings list that `design-tests` turns into a test selection, and `generate-manifest` turns into locators and actions.

## Goal

Produce a list of findings, each with a stable file:line reference, that describes what a user or client can do in the application: pages/routes, forms and their fields, buttons/links that trigger navigation or side effects, API clients and endpoints, and authentication/session flows.

## What to detect

- **Framework** — Next.js, React Router, Vue, Angular, Remix, Nuxt (web); Android/Compose, Flutter, iOS/SwiftUI (mobile); OpenAPI/Swagger, Postman, GraphQL (API). Look for framework fingerprints: route files, `<Route>`/`Router` usage, `getServerSideProps`/loaders, `AndroidManifest.xml`, `MaterialApp`, `NavigationStack`, `openapi:`/`swagger:` documents.
- **Routes and navigation** — page/screen entry points and the URLs or deep links that reach them.
- **Forms and inputs** — every field a test will need to fill, plus its label, name, and type.
- **API clients** — HTTP call sites (`fetch`, `axios`, generated clients, Retrofit/Dio/URLSession), the methods and paths they hit, and request/response shapes (helps `api.request` actions and `responseSchema`).
- **Auth flows** — login/logout, token storage, session cookies, and any test-only bypass the app already exposes (never invent one).
- **Locator candidates**, ranked by stability (best to worst):
  1. `data-testid` / `testTag` / `accessibilityIdentifier` — explicit, stable, intended for automation.
  2. ARIA role + accessible name (`role=button[name=...]`), label text (`label=...`) — resilient to layout change, still meaningful if UI text doesn't change.
  3. Static, non-generated CSS selectors or resource IDs.
  4. Avoid: index-based selectors, deeply nested CSS paths, or anything derived from generated class names (e.g. CSS-in-JS hashes) — these break on the next rebuild.

## Process

1. Start from the repository root: package manifests (`package.json`, `pubspec.yaml`, `build.gradle`, `Podfile`), routing config, and API spec files (`openapi.yaml`, Postman collections) to identify the framework and platform quickly.
2. Grep for route/navigation patterns and form/input elements; read the surrounding component to capture labels, roles, and test IDs actually present in the markup — do not guess at a `data-testid` that isn't there.
3. Record every finding as `{ file, line, type, message, severity }` — mirror the shape the source-analyzer produces (`nextjs-route`, `openapi-operation`, etc.) so results are consistent and diffable across runs.
4. For API surfaces, note base URL, auth header/cookie requirements, and any request/response schema already defined in code or spec — this feeds `responseSchema` and `assertHeaders` in `api.request` actions later.
5. Cross-reference recently changed files (`git log`/`git diff` against the base branch) — `design-tests` uses this for regression risk.

## Live exploration is a fallback, not a first step

Only fall back to running the app, opening a browser, or launching an emulator/simulator after a generated test built from source findings actually fails and static analysis can't explain why (see `web-explorer` / `mobile-explorer` / `analyze-failure`). Live exploration is slower, less repeatable, and must never replace reading the code first.

## Output

A findings list (with file:line references) grouped by route/screen/endpoint, each annotated with its best available locator and whether it looks like a revenue-critical, auth, or data-mutating surface (used directly by `design-tests` prioritization).
