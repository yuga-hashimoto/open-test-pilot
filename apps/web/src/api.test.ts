import { describe, expect, it } from 'vitest';
import { createApi, createAuthApi, getApiConfig, getApiServerBaseUrl } from './api.js';

describe('web API client', () => {
  it('supports OAuth start, callback completion, and tenant bootstrap without exposing GitHub tokens', async () => {
    expect(getApiServerBaseUrl({ VITE_OPENTESTPILOT_URL: 'https://pilot.test/' })).toBe('https://pilot.test');
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const auth = createAuthApi('https://pilot.test', async (input, init) => {
      calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
      const url = String(input);
      const body = url.includes('/auth/github/start')
        ? { authorizationUrl: 'https://github.com/login/oauth/authorize?state=state-1' }
        : url.includes('/auth/github/callback')
          ? { authenticated: true, sessionToken: 'session-1', expiresAt: '2030-01-01T00:00:00.000Z', login: 'qa-user', scope: 'read:user' }
          : url.endsWith('/me/organizations')
            ? { organizations: [{ id: 'org-1', name: 'QA', createdAt: '2026-01-01T00:00:00.000Z' }] }
            : { id: 'org-2', name: 'New QA', createdAt: '2026-01-02T00:00:00.000Z' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await expect(auth.startLogin('http://localhost:4173/auth/github/callback')).resolves.toMatchObject({ authorizationUrl: expect.stringContaining('state=') });
    await expect(auth.completeLogin('code/1', 'state/1')).resolves.toMatchObject({ login: 'qa-user' });
    await expect(auth.listOrganizations('session-1')).resolves.toEqual([expect.objectContaining({ id: 'org-1' })]);
    await expect(auth.createOrganization('session-1', 'New QA')).resolves.toMatchObject({ id: 'org-2' });
    expect(calls[2]?.init?.headers).toMatchObject({ authorization: 'Bearer session-1' });
    expect(calls[3]?.init?.headers).toMatchObject({ authorization: 'Bearer session-1' });
    expect(calls[3]?.init?.body).toBe(JSON.stringify({ name: 'New QA' }));
  });

  it('requires tenant config and sends tenant headers for live calls', async () => {
    expect(getApiConfig({})).toBeUndefined();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createApi({ baseUrl: 'http://server.test', organizationId: 'org-1' }, async (input, init) => { const call: { url: string; init?: RequestInit } = { url: String(input) }; if (init !== undefined) call.init = init; calls.push(call); const url = String(input); const body = url.endsWith('/schedules') ? { schedules: [] } : url.endsWith('/manifest/versions') ? { testId: 'test-1', versions: [] } : url.endsWith('/manifest') ? { id: 'login', schemaVersion: '1.0.0' } : url.endsWith('/repositories') ? { repositories: [] } : url.endsWith('/change-requests') ? { changeRequests: [] } : url.endsWith('/failures') ? { failures: [] } : url.endsWith('/result') ? { runId: 'run-1', result: { failures: [], steps: [] } } : url.endsWith('/artifacts') ? { artifacts: [] } : url.endsWith('/report') ? { runId: 'run-1', status: 'passed', reportUrl: '/report' } : url.includes('/tests/') ? { id: 'test-1', projectId: 'project-1', name: 'Login', manifestId: 'login', createdAt: new Date().toISOString() } : { tests: [] }; return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); });
    await api.listTests();
    await api.listSchedules();
    expect(calls[0]?.url).toBe('http://server.test/v1/organizations/org-1/tests');
    expect(calls[0]?.init?.headers).toMatchObject({ 'x-organization-id': 'org-1' });
    expect(calls[1]?.url).toBe('http://server.test/v1/organizations/org-1/schedules');
    await api.getTest('test-1');
    await api.getManifest('test-1');
    await api.listManifestVersions('test-1');
    await api.updateManifest('test-1', { id: 'login', schemaVersion: '1.0.0' });
    await api.listRepositories();
    await api.listChangeRequests();
    await api.createChangeRequest('Add login coverage', 'Generated from source analysis');
    await api.updateChangeRequest('change-request-1', { status: 'approved' });
    await api.getRunFailures('run-1');
    await api.getRunResult('run-1');
    await api.listArtifacts('run-1');
    await api.getReport('run-1');
    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining([
      'http://server.test/v1/tests/test-1',
      'http://server.test/v1/tests/test-1/manifest',
      'http://server.test/v1/tests/test-1/manifest/versions',
      'http://server.test/v1/organizations/org-1/repositories',
      'http://server.test/v1/organizations/org-1/change-requests',
      'http://server.test/v1/runs/run-1/failures',
      'http://server.test/v1/runs/run-1/result',
      'http://server.test/v1/runs/run-1/artifacts',
      'http://server.test/v1/runs/run-1/report',
    ]));
    expect(calls.find((call) => call.url.endsWith('/manifest') && call.init?.method === 'PUT')?.init?.method).toBe('PUT');
  });

  it('adds the OAuth session bearer token when hosted auth is enabled', async () => {
    expect(getApiConfig({ VITE_OPENTESTPILOT_URL: 'https://pilot.test', VITE_OPENTESTPILOT_ORGANIZATION_ID: 'org-1', VITE_OPENTESTPILOT_SESSION_TOKEN: 'session-1' })).toMatchObject({ sessionToken: 'session-1' });
    let received: HeadersInit | undefined;
    const api = createApi({ baseUrl: 'https://pilot.test', organizationId: 'org-1', sessionToken: 'session-1' }, async (_input, init) => { received = init?.headers; return new Response(JSON.stringify({ tests: [] }), { status: 200 }); });
    await api.listTests();
    expect(received).toMatchObject({ authorization: 'Bearer session-1', 'x-organization-id': 'org-1' });
  });

  it('calls tenant-scoped GitHub sync and draft pull-request endpoints', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createApi({ baseUrl: 'https://pilot.test', organizationId: 'org-1' }, async (input, init) => {
      calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
      const body = String(input).endsWith('/sync')
        ? { id: 'repo-1', owner: 'owner', name: 'repo', fullName: 'owner/repo', defaultBranch: 'main', private: false, provider: 'github', createdAt: new Date().toISOString() }
        : String(input).endsWith('/branches') ? { repositoryId: 'repo-1', branch: 'testpilot/repair', baseSha: 'base-sha' }
          : String(input).endsWith('/contents') ? { repositoryId: 'repo-1', branch: 'testpilot/repair', path: 'tests/login.yaml', commitSha: 'commit-1' }
        : { repositoryId: 'repo-1', pullRequest: { number: 7, htmlUrl: 'https://github.com/owner/repo/pull/7', head: 'testpilot/repair', base: 'main' }, local: { id: 'pr-1', url: 'https://github.com/owner/repo/pull/7' } };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    await api.syncRepository('repo-1');
    await api.createBranch('repo-1', { branch: 'testpilot/repair', baseSha: 'base-sha' });
    await api.commitFile('repo-1', { branch: 'testpilot/repair', path: 'tests/login.yaml', content: 'name: Login', message: 'test: repair' });
    await api.createGitHubPullRequest('repo-1', { title: 'Repair', head: 'testpilot/repair', draft: true });
    expect(calls[0]?.url).toBe('https://pilot.test/v1/repositories/repo-1/sync');
    expect(calls[0]?.init?.headers).toMatchObject({ 'x-organization-id': 'org-1' });
    expect(calls[1]?.url).toBe('https://pilot.test/v1/repositories/repo-1/branches');
    expect(calls[1]?.init?.method).toBe('POST');
    expect(calls[1]?.init?.body).toContain('testpilot/repair');
    expect(calls[2]?.url).toBe('https://pilot.test/v1/repositories/repo-1/contents');
    expect(calls[2]?.init?.method).toBe('PUT');
    expect(calls[3]?.url).toBe('https://pilot.test/v1/repositories/repo-1/pull-requests');
  });

  it('loads GitHub branches and a comparison for diff review', async () => {
    const calls: string[] = [];
    const api = createApi({ baseUrl: 'https://pilot.test', organizationId: 'org-1' }, async (input) => { calls.push(String(input)); const body = String(input).includes('/compare') ? { repositoryId: 'repo-1', base: 'main', head: 'repair', comparison: { status: 'ahead', aheadBy: 1, behindBy: 0, files: [] } } : { repositoryId: 'repo-1', branches: [{ name: 'main', sha: 'sha-1' }] }; return new Response(JSON.stringify(body), { status: 200 }); });
    await expect(api.listBranches('repo-1')).resolves.toEqual([{ name: 'main', sha: 'sha-1' }]);
    await expect(api.compareBranches('repo-1', 'main', 'repair')).resolves.toMatchObject({ base: 'main', head: 'repair' });
    expect(calls).toEqual(['https://pilot.test/v1/repositories/repo-1/branches', 'https://pilot.test/v1/repositories/repo-1/compare?base=main&head=repair']);
  });

  it('loads a Manifest file and open or closed pull request history', async () => {
    const calls: string[] = [];
    const api = createApi({ baseUrl: 'https://pilot.test', organizationId: 'org-1' }, async (input) => {
      const url = String(input);
      calls.push(url);
      const body = url.includes('/contents')
        ? { repositoryId: 'repo-1', file: { path: 'tests/login.yaml', sha: 'sha-1', content: 'name: Login\n' } }
        : { repositoryId: 'repo-1', state: 'all', pullRequests: [{ number: 12, htmlUrl: 'https://github.com/owner/repo/pull/12', title: 'Closed repair', state: 'closed', head: 'repair/12', base: 'main' }] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    await expect(api.getRepositoryFile('repo-1', 'tests/login.yaml', 'main')).resolves.toMatchObject({ content: 'name: Login\n', sha: 'sha-1' });
    await expect(api.listPullRequests('repo-1', 'all')).resolves.toEqual([expect.objectContaining({ number: 12, state: 'closed' })]);
    expect(calls).toEqual(['https://pilot.test/v1/repositories/repo-1/contents?path=tests%2Flogin.yaml&ref=main', 'https://pilot.test/v1/repositories/repo-1/pull-requests?state=all']);
  });

  it('loads and updates the tenant administration surface', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createApi({ baseUrl: 'https://pilot.test', organizationId: 'org-1' }, async (input, init) => {
      calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
      const url = String(input);
      const body = url.endsWith('/projects') ? { projects: [] }
        : url.endsWith('/members') ? { members: [] }
          : url.endsWith('/audit-logs') ? { events: [] }
            : url.endsWith('/storage-policy') ? { organizationId: 'org-1', successRetentionDays: 30, failureRetentionDays: 180, fixedRetention: false, generatedCodeRetentionDays: 30, updatedAt: new Date().toISOString() }
              : url.endsWith('/ai-worker-jobs') ? { jobs: [] }
                : { workers: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    await api.listProjects();
    await api.listMembers();
    await api.listAuditLogs();
    await api.getStoragePolicy();
    await api.updateStoragePolicy({ successRetentionDays: 7 });
    await api.listAiWorkers();
    await api.listAiWorkerJobs();
    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining([
      'https://pilot.test/v1/organizations/org-1/projects',
      'https://pilot.test/v1/organizations/org-1/members',
      'https://pilot.test/v1/organizations/org-1/audit-logs',
      'https://pilot.test/v1/organizations/org-1/storage-policy',
      'https://pilot.test/v1/organizations/org-1/ai-workers',
      'https://pilot.test/v1/organizations/org-1/ai-worker-jobs',
    ]));
    expect(calls.find((call) => call.url.endsWith('/storage-policy') && call.init?.method === 'PUT')?.init?.body).toContain('7');
  });

  it('creates, lists, and rotates secrets without putting values in client state', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createApi({ baseUrl: 'https://pilot.test', organizationId: 'org-1' }, async (input, init) => {
      calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
      const url = String(input);
      const body = url.endsWith('/secrets') ? { secrets: [{ id: 'secret-1', name: 'token', provider: 'builtin', maskedValue: 'to****en', organizationId: 'org-1', createdAt: new Date().toISOString() }] } : { id: 'secret-1', name: 'token', provider: 'builtin', maskedValue: 'ro****ed', organizationId: 'org-1', createdAt: new Date().toISOString() };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const created = await api.createSecret({ name: 'token', provider: 'builtin', value: 'secret-value' });
    expect(created).not.toHaveProperty('value');
    await api.listSecrets();
    await api.rotateSecret('secret-1', 'rotated-value');
    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining(['https://pilot.test/v1/organizations/org-1/secrets', 'https://pilot.test/v1/secrets/secret-1/rotate']));
    expect(calls.find((call) => call.url.endsWith('/rotate'))?.init?.body).toContain('rotated-value');
  });

  it('creates a test from a project, name, manifest id, and optional manifest', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createApi({ baseUrl: 'https://pilot.test', organizationId: 'org-1' }, async (input, init) => {
      calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
      return new Response(JSON.stringify({ id: 'test-1', projectId: 'project-1', name: 'Checkout flow', manifestId: 'checkout-flow', createdAt: new Date().toISOString() }), { status: 201 });
    });
    await expect(api.createTest('project-1', 'Checkout flow', 'checkout-flow', { schemaVersion: '1.0.0', id: 'checkout-flow' })).resolves.toMatchObject({ id: 'test-1', manifestId: 'checkout-flow' });
    expect(calls[0]?.url).toBe('https://pilot.test/v1/organizations/org-1/tests');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toMatchObject({ 'x-organization-id': 'org-1', 'content-type': 'application/json' });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ projectId: 'project-1', name: 'Checkout flow', manifestId: 'checkout-flow', manifest: { schemaVersion: '1.0.0', id: 'checkout-flow' } });
    await api.createTest('project-1', 'No manifest test', 'no-manifest-test');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ projectId: 'project-1', name: 'No manifest test', manifestId: 'no-manifest-test' });
  });

  it('cancels a queued run through the job endpoint', async () => {
    let requested = '';
    const api = createApi({ baseUrl: 'https://pilot.test', organizationId: 'org-1' }, async (input) => { requested = String(input); return new Response(JSON.stringify({ runId: 'run-1', status: 'cancelled' }), { status: 200 }); });
    await expect(api.cancelRun('run-1')).resolves.toEqual({ runId: 'run-1', status: 'cancelled' });
    expect(requested).toBe('https://pilot.test/v1/jobs/job-run-1/cancel');
  });
});
