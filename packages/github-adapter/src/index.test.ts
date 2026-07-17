import { createHmac, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildGitHubAppJwt, buildGitHubAuthorizationUrl, GitHubApiClient, verifyWebhookSignature } from './index.js';

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

  it('supports branch, commit, pull request, check, status, and comment writes', async () => {
    const requests: Request[] = [];
    const client = new GitHubApiClient('installation-token', async (input, init) => { requests.push(new Request(input, init)); const url = String(input); const body = url.includes('/pulls') ? { number: 7, html_url: 'https://github.com/org/repo/pull/7', head: { ref: 'repair/1' }, base: { ref: 'main' } } : url.includes('/check-runs') ? { id: 8, html_url: 'https://github.com/check/8' } : url.includes('/comments') ? { id: 9 } : url.includes('/contents/') ? { commit: { sha: 'commit-1' } } : {}; return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); });
    await client.createBranch('org', 'repo', 'repair/1', 'base-1');
    await client.commitFile('org', 'repo', { branch: 'repair/1', path: 'tests/login.yaml', content: 'name: Login\n', message: 'test: propose repaired manifest' });
    await client.createPullRequest('org', 'repo', { title: 'Repair login test', head: 'repair/1', base: 'main' });
    await client.createCheckRun('org', 'repo', { name: 'OpenTestPilot', headSha: 'commit-1', status: 'completed', conclusion: 'success' });
    await client.createCommitStatus('org', 'repo', 'commit-1', 'success', 'OpenTestPilot passed');
    await client.createIssueComment('org', 'repo', 7, 'Repair proposal is ready.');
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual(expect.arrayContaining(['POST https://api.github.com/repos/org/repo/git/refs', 'PUT https://api.github.com/repos/org/repo/contents/tests/login.yaml', 'POST https://api.github.com/repos/org/repo/pulls', 'POST https://api.github.com/repos/org/repo/check-runs', 'POST https://api.github.com/repos/org/repo/statuses/commit-1', 'POST https://api.github.com/repos/org/repo/issues/7/comments']));
  });

  it('lists repositories available to an App installation with pagination', async () => {
    const requests: string[] = [];
    const client = new GitHubApiClient('installation-token', async (input) => { requests.push(String(input)); const page = String(input).includes('page=2') ? { repositories: [{ id: 2, full_name: 'org/two', default_branch: 'main', private: true, owner: { login: 'org' }, name: 'two' }], total_count: 2 } : { repositories: [{ id: 1, full_name: 'org/one', default_branch: 'trunk', private: false, owner: { login: 'org' }, name: 'one' }], total_count: 2 }; return new Response(JSON.stringify(page), { status: 200 }); });
    await expect(client.listInstallationRepositories()).resolves.toEqual([expect.objectContaining({ fullName: 'org/one' }), expect.objectContaining({ fullName: 'org/two' })]);
    expect(requests).toHaveLength(2);
  });

  it('reads branches and a focused branch comparison for repository diff views', async () => {
    const requests: string[] = [];
    const client = new GitHubApiClient('installation-token', async (input) => {
      const url = String(input);
      requests.push(url);
      const body = url.includes('/compare/') ? { status: 'ahead', ahead_by: 2, behind_by: 0, html_url: 'https://github.com/org/repo/compare/main...repair', files: [{ filename: 'tests/login.yaml', status: 'modified', additions: 3, deletions: 1, changes: 4 }] } : [{ name: 'main', commit: { sha: 'base-sha' } }, { name: 'repair', commit: { sha: 'head-sha' } }];
      return new Response(JSON.stringify(body), { status: 200 });
    });
    await expect(client.listBranches('org', 'repo')).resolves.toEqual([{ name: 'main', sha: 'base-sha' }, { name: 'repair', sha: 'head-sha' }]);
    await expect(client.compareBranches('org', 'repo', 'main', 'repair')).resolves.toMatchObject({ status: 'ahead', aheadBy: 2, files: [{ filename: 'tests/login.yaml', additions: 3 }] });
    expect(requests).toEqual(expect.arrayContaining(['https://api.github.com/repos/org/repo/branches?per_page=100', 'https://api.github.com/repos/org/repo/compare/main...repair']));
  });

  it('reads repository contents and keeps open and closed PR history distinct', async () => {
    const requests: string[] = [];
    const client = new GitHubApiClient('installation-token', async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/contents/tests/login.yaml')) return new Response(JSON.stringify({ path: 'tests/login.yaml', sha: 'manifest-sha', encoding: 'base64', content: Buffer.from('name: Login\n').toString('base64') }), { status: 200 });
      return new Response(JSON.stringify([{ number: 12, html_url: 'https://github.com/org/repo/pull/12', title: 'Repair login', state: 'closed', merged_at: '2026-07-17T00:00:00Z', updated_at: '2026-07-17T00:00:00Z', head: { ref: 'repair/login' }, base: { ref: 'main' } }]), { status: 200 });
    });
    await expect(client.getFile('org', 'repo', 'tests/login.yaml', 'main')).resolves.toEqual({ path: 'tests/login.yaml', sha: 'manifest-sha', content: 'name: Login\n' });
    await expect(client.listPullRequests('org', 'repo', 'all')).resolves.toEqual([{ number: 12, htmlUrl: 'https://github.com/org/repo/pull/12', title: 'Repair login', state: 'closed', head: 'repair/login', base: 'main', mergedAt: '2026-07-17T00:00:00Z', updatedAt: '2026-07-17T00:00:00Z' }]);
    expect(requests).toEqual(expect.arrayContaining(['https://api.github.com/repos/org/repo/contents/tests/login.yaml?ref=main', 'https://api.github.com/repos/org/repo/pulls?state=all&per_page=100&page=1']));
  });

  it('resolves the authenticated OAuth user without returning the OAuth token', async () => {
    const client = new GitHubApiClient('oauth-token', async (input, init) => {
      expect(String(input)).toBe('https://api.github.com/user');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer oauth-token');
      return new Response(JSON.stringify({ id: 42, login: 'qa-user' }), { status: 200 });
    });
    await expect(client.getAuthenticatedUser()).resolves.toEqual({ id: 42, login: 'qa-user' });
  });
});
