import { describe, expect, it } from 'vitest';
import { EnvironmentSecretProvider, redact, VaultSecretProvider } from './index.js';

describe('Secret Provider SDK', () => {
  it('reads environment secrets and redacts values from log text', async () => {
    process.env['TESTPILOT_SECRET_TEST'] = 'super-secret';
    const provider = new EnvironmentSecretProvider();
    expect(await provider.get('TESTPILOT_SECRET_TEST')).toBe('super-secret');
    expect(redact('token=super-secret', ['super-secret'])).toBe('token=[REDACTED]');
    delete process.env['TESTPILOT_SECRET_TEST'];
  });

  it('reads Vault KV values without putting the token in the request URL', async () => {
    let requestedUrl = '';
    const provider = new VaultSecretProvider('http://vault.test/', 'vault-token', async (input) => { requestedUrl = String(input); return new Response(JSON.stringify({ data: { data: { value: 'secret-value' } } }), { status: 200 }); });
    expect(await provider.get('secret/data/github')).toBe('secret-value');
    expect(requestedUrl).toBe('http://vault.test/v1/secret/data/github');
    expect(requestedUrl).not.toContain('vault-token');
  });
});
