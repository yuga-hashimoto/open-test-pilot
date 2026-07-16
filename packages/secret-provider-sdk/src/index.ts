import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

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
    if (!/^[A-Za-z0-9_./-]+$/.test(name) || name.includes('..')) throw new Error('invalid Vault secret name');
    const path = name.split('/').filter((segment) => segment.length > 0).map(encodeURIComponent).join('/');
    const response = await this.fetcher(`${this.endpoint.replace(/\/$/, '')}/v1/${path}`, { headers: { 'X-Vault-Token': this.token, accept: 'application/json' } });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Vault secret lookup failed with ${response.status}`);
    const body = await response.json() as { data?: { data?: Record<string, unknown> } };
    const value = body.data?.data?.['value'];
    return typeof value === 'string' ? value : undefined;
  }
}

export class AwsSecretsManagerProvider implements SecretProvider {
  private readonly client: SecretsManagerClient;
  constructor(client = new SecretsManagerClient({}), private readonly versionStage?: string) { this.client = client; }
  async get(name: string): Promise<string | undefined> {
    const result = await this.client.send(new GetSecretValueCommand({ SecretId: name, ...(this.versionStage === undefined ? {} : { VersionStage: this.versionStage }) }));
    if (result.SecretString !== undefined) return result.SecretString;
    if (result.SecretBinary === undefined) return undefined;
    return typeof result.SecretBinary === 'string' ? result.SecretBinary : Buffer.from(result.SecretBinary as Uint8Array).toString('utf8');
  }
}

export class GoogleSecretManagerProvider implements SecretProvider {
  constructor(private readonly projectId: string, private readonly accessToken: string, private readonly fetcher: typeof fetch = fetch) {}
  async get(name: string): Promise<string | undefined> {
    const path = `projects/${this.projectId}/secrets/${encodeURIComponent(name)}/versions/latest:access`;
    const response = await this.fetcher(`https://secretmanager.googleapis.com/v1/${path}`, { headers: { authorization: `Bearer ${this.accessToken}`, accept: 'application/json' } });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Google Secret Manager lookup failed with ${response.status}`);
    const body = await response.json() as { payload?: { data?: string } };
    return body.payload?.data === undefined ? undefined : Buffer.from(body.payload.data, 'base64').toString('utf8');
  }
}

export class AzureKeyVaultSecretProvider implements SecretProvider {
  constructor(private readonly vaultName: string, private readonly accessToken: string, private readonly apiVersion = '7.4', private readonly fetcher: typeof fetch = fetch) {}
  async get(name: string): Promise<string | undefined> {
    const response = await this.fetcher(`https://${this.vaultName}.vault.azure.net/secrets/${encodeURIComponent(name)}?api-version=${this.apiVersion}`, { headers: { authorization: `Bearer ${this.accessToken}`, accept: 'application/json' } });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Azure Key Vault lookup failed with ${response.status}`);
    const body = await response.json() as { value?: unknown };
    return typeof body.value === 'string' ? body.value : undefined;
  }
}

export class GitHubActionsSecretProvider implements SecretProvider {
  constructor(private readonly prefix = 'OPENTESTPILOT_SECRET_') {}
  async get(name: string): Promise<string | undefined> { return process.env[`${this.prefix}${name}`] ?? process.env[name]; }
}

export interface SecretRotationProvider extends SecretProvider {
  rotate(name: string, value: string): Promise<void>;
}

export class InMemorySecretProvider implements SecretRotationProvider {
  constructor(private readonly values = new Map<string, string>()) {}
  async get(name: string): Promise<string | undefined> { return this.values.get(name); }
  async rotate(name: string, value: string): Promise<void> { this.values.set(name, value); }
}

export class EncryptedSecretStore implements SecretRotationProvider {
  private readonly values = new Map<string, string>();
  constructor(private readonly key: string) { if (key.length < 16) throw new Error('encrypted secret key must be at least 16 characters'); }
  async get(name: string): Promise<string | undefined> {
    const encoded = this.values.get(name);
    return encoded === undefined ? undefined : decrypt(encoded, this.key);
  }
  async rotate(name: string, value: string): Promise<void> { this.values.set(name, encrypt(value, this.key)); }
}

function deriveKey(secret: string, salt: Buffer): Buffer { return scryptSync(secret, salt, 32); }
function encrypt(value: string, secret: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [salt, iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
}
function decrypt(encoded: string, secret: string): string {
  const parts = encoded.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (parts.length !== 4) throw new Error('invalid encrypted secret');
  const [salt, iv, tag, body] = parts as [Buffer, Buffer, Buffer, Buffer];
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export function redact(text: string, secrets: readonly string[]): string {
  return secrets.filter((secret) => secret.length > 0).sort((a, b) => b.length - a.length).reduce((current, secret) => current.replaceAll(secret, '[REDACTED]'), text);
}

export function maskSecret(value: string, visiblePrefix = 2, visibleSuffix = 2): string {
  if (value.length <= visiblePrefix + visibleSuffix) return '[REDACTED]';
  return `${value.slice(0, visiblePrefix)}${'*'.repeat(Math.max(4, value.length - visiblePrefix - visibleSuffix))}${value.slice(-visibleSuffix)}`;
}
