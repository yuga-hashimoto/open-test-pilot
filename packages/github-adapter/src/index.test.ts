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
});
