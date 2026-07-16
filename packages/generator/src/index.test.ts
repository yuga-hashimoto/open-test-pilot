import { describe, expect, it } from 'vitest';
import type { Manifest } from '@open-test-pilot/manifest-schema';
import { generateMobileAppium, generatePlaywright } from './index.js';

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

  it('generates executable control flow with stable source mappings', () => {
    const controlManifest = {
      ...manifest,
      variables: [{ name: 'items', defaultValue: '["a", "b"]' }],
      steps: [{ ...manifest.steps[0], actions: [{
        id: 'loop',
        type: 'control.forEach',
        items: '${var.items}',
        variable: 'item',
        children: [{ id: 'assert-item', type: 'web.expectVisible', selector: '#item' }],
      }, {
        id: 'branch',
        type: 'control.if',
        condition: '${var.enabled}',
        children: [{ id: 'enabled', type: 'web.click', selector: '#enabled' }],
        elseChildren: [{ id: 'disabled', type: 'web.click', selector: '#disabled' }],
      }] }],
    } as Manifest;
    const output = generatePlaywright(controlManifest);
    expect(output.code).toContain('for (const item of');
    expect(output.code).toContain("vars['item'] = item;");
    expect(output.code).toContain('if (resolveCondition(');
    expect(output.sourceMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'loop', kind: 'action' }),
      expect.objectContaining({ nodeId: 'assert-item', kind: 'action' }),
    ]));
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

  it('generates switch, numeric for, while, and function calls', () => {
    const output = generatePlaywright({
      ...manifest,
      functions: [{ id: 'warmup', parameters: [], actions: [{ id: 'warmup-action', type: 'web.expectVisible', selector: '#ready' }] }],
      steps: [{ id: 'control', actions: [
        { id: 'switch', type: 'control.switch', value: 'ready', cases: { ready: [{ id: 'case-ready', type: 'web.expectVisible', selector: '#ready' }] }, defaultChildren: [{ id: 'case-default', type: 'web.expectVisible', selector: '#default' }] },
        { id: 'for', type: 'control.for', variable: 'index', from: 0, to: 2, step: 1, children: [{ id: 'for-action', type: 'web.expectVisible', selector: '#ready' }] },
        { id: 'while', type: 'control.while', condition: 'false', maxAttempts: 1, children: [{ id: 'while-action', type: 'web.expectVisible', selector: '#ready' }] },
        { id: 'call', type: 'control.call', functionName: 'warmup', arguments: {} },
      ] }],
    } as Manifest);
    expect(output.code).toContain('switch (');
    expect(output.code).toContain('for (let index = 0');
    expect(output.code).toContain('while (');
    expect(output.code).toContain('await callFunction');
  });

  it('evaluates interpolated conditions instead of treating every non-empty expression as true', () => {
    const output = generatePlaywright({
      ...manifest,
      steps: [{ id: 'condition', actions: [{ id: 'branch', type: 'control.if', condition: '${steps.login.email} == test@example.com', children: [], elseChildren: [] }] }],
    } as Manifest);
    expect(output.code).toContain('const resolveCondition =');
    expect(output.code).toContain("if (resolveCondition('${steps.login.email} == test@example.com'))");
    expect(output.code).not.toContain("if (truthy(resolveValue('${steps.login.email} == test@example.com')))");
  });

  it('generates executable API outputs, step interpolation, and custom action imports', () => {
    const output = generatePlaywright({
      ...manifest,
      steps: [{ id: 'api', actions: [{ id: 'create', type: 'api.request', method: 'GET', url: 'http://localhost/user', outputs: { email: '$.email' } }] }, {
        id: 'use-output',
        actions: [{ id: 'fill', type: 'web.fill', selector: '#email', value: '${steps.api.email}' }, { id: 'custom', type: 'custom.action', actionType: 'example.record', input: { product: '${steps.api.email}' } }],
      }],
    } as Manifest, { customActionModule: '../examples/custom-actions.mjs' });
    expect(output.code).toContain("import customActions from '../examples/custom-actions.mjs';");
    expect(output.code).toContain('stepOutputs');
    expect(output.code).toContain('response_create');
    expect(output.code).toContain("resolveValue('${steps.api.email}')");
    expect(output.code).toContain('customActions[type]');
  });

  it('passes call arguments into a scoped function and resolves manifest variables from vars', () => {
    const output = generatePlaywright({
      ...manifest,
      variables: [{ name: 'email' }],
      functions: [{ id: 'set-email', parameters: ['value'], actions: [{ id: 'set', type: 'control.set', variable: 'email', value: '${var:value}' }] }],
      steps: [{ id: 'step', actions: [{ id: 'call', type: 'control.call', functionName: 'set-email', arguments: { value: 'user@example.com' } }, { id: 'fill', type: 'web.fill', selector: '#email', value: '${var:email}' }] }],
    } as Manifest);
    expect(output.code).toContain('const previousVars = { ...vars };');
    expect(output.code).toContain('resolveAny({"value":"user@example.com"})');
    expect(output.code).toContain('vars[name] = value;');
    expect(output.code).toContain("resolveValue('${var:email}')");
  });

  it('emits waitUntil children inside the bounded polling loop', () => {
    const output = generatePlaywright({
      ...manifest,
      steps: [{ id: 'wait', actions: [{ id: 'poll', type: 'control.waitUntil', condition: 'true', maxAttempts: 2, pollMs: 1, children: [{ id: 'check', type: 'web.expectVisible', selector: '#ready' }] }] }],
    } as Manifest);
    expect(output.code).toMatch(/for \(let waitAttempt[\s\S]*await expect\(page\.locator\('#ready'\)\)\.toBeVisible\(\);[\s\S]*\}/);
  });
});

describe('generateMobileAppium', () => {
  it('generates standard WebdriverIO code and source mappings from mobile Manifest actions', () => {
    const output = generateMobileAppium({
      schemaVersion: '1.0.0', id: 'android-login', name: 'Android login', description: '', type: 'mobile', tags: [], priority: 'normal',
      preconditions: [], variables: [], secrets: [], setup: [], steps: [{ id: 'login', actions: [
        { id: 'launch', type: 'mobile.launch', capabilities: { platform: 'android', deviceName: 'emulator-5554', appPackage: 'com.example', appActivity: '.MainActivity' } },
        { id: 'tap', type: 'mobile.tap', selector: 'id=com.example:id/login' },
        { id: 'fill', type: 'mobile.fill', selector: 'id=com.example:id/email', value: 'user@example.com' },
        { id: 'assert', type: 'mobile.expectText', selector: 'id=com.example:id/welcome', expectedText: 'Welcome' },
        { id: 'shot', type: 'mobile.screenshot', name: 'welcome' },
        { id: 'back', type: 'mobile.back' },
      ] }], cleanup: [], artifacts: { screenshots: 'after' }, runner: { minBrowsers: [] }, permissions: { networkAccess: false },
      source: { repository: 'local', path: 'mobile.yaml' }, generatedCode: { path: 'generated/android-login.spec.ts' },
    });
    expect(output.code).toContain("import { remote } from 'webdriverio';");
    expect(output.code).toContain("'appium:deviceName': 'emulator-5554'");
    expect(output.code).toContain("await (await browser.$('id=com.example:id/login')).click();");
    expect(output.code).toContain("await browser.saveScreenshot('artifacts/welcome.png');");
    expect(output.code).toContain('deleteSession');
    expect(output.sourceMap.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'login', kind: 'step' }),
      expect.objectContaining({ nodeId: 'assert', kind: 'action' }),
    ]));
  });
});
