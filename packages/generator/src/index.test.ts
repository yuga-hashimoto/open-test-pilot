import { describe, expect, it } from 'vitest';
import type { Manifest } from '@open-test-pilot/manifest-schema';
import { generatePlaywright } from './index.js';

const manifest: Manifest = {
  schemaVersion: '1.0.0',
  id: 'login',
  name: 'Login',
  description: 'Login flow',
  type: 'e2e',
  tags: ['smoke'],
  priority: 'high',
  preconditions: [],
  variables: [{ name: 'baseUrl', defaultValue: 'http://localhost:3000' }],
  secrets: [],
  setup: [],
  steps: [
    {
      id: 'login',
      description: 'Sign in',
      actions: [
        { id: 'open', type: 'web.goto', url: '${var.baseUrl}/login' },
        { id: 'email', type: 'web.fill', selector: '#email', value: 'user@example.com' },
        { id: 'submit', type: 'web.click', selector: 'button[type="submit"]' },
        { id: 'dashboard', type: 'web.expectVisible', selector: '[data-testid="dashboard"]' },
      ],
    },
  ],
  cleanup: [],
  artifacts: { screenshots: 'after' },
  runner: { minBrowsers: ['chromium'] },
  permissions: { networkAccess: true },
  source: { repository: 'example', path: 'tests/login.yaml' },
  generatedCode: { path: 'generated/login.spec.ts' },
};

describe('generatePlaywright', () => {
  it('generates standard Playwright TypeScript and stable source mappings', () => {
    const output = generatePlaywright(manifest);
    expect(output.code).toContain("import { test, expect } from '@playwright/test';");
    expect(output.code).toContain("test('Login'");
    expect(output.code).toContain("await page.goto(process.env['BASE_URL'] ? process.env['BASE_URL'] + '/login' : 'http://localhost:3000/login');");
    expect(output.code).toContain("await page.locator('#email').fill('user@example.com');");
    expect(output.code).toContain("await expect(page.locator('[data-testid=\"dashboard\"]')).toBeVisible();");
    expect(output.sourceMap.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'login', kind: 'step' }),
        expect.objectContaining({ nodeId: 'submit', kind: 'action' }),
      ]),
    );
  });

  it('rejects reserved control nodes until the executor supports them', () => {
    const controlManifest = {
      ...manifest,
      steps: [{ ...manifest.steps[0], actions: [{ id: 'loop', type: 'forEach' }] }],
    } as Manifest;
    expect(() => generatePlaywright(controlManifest)).toThrow(/Unsupported action type: forEach/);
  });

  it('maps semantic label and role locators to Playwright locator APIs', () => {
    const semanticManifest = {
      ...manifest,
      steps: [{
        ...manifest.steps[0],
        actions: [
          { id: 'label', type: 'web.fill', selector: 'label=メールアドレス', value: 'user@example.com' },
          { id: 'role', type: 'web.click', selector: 'role=button[name=ログイン]' },
        ],
      }],
    } as Manifest;
    const output = generatePlaywright(semanticManifest);
    expect(output.code).toContain("page.getByLabel('メールアドレス')");
    expect(output.code).toContain("page.getByRole('button', { name: 'ログイン' })");
  });
});
