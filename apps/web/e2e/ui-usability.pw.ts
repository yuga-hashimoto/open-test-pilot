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
