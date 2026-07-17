import { describe, expect, it, vi } from 'vitest';
import { createRunnerClient, runJobWithHeartbeat, type RunnerClient } from './index.js';
import type { Job } from '@open-test-pilot/runner-protocol';

describe('createRunnerClient', () => {
  it('does not send an empty JSON body for heartbeat', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ runnerId: 'runner-1', heartbeatAt: new Date().toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await createRunnerClient('http://runner.test', 'org-1').heartbeat('runner-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://runner.test/v1/runners/runner-1/heartbeat',
      expect.objectContaining({ method: 'POST', headers: { accept: 'application/json', 'x-organization-id': 'org-1' } }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');
  });

  it('forwards the hosted session token to runner API calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ runnerId: 'runner-1' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await createRunnerClient('http://runner.test', 'org-1', 'session-1').register('runner', { browsers: ['chromium'], maxConcurrency: 1 });
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer session-1' }) }));
  });

  it('keeps a long-running lease alive and stops heartbeats after execution', async () => {
    const heartbeat = vi.fn(async () => undefined);
    const client = { heartbeat } as unknown as RunnerClient;
    const job: Job = { jobId: 'job-heartbeat', runId: 'run-heartbeat', manifest: { schemaVersion: '1.0.0', id: 'smoke', name: 'Smoke' }, requestedCapabilities: { browsers: ['chromium'], maxConcurrency: 1 }, status: 'leased', createdAt: new Date().toISOString() };
    const result = await runJobWithHeartbeat(client, 'runner-1', job, 5, async () => { await new Promise((resolve) => setTimeout(resolve, 60)); return { exitCode: 0, stdout: '', stderr: '' }; });
    expect(result.exitCode).toBe(0);
    expect(heartbeat.mock.calls.length).toBeGreaterThanOrEqual(3);
    const countAfterExecution = heartbeat.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 12));
    expect(heartbeat.mock.calls.length).toBe(countAfterExecution);
  });
});
