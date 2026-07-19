import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { Manifest } from '@open-test-pilot/manifest-schema';
import { executeManifest } from './index.js';

const manifest: Manifest = {
  schemaVersion: '1.0.0',
  id: 'local-check',
  name: 'Local check',
  description: 'Checks a local page',
  type: 'e2e',
  tags: ['smoke'],
  priority: 'high',
  preconditions: [],
  variables: [],
  secrets: [],
  setup: [],
  steps: [{
    id: 'home',
    actions: [
      // Keep this port distinct from the real fixture smoke test. The test
      // intentionally verifies the structured connection-refused path.
      { id: 'goto', type: 'web.goto', url: 'http://127.0.0.1:49999/' },
      { id: 'heading', type: 'web.expectText', selector: 'h1', expectedText: 'OpenTestPilot' },
    ],
  }],
  cleanup: [],
  artifacts: { screenshots: 'after' },
  runner: { minBrowsers: ['chromium'] },
  permissions: { networkAccess: true },
  source: { repository: 'local', path: 'tests/local.yaml' },
  generatedCode: { path: 'generated/local-check.spec.ts' },
};

describe('executeManifest', () => {
  it('runs an API-only manifest without launching a browser', async () => {
    const previousExecutable = process.env['PLAYWRIGHT_EXECUTABLE_PATH'];
    process.env['PLAYWRIGHT_EXECUTABLE_PATH'] = '/definitely/missing-browser';
    try {
      const result = await executeManifest({
        ...manifest,
        id: 'api-only',
        type: 'api',
        steps: [{ id: 'api', actions: [{ id: 'health', type: 'api.request', method: 'GET', url: 'http://127.0.0.1:1/health', allowedHosts: ['127.0.0.1'], expectedStatus: 200 }] }],
      }, { outputDir: '.testpilot/api-only', screenshotMode: 'none', apiTransport: { async request() { return { status: 200, headers: { 'content-type': 'application/json' }, body: { ok: true }, durationMs: 1 }; } } });
      expect(result.status).toBe('passed');
      expect(result.metadata.browser).toBe('none');
    } finally {
      if (previousExecutable === undefined) delete process.env['PLAYWRIGHT_EXECUTABLE_PATH'];
      else process.env['PLAYWRIGHT_EXECUTABLE_PATH'] = previousExecutable;
    }
  });

  it('returns a structured failed result when the target is unavailable', async () => {
    const result = await executeManifest(manifest, { outputDir: '.testpilot/test-adapter' });
    expect(result.status).toBe('failed');
    expect(result.steps[0]?.actions[0]?.error?.category).toBe('ENVIRONMENT_ERROR');
    expect(result.steps[0]?.actions[0]?.artifacts?.length).toBeGreaterThan(0);
    expect(result.artifacts.map((artifact) => artifact.type)).toEqual(expect.arrayContaining(['url', 'cookies', 'local-storage', 'visible-elements']));
  }, 30_000);

  it('executes if, forEach, retry, and try/finally control nodes in a real browser', async () => {
    const server: Server = createServer((request, response) => {
      if (request.url === '/api') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><html><body><h1 id="ready">Ready</h1></body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('test server did not bind');
    const complexManifest: Manifest = {
      ...manifest,
      id: 'control-flow',
      name: 'Control flow',
      functions: [{ id: 'verify-ready', actions: [{ id: 'function-assert', type: 'web.expectVisible', selector: '#ready' }] }],
      artifacts: { screenshots: 'none', traces: true },
      steps: [{
        id: 'controls',
        actions: [
          { id: 'open', type: 'web.goto', url: `http://127.0.0.1:${address.port}/` },
          { id: 'api', type: 'api.request', method: 'GET', url: `http://127.0.0.1:${address.port}/api`, expectedStatus: 200, jsonAssertions: { ok: true }, outputs: { ok: '$.ok' } },
          { id: 'api-branch', type: 'control.if', condition: '${steps.api.ok}', children: [{ id: 'api-visible', type: 'web.expectVisible', selector: '#ready' }], elseChildren: [{ id: 'api-wrong', type: 'web.expectVisible', selector: '#missing' }] },
          { id: 'branch', type: 'control.if', condition: 'true', children: [{ id: 'visible-in-branch', type: 'web.expectVisible', selector: '#ready' }], elseChildren: [{ id: 'wrong-branch', type: 'web.expectVisible', selector: '#missing' }] },
          { id: 'loop', type: 'control.forEach', items: '["a", "b"]', variable: 'item', children: [{ id: 'visible-in-loop', type: 'web.expectVisible', selector: '#ready' }] },
          { id: 'retry', type: 'control.retry', maxAttempts: 2, children: [{ id: 'assert-ready', type: 'web.expectText', selector: '#ready', expectedText: 'Ready' }] },
          { id: 'finally', type: 'control.try', children: [{ id: 'try-visible', type: 'web.expectVisible', selector: '#ready' }], finally: [{ id: 'cleanup-shot', type: 'web.screenshot', name: 'control-finally.png' }] },
          { id: 'switch', type: 'control.switch', value: 'ready', cases: { ready: [{ id: 'switch-ready', type: 'web.expectVisible', selector: '#ready' }] } },
          { id: 'for', type: 'control.for', variable: 'index', from: 0, to: 2, step: 1, children: [{ id: 'for-visible', type: 'web.expectVisible', selector: '#ready' }] },
          { id: 'while', type: 'control.while', condition: 'false', maxAttempts: 1, children: [{ id: 'while-never', type: 'web.expectVisible', selector: '#missing' }] },
          { id: 'wait', type: 'control.waitUntil', condition: '${var:ready}', maxAttempts: 2, pollMs: 1, children: [{ id: 'wait-visible', type: 'web.expectVisible', selector: '#ready' }, { id: 'wait-set', type: 'control.set', variable: 'ready', value: 'true' }] },
          { id: 'timeout', type: 'control.timeout', timeoutMs: 5_000, children: [{ id: 'timeout-visible', type: 'web.expectVisible', selector: '#ready' }] },
          { id: 'call', type: 'control.call', functionName: 'verify-ready', arguments: {} },
        ],
      }],
    };
    try {
      const result = await executeManifest(complexManifest, { outputDir: '.testpilot/control-flow', screenshotMode: 'none' });
      expect(result.status).toBe('passed');
      expect(result.steps[0]?.actions.map((action) => action.actionId)).toEqual(['open', 'api', 'api-branch', 'branch', 'loop', 'retry', 'finally', 'switch', 'for', 'while', 'wait', 'timeout', 'call']);
      expect(result.steps[0]?.actions.every((action) => action.status === 'passed')).toBe(true);
      expect(result.artifacts.some((artifact) => artifact.type === 'trace')).toBe(true);
      expect(result.artifacts.some((artifact) => artifact.type === 'screenshot' && artifact.path.endsWith('control-finally.png'))).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  }, 30_000);

  it.each(['firefox', 'webkit'] as const)('executes the same manifest in %s', async (browser) => {
    const server: Server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><html><body><h1>Cross-browser</h1></body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('test server did not bind');
    try {
      const result = await executeManifest({ ...manifest, id: `browser-${browser}`, steps: [{ id: 'browser', actions: [{ id: 'open', type: 'web.goto', url: `http://127.0.0.1:${address.port}/` }, { id: 'heading', type: 'web.expectText', target: { role: 'heading', name: 'Cross-browser' }, expectedText: 'Cross-browser' }] }] }, { outputDir: `.testpilot/browser-${browser}`, browser, screenshotMode: 'none' });
      expect(result.status).toBe('passed');
      expect(result.metadata.browser.toLowerCase()).toBe(browser);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  }, 30_000);

  it('executes a registered custom action and records its output context', async () => {
    let received: Record<string, unknown> | undefined;
    let artifactId: string | undefined;
    const result = await executeManifest({ ...manifest, id: 'custom-flow', permissions: { networkAccess: true, fileSystem: true }, steps: [{ id: 'custom', actions: [{ id: 'record', type: 'custom.action', actionType: 'company.record', input: { value: 'hello' } }] }] }, {
      outputDir: '.testpilot/custom-flow',
      customActions: {
        'company.record': {
          permissions: { filesystem: { write: ['custom.txt'] } },
          async execute(context, input) { received = input; artifactId = await context.writeArtifact('custom.txt', new TextEncoder().encode('custom artifact'), 'text/plain'); return { recorded: true }; },
        },
      },
    });
    expect(result.status).toBe('passed');
    expect(received).toEqual({ value: 'hello' });
    expect(artifactId).toBeDefined();
    expect(await readFile('.testpilot/custom-flow/custom.txt', 'utf8')).toBe('custom artifact');
    expect(result.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'custom', path: 'custom.txt' })]));
  });

  it('enforces custom action network, filesystem, and secret permissions', async () => {
    const action = {
      permissions: { network: ['api.example.test'], filesystem: { write: ['allowed.txt'] }, secrets: ['API_TOKEN'] },
      async execute(context: { getSecret(name: string): Promise<string | undefined>; writeArtifact(name: string, body: Uint8Array, contentType: string): Promise<string> }) {
        expect(await context.getSecret('API_TOKEN')).toBe('token');
        await context.writeArtifact('allowed.txt', new TextEncoder().encode('ok'), 'text/plain');
        return { ok: true };
      },
    };
    const manifestWithPermission = {
      ...manifest,
      id: 'custom-permissions',
      permissions: { networkAccess: true, fileSystem: true },
      secrets: [{ name: 'API_TOKEN', provider: 'env', reference: 'API_TOKEN' }],
      steps: [{ id: 'custom', actions: [{ id: 'permitted', type: 'custom.action', actionType: 'company.secure', input: {} }] }],
    } as Manifest;
    const result = await executeManifest(manifestWithPermission, {
      outputDir: '.testpilot/custom-permissions',
      secretProviders: { env: { async get() { return 'token'; } } },
      customActions: { 'company.secure': action },
    });
    expect(result.status).toBe('passed');

    const denied = await executeManifest({ ...manifestWithPermission, id: 'custom-permissions-denied', permissions: { networkAccess: false, fileSystem: false } }, {
      outputDir: '.testpilot/custom-permissions-denied',
      secretProviders: { env: { async get() { return 'token'; } } },
      customActions: { 'company.secure': action },
    });
    expect(denied.status).toBe('failed');
    expect(denied.steps[0]?.actions[0]?.error?.message).toMatch(/network permission/);
  });

  it('redacts resolved secret values from returned run evidence', async () => {
    const result = await executeManifest({
      ...manifest,
      id: 'custom-secret-redaction',
      secrets: [{ name: 'API_TOKEN', provider: 'env', reference: 'API_TOKEN' }],
      steps: [{ id: 'custom', actions: [{ id: 'leak', type: 'custom.action', actionType: 'company.leak', input: {} }] }],
    }, {
      outputDir: '.testpilot/custom-secret-redaction',
      secretProviders: { env: { async get() { return 'super-secret-token'; } } },
      customActions: {
        'company.leak': {
          permissions: { secrets: ['API_TOKEN'] },
          async execute(context) { throw new Error(await context.getSecret('API_TOKEN')); },
        },
      },
    });
    expect(result.status).toBe('failed');
    expect(result.steps[0]?.actions[0]?.error?.message).toBe('[REDACTED]');
  });

  it('resolves Manifest secret references through the configured provider at execution time', async () => {
    let receivedAuthorization: string | undefined;
    const server: Server = createServer((request, response) => {
      receivedAuthorization = request.headers.authorization;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('secret test server did not bind');
    try {
      const result = await executeManifest({
        ...manifest,
        id: 'provider-secret',
        secrets: [{ name: 'TEST_API_TOKEN', provider: 'vault', reference: 'secret/data/test-api' }],
        steps: [{ id: 'secret-request', actions: [{ id: 'request', type: 'api.request', url: `http://127.0.0.1:${address.port}/secret`, headers: { authorization: 'Bearer ${secret:TEST_API_TOKEN}' }, expectedStatus: 200, jsonAssertions: { ok: true } }] }],
      }, {
        outputDir: '.testpilot/provider-secret',
        secretProviders: { vault: { async get(reference) { expect(reference).toBe('secret/data/test-api'); return 'provider-token'; } } },
      });
      expect(result.status).toBe('passed');
      expect(receivedAuthorization).toBe('Bearer provider-token');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it('resolves an env-backed Manifest secret by its declared name', async () => {
    const previous = process.env['TESTPILOT_ENV_SECRET'];
    process.env['TESTPILOT_ENV_SECRET'] = 'env-token';
    let receivedAuthorization: string | undefined;
    const server: Server = createServer((request, response) => {
      receivedAuthorization = request.headers.authorization;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('env secret test server did not bind');
    try {
      const result = await executeManifest({
        ...manifest,
        id: 'env-secret',
        secrets: [{ name: 'TESTPILOT_ENV_SECRET', provider: 'env', reference: '${secret:TESTPILOT_ENV_SECRET}' }],
        steps: [{ id: 'secret-request', actions: [{ id: 'request', type: 'api.request', url: `http://127.0.0.1:${address.port}/secret`, headers: { authorization: 'Bearer ${secret:TESTPILOT_ENV_SECRET}' }, expectedStatus: 200, jsonAssertions: { ok: true } }] }],
      }, { outputDir: '.testpilot/env-secret', screenshotMode: 'none' });
      expect(result.status).toBe('passed');
      expect(receivedAuthorization).toBe('Bearer env-token');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
      if (previous === undefined) delete process.env['TESTPILOT_ENV_SECRET'];
      else process.env['TESTPILOT_ENV_SECRET'] = previous;
    }
  });
});
