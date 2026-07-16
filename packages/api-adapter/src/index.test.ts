import { describe, expect, it } from 'vitest';
import { executeApiAction } from './index.js';

describe('API adapter', () => {
  it('executes JSON requests and validates status plus nested fields', async () => {
    const result = await executeApiAction({ method: 'POST', url: 'https://api.test/login', body: { email: 'a@test' }, expectedStatus: 201, jsonAssertions: { 'user.role': 'owner' } }, async (_input, init) => { expect(init?.body).toBe(JSON.stringify({ email: 'a@test' })); return new Response(JSON.stringify({ user: { role: 'owner' } }), { status: 201, headers: { 'content-type': 'application/json' } }); });
    expect(result.body).toEqual({ user: { role: 'owner' } });
  });
  it('fails with the exact status assertion', async () => { await expect(executeApiAction({ method: 'GET', url: 'https://api.test', expectedStatus: 200 }, async () => new Response('no', { status: 500 }))).rejects.toThrow('expected status 200 but received 500'); });
});
