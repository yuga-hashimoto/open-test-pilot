import { createHmac, timingSafeEqual } from 'node:crypto';

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
