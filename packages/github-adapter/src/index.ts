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

export interface GitHubCheckRunInput { name: string; headSha: string; status: 'queued' | 'in_progress' | 'completed'; conclusion?: 'success' | 'failure' | 'cancelled' | 'neutral'; title?: string; summary?: string; }
export interface GitHubCheckRun { id: number; htmlUrl?: string; }
export interface GitHubPullRequestInput { title: string; head: string; base: string; body?: string; draft?: boolean; }
export interface GitHubPullRequest { number: number; htmlUrl: string; head: string; base: string; }
export interface GitHubCommitFileInput { branch: string; path: string; content: string; message: string; sha?: string; }

export class GitHubApiClient {
  public constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(url, { ...init, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${this.token}`, 'x-github-api-version': '2022-11-28', ...(init.headers ?? {}) } });
    const body = await response.json() as T & { message?: string };
    if (!response.ok) throw new Error(`GitHub API request failed: ${body.message ?? response.statusText}`);
    return body;
  }

  public async getRepository(owner: string, repository: string): Promise<GitHubRepository> {
    const body = await this.request<{ id?: number; full_name?: string; default_branch?: string; private?: boolean; message?: string }>(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, { method: 'GET' });
    if (body.id === undefined || body.full_name === undefined || body.default_branch === undefined || body.private === undefined) {
      throw new Error(`GitHub repository lookup failed: ${body.message ?? 'incomplete response'}`);
    }
    return { id: body.id, fullName: body.full_name, defaultBranch: body.default_branch, private: body.private };
  }

  public async createBranch(owner: string, repository: string, branch: string, baseSha: string): Promise<void> {
    await this.request(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/refs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }) });
  }

  public async commitFile(owner: string, repository: string, input: GitHubCommitFileInput): Promise<{ commitSha: string }> {
    const body = await this.request<{ commit?: { sha?: string } }>(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${input.path.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: input.message, content: Buffer.from(input.content).toString('base64'), branch: input.branch, ...(input.sha === undefined ? {} : { sha: input.sha }) }) });
    if (body.commit?.sha === undefined) throw new Error('GitHub commit response did not contain a commit SHA');
    return { commitSha: body.commit.sha };
  }

  public async createPullRequest(owner: string, repository: string, input: GitHubPullRequestInput): Promise<GitHubPullRequest> {
    const body = await this.request<{ number?: number; html_url?: string; head?: { ref?: string }; base?: { ref?: string } }>(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: input.title, head: input.head, base: input.base, body: input.body ?? '', draft: input.draft ?? true }) });
    if (body.number === undefined || body.html_url === undefined || body.head?.ref === undefined || body.base?.ref === undefined) throw new Error('GitHub pull request response was incomplete');
    return { number: body.number, htmlUrl: body.html_url, head: body.head.ref, base: body.base.ref };
  }

  public async createCheckRun(owner: string, repository: string, input: GitHubCheckRunInput): Promise<GitHubCheckRun> {
    const body = await this.request<{ id?: number; html_url?: string }>(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/check-runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: input.name, head_sha: input.headSha, status: input.status, ...(input.conclusion === undefined ? {} : { conclusion: input.conclusion }), output: { title: input.title ?? input.name, summary: input.summary ?? '' } }) });
    if (body.id === undefined) throw new Error('GitHub check response did not contain an id');
    return { id: body.id, ...(body.html_url === undefined ? {} : { htmlUrl: body.html_url }) };
  }

  public async createCommitStatus(owner: string, repository: string, sha: string, state: 'error' | 'failure' | 'pending' | 'success', description: string, targetUrl?: string): Promise<void> {
    await this.request(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/statuses/${encodeURIComponent(sha)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, description, ...(targetUrl === undefined ? {} : { target_url: targetUrl }) }) });
  }

  public async createIssueComment(owner: string, repository: string, issueNumber: number, body: string): Promise<{ id: number }> {
    const result = await this.request<{ id?: number }>(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues/${issueNumber}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) });
    if (result.id === undefined) throw new Error('GitHub comment response did not contain an id');
    return { id: result.id };
  }
}
