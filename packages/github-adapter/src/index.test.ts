import { createHmac, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildGitHubAppJwt, buildGitHubAuthorizationUrl, verifyWebhookSignature } from './index.js';

describe('GitHub adapter', () => {
  it('builds an OAuth URL with a state value and no password login', () => {
    const url = buildGitHubAuthorizationUrl({ clientId: 'client', redirectUri: 'https://pilot.test/callback', state: 'state-123' });
    expect(url).toContain('https://github.com/login/oauth/authorize');
    expect(url).toContain('client_id=client');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fpilot.test%2Fcallback');
    expect(url).toContain('state=state-123');
    expect(url).not.toContain('password');
  });

  it('verifies GitHub App webhook signatures with timing-safe comparison', () => {
    const payload = '{"action":"push"}';
    const secret = 'webhook-secret';
    const digest = createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyWebhookSignature(payload, `sha256=${digest}`, secret)).toBe(true);
    expect(verifyWebhookSignature(payload, 'sha256=invalid', secret)).toBe(false);
    expect(verifyWebhookSignature(payload, undefined, secret)).toBe(false);
  });

  it('creates a short-lived GitHub App JWT without exposing the private key', () => {
    const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwt = buildGitHubAppJwt({ appId: '123', privateKey: keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }, 1_700_000_000);
    const [header, payload, signature] = jwt.split('.');
    expect(header).toBe(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'));
    expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString())).toMatchObject({ iss: '123', iat: 1_699_999_940, exp: 1_700_000_540 });
    expect(signature).toBeTruthy();
    expect(jwt).not.toContain('BEGIN PRIVATE KEY');
  });
});
