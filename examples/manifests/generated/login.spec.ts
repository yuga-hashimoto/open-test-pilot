import { test, expect } from '@playwright/test';

test('ログインできる', async ({ page, request }) => {
  // testpilot:step login
    // testpilot:action open-login
    await page.goto(process.env['BASE_URL'] ? process.env['BASE_URL'] + '/login' : 'http://localhost:3000/login');
    // testpilot:action fill-email
    await page.locator('label=メールアドレス').fill('test@example.com');
    // testpilot:action submit-login
    await page.locator('role=button[name=ログイン]').click();
    // testpilot:action assert-dashboard
    await expect(page.locator('[data-testid=dashboard]')).toBeVisible();
});
