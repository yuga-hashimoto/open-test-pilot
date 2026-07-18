# OpenTestPilot Web UI Usability Design

Date: 2026-07-19
Status: Approved for implementation

## Purpose

Improve the existing OpenTestPilot web UI for day-to-day operation without replacing its dark visual identity or interfering with the localization work currently underway in another session.

The work prioritizes readability, responsive behavior, keyboard accessibility, and efficient use of screen space. It does not change API contracts, domain behavior, navigation labels, or translation ownership.

## Current Problems

Browser inspection at 1440 x 1000 and 390 x 844 identified the following usability failures:

- `body` has a `min-width` of 1120px, so a 390px viewport exposes only a narrow slice of the main content and forces page-level horizontal scrolling.
- Many operational labels, table cells, status indicators, and tabs use 8-11px text, which is difficult to scan.
- Buttons and compact controls frequently provide less than a comfortable touch target.
- The fixed 245px sidebar consumes most of a phone viewport.
- Two-column dashboards and editors do not collapse at narrow widths.
- Run and evidence panels retain large fixed minimum heights when little content exists, creating dead space and separating related information.
- Dense editor tabs do not have a narrow-screen overflow strategy.
- Keyboard focus is not visually distinct enough across controls.

Language consistency is intentionally excluded because it is being handled in a separate session.

## Chosen Approach

Use a CSS-first, risk-contained usability pass. Preserve the current component structure and visual language while adding responsive layout rules and shared interaction tokens. Only make narrowly scoped markup changes if CSS alone cannot provide a correct accessible result.

This approach is preferred over a workflow-level redesign because it provides immediate usability gains without competing with the active localization changes in `apps/web/src/main.tsx` and `apps/web/src/i18n.ts`. A full information-architecture rewrite is explicitly deferred.

## Design System Adjustments

Add shared tokens for:

- readable UI text sizes;
- minimum interactive control height;
- focus-ring color and width;
- responsive gutters;
- mobile navigation height;
- restrained surface and border contrast.

The palette, Manrope and DM Mono typography families, panel geometry, status colors, and overall dark theme remain unchanged.

Operational text should normally be at least 12px. Primary body and control text should normally be 13-14px. Tiny text is limited to secondary metadata that is not required to understand or operate the interface.

## Responsive Layout

### Desktop: 1200px and wider

- Retain the full sidebar and multi-column dashboard layouts.
- Increase text and control sizes without materially reducing information density.
- Remove unnecessary fixed panel heights so content determines height.

### Compact desktop and tablet: 768-1199px

- Reduce outer gutters.
- Collapse four metrics to two columns.
- Collapse secondary dashboard regions and editor layouts when their minimum readable widths cannot be maintained.
- Allow tables and editor tabs to scroll inside their own surfaces rather than widening the page.

### Mobile: below 768px

- Remove the global minimum page width.
- Convert the sidebar into a full-width top application region.
- Keep brand, workspace selector, and primary navigation reachable.
- Present primary navigation as a horizontally scrollable row with visible active state.
- Hide or compact secondary fleet and profile details that would otherwise dominate the viewport; settings and locale controls remain reachable.
- Stack all content grids into one column.
- Stack or wrap top actions without clipping the primary run action.
- Keep page-level horizontal scrolling disabled. Wide tables scroll only within their panels.

## Component Behavior

### Navigation and Top Bar

- Interactive items receive a minimum practical height and visible hover, active, and `focus-visible` states.
- The active destination remains visually obvious in desktop and mobile forms.
- The primary run action remains more prominent than search and notification controls.

### Overview

- Metrics use readable labels and values at all breakpoints.
- Dashboard grids collapse progressively rather than clipping.
- Recent runs and evidence remain visually connected.

### Tests and Manifest Editor

- The test list and editor remain side-by-side only when both have a usable width.
- On narrow screens, they stack vertically.
- Editor view tabs become horizontally scrollable without wrapping into an unreadable multi-line cluster.
- Monaco and code surfaces use bounded responsive widths and preserve an appropriate editing height.

### Runs and Evidence

- Run rows preserve the existing table anatomy on wide screens.
- Narrow screens scroll the table inside its panel.
- Evidence panels shrink to their real content instead of reserving large empty areas.

### Forms, Settings, and Empty States

- Two-column settings grids stack when needed.
- Inputs and buttons remain large enough to operate by touch.
- Empty states use content-based height and stay near the relevant heading or action.

## Accessibility

- Add a consistent `:focus-visible` outline for buttons, links, inputs, textareas, and editor-adjacent controls.
- Maintain semantic markup and existing ARIA labels.
- Ensure interactive states are not communicated by color alone where existing icons or text can carry the state.
- Respect `prefers-reduced-motion` for any transition introduced by these changes.
- Preserve usable contrast within the established dark palette.

## Data Flow and Error Handling

This change does not alter data fetching, API state, authentication, run execution, manifest persistence, or localization behavior. Existing loading, demo, live, and error states continue to render through the same React paths.

Responsive and accessibility rules must apply equally to demo, live, loading, empty, and error states so a less common state cannot reintroduce overflow or unreadable controls.

## Implementation Boundaries

Expected implementation ownership:

- `apps/web/src/style.css`: responsive layout, type scale, focus states, control sizing, overflow rules, and removal of inappropriate fixed dimensions.
- A dedicated stylesheet may be extracted if doing so makes the responsive rules easier to maintain.
- `apps/web/src/main.tsx`: only minimal class or wrapper additions if required after the localization work settles. Do not rewrite or remove localization changes.
- Web tests: add focused assertions for any markup or behavior changed beyond CSS, while preserving existing API and organization tests.

Do not modify translation dictionaries or translate remaining strings in this work.

## Verification

Run:

- `pnpm --filter @open-test-pilot/web lint`
- `pnpm --filter @open-test-pilot/web test`
- `pnpm --filter @open-test-pilot/web build`

Use a real browser to verify Overview, Runs, Tests, and Settings at:

- 1440 x 1000
- 1024 x 768
- 768 x 1024
- 390 x 844

Verify:

- no page-level horizontal overflow;
- mobile navigation remains operable;
- the primary run action remains visible;
- grids collapse without clipping;
- table and editor overflow stays local to the relevant surface;
- focus rings appear during keyboard navigation;
- no primary text or controls are clipped;
- language behavior is unchanged by this work.

## Acceptance Criteria

- At 390px, the user can reach every primary destination without page-level horizontal scrolling.
- At all target viewports, primary controls are visible and operable.
- Operational text is readable without relying on 8-10px sizing for essential information.
- Overview, Tests, Runs, and Settings remain structurally recognizable and usable.
- Large empty panel regions caused solely by fixed minimum heights are removed.
- The existing dark OpenTestPilot visual identity is preserved.
- Current localization changes remain intact and outside this change set.
- Web lint, tests, and build pass.

## Non-goals

- New product features or API endpoints.
- New navigation destinations or routing architecture.
- Localization or copy cleanup.
- A new brand, color system, or visual concept.
- A full component-library migration.
- Changes to server, runner, scheduler, or worker behavior.
