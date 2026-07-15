import { describe, expect, it } from 'vitest';
import {
  DefaultManifestSchemaVersion,
  type Manifest,
  type ManifestAction,
  type ManifestStep,
  type ManifestVariable,
  type ManifestSecretRef,
  ReservedControlNodes,
  SupportedActions,
  createManifestValidator,
} from './index.js';

describe('Manifest Schema', () => {
  it('exports the default schema version', () => {
    expect(DefaultManifestSchemaVersion).toBe('1.0.0');
  });

  it('defines supported v1 actions', () => {
    expect(SupportedActions).toContain('web.goto');
    expect(SupportedActions).toContain('web.fill');
    expect(SupportedActions).toContain('web.click');
    expect(SupportedActions).toContain('web.expectVisible');
    expect(SupportedActions).toContain('web.expectText');
    expect(SupportedActions).toContain('web.screenshot');
    expect(SupportedActions).toContain('api.request');
  });

  it('defines reserved control nodes for future versions', () => {
    expect(ReservedControlNodes).toContain('if');
    expect(ReservedControlNodes).toContain('forEach');
    expect(ReservedControlNodes).toContain('retry');
    expect(ReservedControlNodes).toContain('parallel');
    expect(ReservedControlNodes).toContain('try');
  });

  describe('Manifest type', () => {
    it('requires schemaVersion, id, name, description, and type', () => {
      const manifest: Manifest = {
        schemaVersion: '1.0.0',
        id: 'test-login',
        name: 'Login Test',
        description: 'Tests the login flow',
        type: 'web',
        tags: ['login', 'smoke'],
        priority: 'high',
        preconditions: [],
        variables: [],
        secrets: [],
        setup: [],
        steps: [],
        cleanup: [],
        artifacts: { screenshots: 'after' },
        runner: { minBrowsers: ['Chromium'] },
        permissions: { networkAccess: true },
        source: { repository: 'repo-url', path: 'tests/login.yaml' },
        generatedCode: { path: 'generated/test-login.spec.ts' },
      };
      expect(manifest.schemaVersion).toBe('1.0.0');
      expect(manifest.id).toBe('test-login');
      expect(manifest.name).toBe('Login Test');
      expect(manifest.type).toBe('web');
    });

    it('supports variables with interpolation tokens', () => {
      const vars: ManifestVariable[] = [
        { name: 'BASE_URL', defaultValue: 'http://localhost:3000' },
        { name: 'USERNAME', defaultValue: 'testuser' },
      ];
      expect(vars[0]?.name).toBe('BASE_URL');
      expect(vars[1]?.defaultValue).toBe('testuser');
    });

    it('supports secret references (never literals)', () => {
      const secret: ManifestSecretRef = {
        name: 'API_KEY',
        provider: 'env',
        reference: '${secret:API_KEY}',
      };
      expect(secret.provider).toBe('env');
      expect(secret.reference).toBe('${secret:API_KEY}');
    });

    it('supports setup and cleanup steps', () => {
      const step: ManifestStep = {
        id: 'setup-clear-state',
        actions: [
          { id: 'act-clear', type: 'web.goto', url: '${env.BASE_URL}' },
        ],
      };
      expect(step.id).toBe('setup-clear-state');
      expect(step.actions[0]?.id).toBe('act-clear');
    });

    it('supports web.goto action with url', () => {
      const action: ManifestAction = {
        id: 'act-navigate',
        type: 'web.goto',
        url: '${env.BASE_URL}/login',
      };
      expect(action.type).toBe('web.goto');
      expect(action.url).toBe('${env.BASE_URL}/login');
    });

    it('supports web.fill action with selector and value', () => {
      const action: ManifestAction = {
        id: 'act-fill-username',
        type: 'web.fill',
        selector: '#username',
        value: '${var.USERNAME}',
      };
      expect(action.selector).toBe('#username');
      expect(action.value).toBe('${var.USERNAME}');
    });

    it('supports web.click action with selector', () => {
      const action: ManifestAction = {
        id: 'act-click-submit',
        type: 'web.click',
        selector: 'button[type="submit"]',
      };
      expect(action.selector).toBe('button[type="submit"]');
    });

    it('supports web.expectVisible action', () => {
      const action: ManifestAction = {
        id: 'act-verify-dashboard',
        type: 'web.expectVisible',
        selector: '.dashboard',
      };
      expect(action.type).toBe('web.expectVisible');
    });

    it('supports web.expectText action', () => {
      const action: ManifestAction = {
        id: 'act-verify-welcome',
        type: 'web.expectText',
        selector: 'h1',
        expectedText: 'Welcome',
      };
      expect(action.expectedText).toBe('Welcome');
    });

    it('supports web.screenshot action', () => {
      const action: ManifestAction = {
        id: 'act-screenshot',
        type: 'web.screenshot',
        name: 'dashboard-screenshot',
      };
      expect(action.type).toBe('web.screenshot');
      expect(action.name).toBe('dashboard-screenshot');
    });

    it('supports api.request action', () => {
      const action: ManifestAction = {
        id: 'act-api-call',
        type: 'api.request',
        method: 'POST',
        url: '${env.API_URL}/login',
        headers: { 'Content-Type': 'application/json' },
        body: { username: '${var.USERNAME}', password: '${secret:PASSWORD}' },
      };
      expect(action.method).toBe('POST');
      expect(action.body).toBeDefined();
    });

    it('supports expression interpolation in step outputs', () => {
      const step: ManifestStep = {
        id: 'login',
        description: 'Login and capture token',
        actions: [
          { id: 'act-api-login', type: 'api.request', method: 'POST', url: '${env.API_URL}/login' },
        ],
        output: { token: '${steps.login.act-api-login.response.body.token}' },
      };
      expect(step.output?.['token']).toBe('${steps.login.act-api-login.response.body.token}');
    });
  });

  describe('JSON Schema validation', () => {
    const validator = createManifestValidator();

    const validManifest = {
      schemaVersion: '1.0.0',
      id: 'test-login',
      name: 'Login Test',
      description: 'Validates login flow',
      type: 'web',
      tags: ['login'],
      priority: 'high',
      preconditions: [],
      variables: [{ name: 'BASE_URL', defaultValue: 'http://localhost:3000' }],
      secrets: [{ name: 'PASSWORD', provider: 'env', reference: '${secret:PASSWORD}' }],
      setup: [],
      steps: [
        {
          id: 'login',
          description: 'Login step',
          actions: [
            { id: 'act-goto', type: 'web.goto', url: '${env.BASE_URL}/login' },
            { id: 'act-fill', type: 'web.fill', selector: '#username', value: '${var.USERNAME}' },
            { id: 'act-click', type: 'web.click', selector: 'button[type="submit"]' },
          ],
        },
      ],
      cleanup: [],
      artifacts: { screenshots: 'after' },
      runner: { minBrowsers: ['Chromium'] },
      permissions: { networkAccess: true },
      source: { repository: 'repo-url', path: 'tests/login.yaml' },
      generatedCode: { path: 'generated/test-login.spec.ts' },
    };

    it('validates a complete valid manifest', () => {
      const result = validator(validManifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeNull();
    });

    it('rejects manifest with missing required fields', () => {
      const result = validator({});
      expect(result.valid).toBe(false);
      expect(result.errors).not.toBeNull();
    });

    it('rejects manifest with missing stable IDs in actions', () => {
      const invalid = {
        ...validManifest,
        steps: [
          {
            id: 'bad-step',
            actions: [
              { type: 'web.goto', url: '${env.BASE_URL}' },
            ],
          },
        ],
      };
      const result = validator(invalid);
      expect(result.valid).toBe(false);
    });

    it('rejects manifest with secret literal values', () => {
      const invalid = {
        ...validManifest,
        secrets: [{ name: 'PASSWORD', value: 'my-secret-password' }],
      };
      const result = validator(invalid);
      expect(result.valid).toBe(false);
    });

    it('rejects unsupported action types', () => {
      const invalid = {
        ...validManifest,
        steps: [
          {
            id: 'bad-step',
            actions: [
              { id: 'act-bad', type: 'web.unsupportedAction', selector: '#foo' },
            ],
          },
        ],
      };
      const result = validator(invalid);
      expect(result.valid).toBe(false);
    });

    it('rejects action with missing required properties', () => {
      const invalid = {
        ...validManifest,
        steps: [
          {
            id: 'bad-step',
            actions: [
              { id: 'act-goto', type: 'web.goto' },
            ],
          },
        ],
      };
      // web.goto requires url
      const result = validator(invalid);
      expect(result.valid).toBe(false);
    });
  });
});
