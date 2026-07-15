export interface SecretProvider {
  get(name: string): Promise<string | undefined>;
}

export class EnvironmentSecretProvider implements SecretProvider {
  public async get(name: string): Promise<string | undefined> {
    return process.env[name];
  }
}

export class VaultSecretProvider implements SecretProvider {
  constructor(private readonly endpoint: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch) {}
  async get(name: string): Promise<string | undefined> {
    const response = await this.fetcher(`${this.endpoint.replace(/\/$/, '')}/v1/${name.replace(/^\/+/, '')}`, { headers: { 'X-Vault-Token': this.token, accept: 'application/json' } });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Vault secret lookup failed with ${response.status}`);
    const body = await response.json() as { data?: { data?: Record<string, unknown> } };
    const value = body.data?.data?.['value'];
    return typeof value === 'string' ? value : undefined;
  }
}

export function redact(text: string, secrets: readonly string[]): string {
  return secrets.filter((secret) => secret.length > 0).reduce((current, secret) => current.replaceAll(secret, '[REDACTED]'), text);
}
