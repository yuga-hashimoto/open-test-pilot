import { describe, expect, it } from 'vitest';
import { createApi, getApiConfig } from './api.js';

describe('web API client', () => {
  it('requires tenant config and sends tenant headers for live calls', async () => {
    expect(getApiConfig({})).toBeUndefined();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createApi({ baseUrl: 'http://server.test', organizationId: 'org-1' }, async (input, init) => { const call: { url: string; init?: RequestInit } = { url: String(input) }; if (init !== undefined) call.init = init; calls.push(call); const url = String(input); const body = url.endsWith('/schedules') ? { schedules: [] } : url.endsWith('/manifest') ? { id: 'login', schemaVersion: '1.0.0' } : url.includes('/tests/') ? { id: 'test-1', projectId: 'project-1', name: 'Login', manifestId: 'login', createdAt: new Date().toISOString() } : { tests: [] }; return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); });
    await api.listTests();
    await api.listSchedules();
    expect(calls[0]?.url).toBe('http://server.test/v1/organizations/org-1/tests');
    expect(calls[0]?.init?.headers).toMatchObject({ 'x-organization-id': 'org-1' });
    expect(calls[1]?.url).toBe('http://server.test/v1/organizations/org-1/schedules');
    await api.getTest('test-1');
    await api.getManifest('test-1');
    await api.updateManifest('test-1', { id: 'login', schemaVersion: '1.0.0' });
    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining([
      'http://server.test/v1/tests/test-1',
      'http://server.test/v1/tests/test-1/manifest',
    ]));
    expect(calls.at(-1)?.init?.method).toBe('PUT');
  });
});
