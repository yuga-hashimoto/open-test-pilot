import { describe, expect, it } from 'vitest';
import { AzureKeyVaultSecretProvider, EncryptedSecretStore, EnvironmentSecretProvider, GitHubActionsSecretProvider, GoogleSecretManagerProvider, maskSecret, redact, VaultSecretProvider } from './index.js';

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
    await expect(provider.get('../escape')).rejects.toThrow(/invalid Vault secret name/);
  });
  it('reads cloud providers through their documented APIs and decodes secret values', async () => {
    let googleUrl = '';
    const google = new GoogleSecretManagerProvider('demo-project', 'google-token', async (input) => { googleUrl = String(input); return new Response(JSON.stringify({ payload: { data: Buffer.from('gcp-secret').toString('base64') } }), { status: 200 }); });
    expect(await google.get('api-key')).toBe('gcp-secret');
    expect(googleUrl).toContain('/projects/demo-project/secrets/api-key/versions/latest:access');
    const azure = new AzureKeyVaultSecretProvider('demo-vault', 'azure-token', '7.4', async () => new Response(JSON.stringify({ value: 'azure-secret' }), { status: 200 }));
    expect(await azure.get('api-key')).toBe('azure-secret');
    process.env['OPENTESTPILOT_SECRET_CI_TOKEN'] = 'ci-secret';
    expect(await new GitHubActionsSecretProvider().get('CI_TOKEN')).toBe('ci-secret');
    delete process.env['OPENTESTPILOT_SECRET_CI_TOKEN'];
  });
  it('encrypts rotated values and masks them for UI/log display', async () => {
    const store = new EncryptedSecretStore('a-long-development-key');
    await store.rotate('token', 'super-secret-value');
    expect(await store.get('token')).toBe('super-secret-value');
    expect(maskSecret('super-secret-value')).toMatch(/^su\*+ue$/);
    expect(redact('super-secret-value', ['super-secret', 'super-secret-value'])).toBe('[REDACTED]');
  });
});
