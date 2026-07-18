# Web UI Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing OpenTestPilot dashboard readable, keyboard-accessible, and usable from 390px mobile through 1440px desktop without changing localization behavior or product functionality.

**Architecture:** Keep the React component and data-flow structure unchanged. Add browser-level regression coverage for overflow and focus behavior, then layer a focused `usability.css` stylesheet after the existing visual styles so the current dark design system is preserved while responsive and accessibility rules remain isolated and maintainable.

**Tech Stack:** React 19, Vite 6, CSS, Playwright Test 1.55, pnpm 10

## Global Constraints

- Preserve the current OpenTestPilot dark visual identity, palette, Manrope and DM Mono typography families, panel geometry, and status colors.
- Do not modify translation dictionaries, navigation copy, API contracts, authentication, run execution, manifest persistence, or server behavior.
- Preserve the localization changes already committed in `apps/web/src/main.tsx`, `apps/web/src/i18n.ts`, and `apps/web/src/i18n.test.ts`.
- Essential operational text should not rely on 8-10px sizing.
- Mobile navigation must remain usable below 768px.
- Page-level horizontal scrolling is prohibited at 390px, 768px, 1024px, and 1440px; wide tables may scroll inside their own panel.
- Implement keyboard-visible focus styling and practical 40-44px interactive targets.

---

### Task 1: Add Browser-Level Usability Regression Coverage

**Files:**
- Create: `apps/web/playwright.ui.config.ts`
- Create: `apps/web/e2e/ui-usability.pw.ts`

**Interfaces:**
- Consumes: Vite dev server command `pnpm dev --host 127.0.0.1` and the demo UI at `http://127.0.0.1:4173`.
- Produces: a Playwright suite that fails when the document overflows horizontally, mobile navigation is not full-width, core text is undersized, or keyboard focus is invisible.

- [ ] **Step 1: Write the failing Playwright configuration and test**

Create `apps/web/playwright.ui.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  outputDir: '../../.testpilot/ui-usability',
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    locale: 'ja-JP',
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
```

Create `apps/web/e2e/ui-usability.pw.ts`:

```ts
import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'compact desktop', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 1000 },
] as const;

for (const viewport of viewports) {
  test(`${viewport.name} keeps the application inside the viewport`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    await expect(page.locator('.app-shell')).toBeVisible();
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator('.run-button')).toBeInViewport();
  });
}

test('mobile presents full-width reachable navigation and readable controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const sidebar = await page.locator('.sidebar').boundingBox();
  expect(sidebar?.width).toBeGreaterThanOrEqual(389);

  const firstNavigationItem = page.locator('nav .nav-item').first();
  const navigationBox = await firstNavigationItem.boundingBox();
  expect(navigationBox?.height).toBeGreaterThanOrEqual(40);
  expect(await firstNavigationItem.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  )).toBeGreaterThanOrEqual(13);

  const panelDescription = page.locator('.panel-header p').first();
  expect(await panelDescription.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  )).toBeGreaterThanOrEqual(12);
});

test('keyboard focus is visually obvious on the primary action', async ({ page }) => {
  await page.goto('/');
  const primaryAction = page.locator('.run-button');
  await primaryAction.focus();

  const outline = await primaryAction.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 2: Run the test and verify the current UI fails**

Run:

```bash
pnpm --filter @open-test-pilot/web exec playwright test --config=playwright.ui.config.ts
```

Expected: FAIL at the 390px overflow assertion because the existing stylesheet sets `body { min-width: 1120px }`; focus and minimum target/text assertions should also fail before the usability layer exists.

- [ ] **Step 3: Commit the regression coverage**

```bash
git add apps/web/playwright.ui.config.ts apps/web/e2e/ui-usability.pw.ts
git commit -m "test(web): cover responsive usability"
```

---

### Task 2: Implement the Responsive and Accessible Usability Layer

**Files:**
- Create: `apps/web/src/usability.css`
- Modify: `apps/web/src/main.tsx:35-37`

**Interfaces:**
- Consumes: existing class names from `apps/web/src/main.tsx` and the existing visual rules loaded from `apps/web/src/style.css`.
- Produces: CSS overrides that remove page overflow, establish readable type and control sizing, preserve local table/editor scrolling, and transform the sidebar into mobile navigation below 768px.

- [ ] **Step 1: Import a dedicated usability layer after the existing stylesheet**

Change the stylesheet imports in `apps/web/src/main.tsx` to:

```ts
import './style.css';
import './usability.css';
```

The dedicated file is imported second so its equal-specificity rules reliably override the legacy stylesheet without rewriting the localization work in the React component.

- [ ] **Step 2: Add the complete usability stylesheet**

Create `apps/web/src/usability.css`:

```css
:root {
  --focus-ring: #b8c7ff;
  --control-min-height: 40px;
  --mobile-control-min-height: 44px;
  --page-gutter: clamp(16px, 3vw, 38px);
}

html,
body {
  min-width: 0;
  max-width: 100%;
  overflow-x: clip;
}

button,
a,
input,
textarea,
select {
  -webkit-tap-highlight-color: transparent;
}

:where(button, a, input, textarea, select, [tabindex]):focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 3px;
}

.nav-item,
.project-select,
.icon-button,
.run-button,
.login-github-button,
.organization-create input {
  min-height: var(--control-min-height);
}

.connection-state,
.brand small,
.project-select small,
.profile small,
.runner-caption,
.metric-copy small,
.activity-item time,
.evidence-label,
.evidence-footer,
footer {
  font-size: 11px;
}

.workspace-label,
.eyebrow,
.table-head {
  font-size: 10px;
}

.nav-item,
.live-list-row b,
.panel-header p,
.text-button,
.activity-item b,
.activity-item span,
.run-row,
.pill,
.editor-view-tabs button,
.manifest-tree,
.manifest-code,
.graph-node b,
.graph-node small,
.login-card p,
.empty-state p {
  font-size: 12px;
}

.panel-header h2 {
  font-size: 15px;
}

.metric-copy > span {
  font-size: 12px;
}

.live-list-row span,
.profile b {
  font-size: 12px;
}

.run-button {
  padding-inline: 15px;
  font-size: 12px;
}

.text-button {
  min-height: 36px;
  padding: 8px 2px;
}

.live-list,
.empty-state,
.empty-state.compact,
.editor-panel,
.evidence-panel {
  min-height: 0;
}

.empty-state,
.empty-state.compact {
  padding: 48px 20px;
}

.run-table,
.editor-view-tabs {
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
}

.table-head,
.run-row {
  min-width: 680px;
}

.editor-view-tabs {
  flex-wrap: nowrap;
  padding-bottom: 12px;
}

.editor-view-tabs button {
  flex: 0 0 auto;
  min-height: 36px;
  padding-inline: 12px;
}

.tests-layout > *,
.settings-grid > *,
.content-grid > *,
.bottom-grid > * {
  min-width: 0;
}

.monaco-editor-shell,
.manifest-tree,
.manifest-code,
.manifest-graph {
  max-width: calc(100% - 34px);
}

@media (max-width: 1199px) {
  .main-content {
    max-width: none;
    padding-inline: var(--page-gutter);
  }

  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .tests-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 980px) {
  .content-grid,
  .bottom-grid,
  .settings-grid {
    grid-template-columns: 1fr;
  }

  .settings-grid .panel:last-child {
    grid-column: auto;
  }
}

@media (max-width: 767px) {
  :root {
    --page-gutter: 14px;
  }

  .app-shell {
    display: flex;
    flex-direction: column;
  }

  .sidebar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(150px, 1fr);
    width: 100%;
    min-height: 0;
    padding: 12px 14px;
    border-right: 0;
    border-bottom: 1px solid #182b40;
    box-shadow: 0 10px 28px rgb(2 9 18 / 32%);
  }

  .brand {
    min-width: 0;
    padding: 0;
  }

  .brand small,
  .workspace-label,
  .sidebar-spacer,
  .runner-card,
  .profile {
    display: none;
  }

  .project-select {
    min-width: 0;
    margin: 0;
  }

  .sidebar nav {
    grid-column: 1 / -1;
    display: flex;
    gap: 4px;
    margin-top: 10px;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: thin;
  }

  .sidebar nav .nav-item {
    flex: 0 0 auto;
    width: auto;
    min-height: var(--mobile-control-min-height);
    margin: 0;
    padding: 10px 14px;
  }

  .sidebar nav .nav-item.active {
    box-shadow: inset 0 -2px var(--accent);
  }

  .sidebar > .nav-item {
    min-height: var(--mobile-control-min-height);
    margin: 8px 0 0;
  }

  .main-content {
    width: 100%;
    padding: 20px var(--page-gutter) 16px;
  }

  .topbar {
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }

  .topbar h1 {
    font-size: 25px;
  }

  .top-actions {
    width: 100%;
  }

  .top-actions .run-button {
    min-height: var(--mobile-control-min-height);
    margin-left: auto;
  }

  .icon-button {
    width: var(--mobile-control-min-height);
    height: var(--mobile-control-min-height);
  }

  .shortcut {
    display: none;
  }

  .metric-grid,
  .content-grid,
  .bottom-grid,
  .tests-layout,
  .settings-grid {
    grid-template-columns: 1fr;
  }

  .metric-card {
    height: auto;
    min-height: 96px;
  }

  .panel-header {
    gap: 12px;
    padding: 16px;
  }

  .run-table {
    padding-inline: 6px;
  }

  .live-list-body {
    padding-inline: 16px;
  }

  .row-actions,
  .organization-create,
  .evidence-footer,
  footer {
    flex-wrap: wrap;
  }

  .monaco-editor-shell,
  .manifest-tree,
  .manifest-code,
  .manifest-graph,
  .editor-window,
  .evidence-image {
    width: auto;
    max-width: none;
    margin-inline: 12px;
  }

  .manifest-editor textarea {
    width: calc(100% - 24px);
    margin-inline: 12px;
  }

  .login-card {
    width: min(386px, calc(100vw - 28px));
    padding: 30px 22px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [ ] **Step 3: Run browser coverage and verify it passes**

Run:

```bash
pnpm --filter @open-test-pilot/web exec playwright test --config=playwright.ui.config.ts
```

Expected: `6 passed`; no viewport overflow, mobile navigation width, type-size, target-height, or focus-outline failure remains.

- [ ] **Step 4: Run web static and unit checks**

Run:

```bash
pnpm --filter @open-test-pilot/web lint
pnpm --filter @open-test-pilot/web test
pnpm --filter @open-test-pilot/web build
git diff --check
```

Expected: all commands exit 0. The build emits the existing Monaco bundle-size warning only if it was already present.

- [ ] **Step 5: Commit the usability implementation**

```bash
git add apps/web/src/main.tsx apps/web/src/usability.css
git commit -m "feat(web): improve responsive usability"
```

---

### Task 3: Verify Real Workflows and Visual Quality

**Files:**
- Modify only if verification exposes a concrete defect: `apps/web/src/usability.css`
- Do not keep generated screenshots or Playwright output in git.

**Interfaces:**
- Consumes: the completed responsive stylesheet and Playwright regression suite.
- Produces: evidence that Overview, Runs, Tests, and Settings remain reachable and visually usable at every target viewport.

- [ ] **Step 1: Start or reuse the Vite development server**

Run:

```bash
pnpm --filter @open-test-pilot/web dev --host 127.0.0.1
```

Expected: Vite serves `http://127.0.0.1:4173`.

- [ ] **Step 2: Capture and inspect target viewports**

Use Playwright CLI to capture Overview and Runs at 1440 x 1000, 1024 x 768, 768 x 1024, and 390 x 844. At each viewport, inspect the rendered image and browser geometry for:

```text
1. document scrollWidth does not exceed clientWidth
2. navigation and the primary run action are visible
3. metric and content grids collapse without clipping
4. table overflow remains inside .run-table
5. typography, spacing, and focus treatment remain consistent with the existing dark design
```

Expected: no clipped primary content, no page-level horizontal scrollbar, no overlapping top bar, and no unreadable essential text.

- [ ] **Step 3: Exercise navigation and keyboard focus**

Navigate through Overview, Runs, Tests, and Settings. Use keyboard Tab navigation and verify a visible focus outline on navigation buttons, the run button, table rows, editor tabs when present, and settings controls.

Expected: every destination remains reachable, focus is visible, and no navigation action changes localization or data behavior.

- [ ] **Step 4: Repair any visual defects and rerun checks**

If inspection exposes a defect, change only the smallest relevant selector in `apps/web/src/usability.css`, rerun:

```bash
pnpm --filter @open-test-pilot/web exec playwright test --config=playwright.ui.config.ts
pnpm --filter @open-test-pilot/web lint
pnpm --filter @open-test-pilot/web test
pnpm --filter @open-test-pilot/web build
git diff --check
```

Expected: all checks exit 0 after the repair.

- [ ] **Step 5: Commit any verification repair**

If `apps/web/src/usability.css` changed during visual QA:

```bash
git add apps/web/src/usability.css
git commit -m "fix(web): refine responsive usability"
```

If no repair was required, do not create an empty commit.
