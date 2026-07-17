import { describe, expect, it } from 'vitest';
import { createApi, getApiConfig } from './api.js';

describe('web API client', () => {
  it('requires tenant config and sends tenant headers for live calls', async () => {
    expect(getApiConfig({})).toBeUndefined();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createApi({ baseUrl: 'http://server.test', organizationId: 'org-1' }, async (input, init) => { const call: { url: string; init?: RequestInit } = { url: String(input) }; if (init !== undefined) call.init = init; calls.push(call); const url = String(input); const body = url.endsWith('/schedules') ? { schedules: [] } : url.endsWith('/manifest') ? { id: 'login', schemaVersion: '1.0.0' } : url.endsWith('/repositories') ? { repositories: [] } : url.endsWith('/change-requests') ? { changeRequests: [] } : url.endsWith('/failures') ? { failures: [] } : url.endsWith('/artifacts') ? { artifacts: [] } : url.endsWith('/report') ? { runId: 'run-1', status: 'passed', reportUrl: '/report' } : url.includes('/tests/') ? { id: 'test-1', projectId: 'project-1', name: 'Login', manifestId: 'login', createdAt: new Date().toISOString() } : { tests: [] }; return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); });
    await api.listTests();
    await api.listSchedules();
    expect(calls[0]?.url).toBe('http://server.test/v1/organizations/org-1/tests');
    expect(calls[0]?.init?.headers).toMatchObject({ 'x-organization-id': 'org-1' });
    expect(calls[1]?.url).toBe('http://server.test/v1/organizations/org-1/schedules');
    await api.getTest('test-1');
    await api.getManifest('test-1');
    await api.updateManifest('test-1', { id: 'login', schemaVersion: '1.0.0' });
    await api.listRepositories();
    await api.listChangeRequests();
    await api.createChangeRequest('Add login coverage', 'Generated from source analysis');
    await api.updateChangeRequest('change-request-1', { status: 'approved' });
    await api.getRunFailures('run-1');
    await api.listArtifacts('run-1');
    await api.getReport('run-1');
    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining([
      'http://server.test/v1/tests/test-1',
      'http://server.test/v1/tests/test-1/manifest',
      'http://server.test/v1/organizations/org-1/repositories',
      'http://server.test/v1/organizations/org-1/change-requests',
      'http://server.test/v1/runs/run-1/failures',
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
        : { repositoryId: 'repo-1', pullRequest: { number: 7, htmlUrl: 'https://github.com/owner/repo/pull/7', head: 'testpilot/repair', base: 'main' }, local: { id: 'pr-1', url: 'https://github.com/owner/repo/pull/7' } };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    await api.syncRepository('repo-1');
    await api.createGitHubPullRequest('repo-1', { title: 'Repair', head: 'testpilot/repair', draft: true });
    expect(calls[0]?.url).toBe('https://pilot.test/v1/repositories/repo-1/sync');
    expect(calls[0]?.init?.headers).toMatchObject({ 'x-organization-id': 'org-1' });
    expect(calls[1]?.url).toBe('https://pilot.test/v1/repositories/repo-1/pull-requests');
    expect(calls[1]?.init?.method).toBe('POST');
    expect(calls[1]?.init?.body).toContain('testpilot/repair');
  });
});
