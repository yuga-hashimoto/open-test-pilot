import { describe, expect, it } from 'vitest';
import type { AgentResult } from '@open-test-pilot/agent-protocol';
import { createAiWorkerApiClient, runAiWorkerOnce, type AiWorkerApiClient } from './index.js';

describe('AI Worker daemon', () => {
  it('uses tenant-scoped registration, heartbeat, and lease endpoints', async () => {
    const calls: Array<{ url: string; method?: string; contentType?: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const requestHeaders = new Headers(init?.headers);
      const contentType = requestHeaders.get('content-type');
      calls.push({ url: String(input), ...(init?.method === undefined ? {} : { method: init.method }), ...(contentType === null ? {} : { contentType }) });
      const url = String(input);
      const body = url.endsWith('/ai-workers') ? { id: 'worker-1' } : url.includes('/jobs/lease') ? { job: null } : {};
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const api = createAiWorkerApiClient('http://server.test/', 'org-1', fetcher);
    expect(await api.registerWorker('worker', { allowedOperations: ['analyze'], maxRetries: 1, allowPublish: false })).toEqual({ id: 'worker-1' });
    await api.heartbeat('worker-1');
    await expect(api.lease('worker-1')).resolves.toBeUndefined();
    expect(calls.map((call) => call.url)).toEqual(['http://server.test/v1/organizations/org-1/ai-workers', 'http://server.test/v1/ai-workers/worker-1/heartbeat', 'http://server.test/v1/ai-workers/worker-1/jobs/lease']);
    expect(calls.every((call) => call.method === 'POST')).toBe(true);
    expect(calls[1]?.contentType).toBeUndefined();
    expect(calls[2]?.contentType).toBeUndefined();
  });

  it('adds the hosted session token to every API request without putting it in the body', async () => {
    let authorization = '';
    const fetcher: typeof fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({ job: null }), { status: 200 });
    };
    const api = createAiWorkerApiClient('http://server.test', 'org-1', fetcher, 'session-1');
    await api.lease('worker-1');
    expect(authorization).toBe('Bearer session-1');
  });

  it('leases a structured AgentRequest and completes the job with the worker result', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const request = { requestId: 'repair-1', protocolVersion: '1.0.0', operation: 'analyze-failure', repository: { url: 'https://github.com/example/repo.git', branch: 'main', commit: 'abc123' }, requestArtifacts: ['tests/login.yaml'] };
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
      const url = String(input);
      const body = url.endsWith('/ai-workers') ? { id: 'worker-1' } : url.includes('/jobs/lease') ? { job: { id: 'job-1', operation: 'analyze-failure', request } } : {};
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const result: AgentResult = { requestId: 'repair-1', protocolVersion: '1.0.0', status: 'completed', findings: [{ type: 'failure', severity: 'info', source: { file: 'tests/login.yaml' }, message: 'locator candidate' }] };
    const api: AiWorkerApiClient = createAiWorkerApiClient('http://server.test', 'org-1', fetcher);
    await expect(runAiWorkerOnce({ baseUrl: 'http://server.test', organizationId: 'org-1', name: 'worker', rootDirectory: '/tmp/worker', policy: { allowedOperations: ['analyze-failure'], maxRetries: 1, allowPublish: false }, workspace: { async prepare(actualRequest, rootDirectory) { expect(actualRequest).toMatchObject({ requestId: 'repair-1', operation: 'analyze-failure' }); return rootDirectory; } }, worker: { async handleInDirectory(actualRequest) { expect(actualRequest).toMatchObject({ requestId: 'repair-1', operation: 'analyze-failure' }); return result; } } }, api)).resolves.toBe(true);
    const completion = calls.find((call) => call.url.endsWith('/ai-worker-jobs/job-1/complete'));
    expect(completion?.body).toContain('"status":"completed"');
    expect(completion?.body).toContain('"requestId":"repair-1"');
  });

  it('forwards the hosted session token when constructing the one-shot client', async () => {
    let authorization = '';
    const fetcher: typeof fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      const url = String(_input);
      return new Response(JSON.stringify(url.endsWith('/ai-workers') ? { id: 'worker-1' } : url.includes('/jobs/lease') ? { job: null } : {}), { status: 200 });
    };
    await expect(runAiWorkerOnce({ baseUrl: 'http://server.test', organizationId: 'org-1', name: 'worker', rootDirectory: '/tmp/worker', sessionToken: 'session-1', fetcher })).resolves.toBe(false);
    expect(authorization).toBe('Bearer session-1');
  });

  it('does not complete a malformed job as a success', async () => {
    const completed: string[] = [];
    const api: AiWorkerApiClient = { async registerWorker() { return { id: 'worker-1' }; }, async heartbeat() {}, async lease() { return { id: 'job-1', operation: 'repair', request: { requestId: 'bad' } }; }, async complete(jobId, status) { completed.push(`${jobId}:${status}`); } };
    await expect(runAiWorkerOnce({ baseUrl: 'http://server.test', organizationId: 'org-1', name: 'worker', rootDirectory: '/tmp/worker' }, api)).resolves.toBe(true);
    expect(completed).toEqual(['job-1:failed']);
  });
});
