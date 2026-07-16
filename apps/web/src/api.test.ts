import { describe, expect, it } from 'vitest';
import { createApi, getApiConfig } from './api.js';

describe('web API client', () => {
  it('requires tenant config and sends tenant headers for live calls', async () => {
    expect(getApiConfig({})).toBeUndefined();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createApi({ baseUrl: 'http://server.test', organizationId: 'org-1' }, async (input, init) => { const call: { url: string; init?: RequestInit } = { url: String(input) }; if (init !== undefined) call.init = init; calls.push(call); return new Response(JSON.stringify({ tests: [] }), { status: 200, headers: { 'content-type': 'application/json' } }); });
    await api.listTests();
    expect(calls[0]?.url).toBe('http://server.test/v1/organizations/org-1/tests');
    expect(calls[0]?.init?.headers).toMatchObject({ 'x-organization-id': 'org-1' });
  });
});
