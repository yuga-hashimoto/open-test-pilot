import { test, expect } from '@playwright/test';

test('Fixture login', async ({ page, request }) => {
  // testpilot:step login
    // testpilot:action open-login
    await page.goto('http://127.0.0.1:4173/login');
    // testpilot:action fill-email
    await page.getByLabel('メールアドレス').fill('test@example.com');
    // testpilot:action submit-login
    await page.getByRole('button', { name: 'ログイン' }).click();
    // testpilot:action assert-dashboard
    await expect(page.locator('[data-testid=dashboard]')).toBeVisible();
});
