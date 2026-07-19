import { describe, expect, it } from 'vitest';
import {
  assertApiPolicy,
  assertJsonSchema,
  executeApiAction,
  readApiPath,
  type ApiAction,
  type ApiExecutionContext,
  type ApiTransport,
} from './index.js';

describe('API adapter', () => {
  it('executes JSON requests and validates status plus nested fields', async () => {
    const result = await executeApiAction({ method: 'POST', url: 'https://api.test/login', body: { email: 'a@test' }, expectedStatus: 201, jsonAssertions: { 'user.role': 'owner' } }, async (_input, init) => { expect(init?.body).toBe(JSON.stringify({ email: 'a@test' })); return new Response(JSON.stringify({ user: { role: 'owner' } }), { status: 201, headers: { 'content-type': 'application/json' } }); });
    expect(result.body).toEqual({ user: { role: 'owner' } });
  });

  it('fails with the exact status assertion', async () => {
    await expect(executeApiAction({ method: 'GET', url: 'https://api.test', expectedStatus: 200 }, async () => new Response('no', { status: 500 }))).rejects.toThrow('expected status 200 but received 500');
  });

  it('defaults expectedStatus to 200 for backward compatibility', async () => {
    const result = await executeApiAction({ method: 'GET', url: 'https://api.test/ok' }, async () => new Response('ok', { status: 200 }));
    expect(result.status).toBe(200);
  });

  it('appends query params with URLSearchParams and substitutes path params', async () => {
    let requested = '';
    await executeApiAction({
      method: 'GET',
      url: 'https://api.test/users/{id}/orders',
      pathParams: { id: '42' },
      query: { page: 2, active: true, q: 'a b' },
    }, async (input) => {
      requested = String(input);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const url = new URL(requested);
    expect(url.pathname).toBe('/users/42/orders');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('active')).toBe('true');
    expect(url.searchParams.get('q')).toBe('a b');
  });

  it('serializes JSON, text, and form bodies via contentType', async () => {
    const bodies: Array<string | undefined> = [];
    const headers: Array<string | null> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      bodies.push(typeof init?.body === 'string' ? init.body : undefined);
      const h = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers as Record<string, string> | undefined);
      headers.push(h.get('content-type'));
      return new Response('ok', { status: 200 });
    };

    await executeApiAction({ method: 'POST', url: 'https://api.test/json', body: { a: 1 }, contentType: 'application/json' }, fetcher);
    await executeApiAction({ method: 'POST', url: 'https://api.test/text', body: 'plain', contentType: 'text/plain' }, fetcher);
    await executeApiAction({ method: 'POST', url: 'https://api.test/form', body: { a: '1', b: 'two' }, contentType: 'application/x-www-form-urlencoded' }, fetcher);

    expect(bodies[0]).toBe(JSON.stringify({ a: 1 }));
    expect(headers[0]).toContain('application/json');
    expect(bodies[1]).toBe('plain');
    expect(headers[1]).toContain('text/plain');
    expect(bodies[2]).toBe(new URLSearchParams({ a: '1', b: 'two' }).toString());
    expect(headers[2]).toContain('application/x-www-form-urlencoded');
  });

  it('asserts response headers', async () => {
    await executeApiAction({
      method: 'GET',
      url: 'https://api.test/headers',
      assertHeaders: { 'x-request-id': 'abc-123', 'content-type': 'application/json' },
    }, async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'abc-123' } }));

    await expect(executeApiAction({
      method: 'GET',
      url: 'https://api.test/headers',
      assertHeaders: { 'x-request-id': 'missing' },
    }, async () => new Response('ok', { status: 200, headers: { 'x-request-id': 'other' } }))).rejects.toThrow(/header/i);
  });

  it('asserts response JSON Schema with AJV', async () => {
    await executeApiAction({
      method: 'GET',
      url: 'https://api.test/schema',
      responseSchema: {
        type: 'object',
        required: ['id', 'email'],
        properties: { id: { type: 'integer' }, email: { type: 'string', format: 'email' } },
        additionalProperties: false,
      },
    }, async () => new Response(JSON.stringify({ id: 1, email: 'a@test.com' }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(executeApiAction({
      method: 'GET',
      url: 'https://api.test/schema',
      responseSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
    }, async () => new Response(JSON.stringify({ id: 'nope' }), { status: 200, headers: { 'content-type': 'application/json' } }))).rejects.toThrow(/schema/i);
  });

  it('normalizes $.path and path for jsonAssertions and readApiPath', async () => {
    expect(readApiPath({ email: 'a@test.com', user: { role: 'owner' } }, '$.email')).toBe('a@test.com');
    expect(readApiPath({ email: 'a@test.com', user: { role: 'owner' } }, 'email')).toBe('a@test.com');
    expect(readApiPath({ email: 'a@test.com', user: { role: 'owner' } }, '$.user.role')).toBe('owner');
    expect(readApiPath({ email: 'a@test.com', user: { role: 'owner' } }, 'user.role')).toBe('owner');

    await executeApiAction({
      method: 'GET',
      url: 'https://api.test/path',
      jsonAssertions: { '$.email': 'a@test.com', 'user.role': 'owner' },
    }, async () => new Response(JSON.stringify({ email: 'a@test.com', user: { role: 'owner' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  });

  it('enforces per-request timeoutMs via abort signal', async () => {
    await expect(executeApiAction({
      method: 'GET',
      url: 'https://api.test/slow',
      timeoutMs: 20,
    }, async (_input, init) => {
      const signal = init?.signal;
      expect(signal).toBeDefined();
      return await new Promise<Response>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('should have aborted')), 200);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    })).rejects.toThrow(/abort|timeout/i);
  });

  it('rejects loopback, link-local, and cloud metadata hosts unless allowedHosts permits them', () => {
    expect(() => assertApiPolicy('http://127.0.0.1/secret')).toThrow(/host|policy|blocked/i);
    expect(() => assertApiPolicy('http://localhost/secret')).toThrow(/host|policy|blocked/i);
    expect(() => assertApiPolicy('http://[::1]/secret')).toThrow(/host|policy|blocked/i);
    expect(() => assertApiPolicy('http://169.254.169.254/latest/meta-data')).toThrow(/host|policy|blocked/i);
    expect(() => assertApiPolicy('http://169.254.1.1/link-local')).toThrow(/host|policy|blocked/i);
    expect(() => assertApiPolicy('https://api.example.com/ok')).not.toThrow();
    expect(() => assertApiPolicy('http://127.0.0.1/secret', { allowedHosts: ['127.0.0.1'] })).not.toThrow();
    expect(() => assertApiPolicy('https://api.example.com/ok', { allowedHosts: ['other.example.com'] })).toThrow(/host|policy|allow/i);
  });

  it('applies host policy during executeApiAction before fetching', async () => {
    let called = false;
    await expect(executeApiAction({
      method: 'GET',
      url: 'http://127.0.0.1:9/blocked',
    }, async () => {
      called = true;
      return new Response('no', { status: 200 });
    })).rejects.toThrow(/host|policy|blocked/i);
    expect(called).toBe(false);

    const result = await executeApiAction({
      method: 'GET',
      url: 'http://127.0.0.1:9/ok',
      allowedHosts: ['127.0.0.1'],
    }, async () => new Response('ok', { status: 200 }));
    expect(result.status).toBe(200);
  });

  it('accepts ApiExecutionContext and ApiTransport while remaining two-arg fetcher compatible', async () => {
    const transport: ApiTransport = {
      async request(input) {
        expect(input.method).toBe('GET');
        expect(input.url).toContain('https://api.test/transport');
        return { status: 200, headers: { 'content-type': 'application/json' }, body: { ok: true }, durationMs: 1 };
      },
    };
    const context: ApiExecutionContext = { transport, allowedHosts: ['api.test'] };
    const viaTransport = await executeApiAction({ method: 'GET', url: 'https://api.test/transport' }, context);
    expect(viaTransport.body).toEqual({ ok: true });

    const viaFetcher = await executeApiAction({ method: 'GET', url: 'https://api.test/fetcher' } satisfies ApiAction, async () => new Response('ok', { status: 200 }));
    expect(viaFetcher.status).toBe(200);
  });

  it('exposes assertJsonSchema helper', () => {
    expect(() => assertJsonSchema({ id: 1 }, { type: 'object', required: ['id'], properties: { id: { type: 'number' } } })).not.toThrow();
    expect(() => assertJsonSchema({ id: 'x' }, { type: 'object', required: ['id'], properties: { id: { type: 'number' } } })).toThrow(/schema/i);
  });

  it('returns captured fields metadata when capture is set', async () => {
    const result = await executeApiAction({
      method: 'GET',
      url: 'https://api.test/capture',
      capture: 'always',
    }, async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(result.capture).toBe('always');
  });
});
