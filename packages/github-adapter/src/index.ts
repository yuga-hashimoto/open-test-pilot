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

export interface GitHubAuthenticatedUser { id: number; login: string; }

export interface GitHubInstallationRepository extends GitHubRepository { owner: string; name: string; }

export interface GitHubCheckRunInput { name: string; headSha: string; status: 'queued' | 'in_progress' | 'completed'; conclusion?: 'success' | 'failure' | 'cancelled' | 'neutral'; title?: string; summary?: string; }
export interface GitHubCheckRun { id: number; htmlUrl?: string; }
export interface GitHubPullRequestInput { title: string; head: string; base: string; body?: string; draft?: boolean; }
export interface GitHubPullRequest { number: number; htmlUrl: string; head: string; base: string; }
export interface GitHubCommitFileInput { branch: string; path: string; content: string; message: string; sha?: string; }
export interface GitHubBranch { name: string; sha: string; }
export interface GitHubCompareFile { filename: string; status: string; additions: number; deletions: number; changes: number; }
export interface GitHubBranchComparison { status: string; aheadBy: number; behindBy: number; htmlUrl?: string; files: GitHubCompareFile[]; }
export interface GitHubFile { path: string; sha: string; content: string; }
export interface GitHubPullRequestSummary { number: number; htmlUrl: string; title: string; state: 'open' | 'closed'; head: string; base: string; mergedAt?: string; updatedAt?: string; }

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

  public async getAuthenticatedUser(): Promise<GitHubAuthenticatedUser> {
    const body = await this.request<{ id?: number; login?: string }>('https://api.github.com/user', { method: 'GET' });
    if (body.id === undefined || body.login === undefined) throw new Error('GitHub authenticated-user response was incomplete');
    return { id: body.id, login: body.login };
  }

  public async listInstallationRepositories(): Promise<GitHubInstallationRepository[]> {
    const repositories: GitHubInstallationRepository[] = [];
    let page = 1;
    while (true) {
      const body = await this.request<{ repositories?: Array<{ id?: number; full_name?: string; default_branch?: string; private?: boolean; owner?: { login?: string }; name?: string }>; total_count?: number }>(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, { method: 'GET' });
      const pageItems = (body.repositories ?? []).filter((item): item is { id: number; full_name: string; default_branch: string; private: boolean; owner: { login: string }; name: string } => item.id !== undefined && item.full_name !== undefined && item.default_branch !== undefined && item.private !== undefined && item.owner?.login !== undefined && item.name !== undefined).map((item) => ({ id: item.id, fullName: item.full_name, defaultBranch: item.default_branch, private: item.private, owner: item.owner.login, name: item.name }));
      repositories.push(...pageItems);
      if (pageItems.length === 0 || repositories.length >= (body.total_count ?? repositories.length)) return repositories;
      if (body.total_count === undefined && pageItems.length < 100) return repositories;
      page += 1;
    }
  }

  public async listBranches(owner: string, repository: string): Promise<GitHubBranch[]> {
    const body = await this.request<Array<{ name?: string; commit?: { sha?: string } }>>(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches?per_page=100`, { method: 'GET' });
    return body.flatMap((branch) => branch.name === undefined || branch.commit?.sha === undefined ? [] : [{ name: branch.name, sha: branch.commit.sha }]);
  }

  public async compareBranches(owner: string, repository: string, base: string, head: string): Promise<GitHubBranchComparison> {
    const body = await this.request<{ status?: string; ahead_by?: number; behind_by?: number; html_url?: string; files?: Array<{ filename?: string; status?: string; additions?: number; deletions?: number; changes?: number }> }>(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/compare/${encodeURIComponent(`${base}...${head}`)}`, { method: 'GET' });
    return { status: body.status ?? 'unknown', aheadBy: body.ahead_by ?? 0, behindBy: body.behind_by ?? 0, ...(body.html_url === undefined ? {} : { htmlUrl: body.html_url }), files: (body.files ?? []).flatMap((file) => file.filename === undefined ? [] : [{ filename: file.filename, status: file.status ?? 'modified', additions: file.additions ?? 0, deletions: file.deletions ?? 0, changes: file.changes ?? 0 }]) };
  }

  public async getFile(owner: string, repository: string, path: string, ref?: string): Promise<GitHubFile> {
    const query = ref === undefined ? '' : `?ref=${encodeURIComponent(ref)}`;
    const body = await this.request<{ path?: string; sha?: string; encoding?: string; content?: string }>(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${path.split('/').map(encodeURIComponent).join('/')}${query}`, { method: 'GET' });
    if (body.path === undefined || body.sha === undefined || body.content === undefined) throw new Error('GitHub file response was incomplete');
    const content = body.encoding === 'base64' ? Buffer.from(body.content.replaceAll('\n', ''), 'base64').toString('utf8') : body.content;
    return { path: body.path, sha: body.sha, content };
  }

  public async listPullRequests(owner: string, repository: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubPullRequestSummary[]> {
    const pullRequests: GitHubPullRequestSummary[] = [];
    for (let page = 1; ; page += 1) {
      const body = await this.request<Array<{ number?: number; html_url?: string; title?: string; state?: 'open' | 'closed'; head?: { ref?: string }; base?: { ref?: string }; merged_at?: string | null; updated_at?: string }>>(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls?state=${state}&per_page=100&page=${page}`, { method: 'GET' });
      const pageItems = body.flatMap((item) => item.number === undefined || item.html_url === undefined || item.title === undefined || item.state === undefined || item.head?.ref === undefined || item.base?.ref === undefined ? [] : [{ number: item.number, htmlUrl: item.html_url, title: item.title, state: item.state, head: item.head.ref, base: item.base.ref, ...(item.merged_at === null || item.merged_at === undefined ? {} : { mergedAt: item.merged_at }), ...(item.updated_at === undefined ? {} : { updatedAt: item.updated_at }) }]);
      pullRequests.push(...pageItems);
      if (pageItems.length < 100) return pullRequests;
    }
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
