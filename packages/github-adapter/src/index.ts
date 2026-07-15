import { createHmac, createSign, timingSafeEqual } from 'node:crypto';

export interface GitHubOAuthConfig {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
}

export interface GitHubOAuthToken {
  accessToken: string;
  tokenType: string;
  scope: string;
}

export interface GitHubAppConfig { appId: string; privateKey: string; }
export interface GitHubInstallationToken { token: string; expiresAt: string; permissions?: Record<string, string>; }

function base64Url(value: string | Uint8Array): string { return Buffer.from(value).toString('base64url'); }

export function buildGitHubAppJwt(config: GitHubAppConfig, now = Math.floor(Date.now() / 1000)): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.appId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(config.privateKey).toString('base64url')}`;
}

export async function createGitHubInstallationToken(installationId: number, config: GitHubAppConfig, fetchImpl: typeof fetch = fetch): Promise<GitHubInstallationToken> {
  const response = await fetchImpl(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${buildGitHubAppJwt(config)}`, 'x-github-api-version': '2022-11-28' },
  });
  const body = await response.json() as { token?: string; expires_at?: string; permissions?: Record<string, string>; message?: string };
  if (!response.ok || body.token === undefined || body.expires_at === undefined) throw new Error(`GitHub installation token exchange failed: ${body.message ?? response.statusText}`);
  return { token: body.token, expiresAt: body.expires_at, ...(body.permissions === undefined ? {} : { permissions: body.permissions }) };
}

export function buildGitHubAuthorizationUrl(config: GitHubOAuthConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state: config.state,
    scope: (config.scopes ?? ['read:user', 'user:email']).join(' '),
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeGitHubOAuthCode(code: string, clientId: string, clientSecret: string, fetchImpl: typeof fetch = fetch): Promise<GitHubOAuthToken> {
  const response = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const body = await response.json() as { access_token?: string; token_type?: string; scope?: string; error?: string };
  if (!response.ok || body.access_token === undefined) {
    throw new Error(`GitHub OAuth exchange failed: ${body.error ?? response.statusText}`);
  }
  return { accessToken: body.access_token, tokenType: body.token_type ?? 'bearer', scope: body.scope ?? '' };
}

export function verifyWebhookSignature(payload: string | Uint8Array, signature: string | undefined, secret: string): boolean {
  if (signature === undefined || !signature.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const receivedHex = signature.slice('sha256='.length);
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return false;
  const received = Buffer.from(receivedHex, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export interface GitHubRepository {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

export class GitHubApiClient {
  public constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  public async getRepository(owner: string, repository: string): Promise<GitHubRepository> {
    const response = await this.fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${this.token}`, 'x-github-api-version': '2022-11-28' },
    });
    const body = await response.json() as { id?: number; full_name?: string; default_branch?: string; private?: boolean; message?: string };
    if (!response.ok || body.id === undefined || body.full_name === undefined || body.default_branch === undefined || body.private === undefined) {
      throw new Error(`GitHub repository lookup failed: ${body.message ?? response.statusText}`);
    }
    return { id: body.id, fullName: body.full_name, defaultBranch: body.default_branch, private: body.private };
  }
}
