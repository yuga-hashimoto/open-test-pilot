import { describe, expect, it } from 'vitest';
import { MemoryExecutionQueue } from './index.js';

const job = (organizationId: string) => ({ jobId: 'job-1', runId: 'run-1', organizationId, manifest: { schemaVersion: '1.0.0', id: 'login', name: 'Login' }, requestedCapabilities: { browsers: ['chromium'], maxConcurrency: 1 }, status: 'queued' as const, createdAt: new Date().toISOString(), requiredLabels: ['linux'] });

describe('execution queue', () => {
  it('registers, leases, and completes a tenant-scoped job', async () => {
    const queue = new MemoryExecutionQueue();
    const runner = await queue.registerRunner('org-1', 'runner', { browsers: ['chromium'], maxConcurrency: 1, labels: ['linux'] });
    expect(await queue.listRunners('org-1')).toEqual([runner]);
    expect(await queue.enqueue('org-1', job('org-1'))).toBe(true);
    expect(await queue.lease('org-1', runner.runnerId)).toMatchObject({ jobId: 'job-1', status: 'leased' });
    expect(await queue.complete('org-1', 'job-1', 'passed')).toMatchObject({ status: 'passed' });
  });
  it('rejects duplicate and cross-tenant enqueue', async () => {
    const queue = new MemoryExecutionQueue();
    expect(await queue.enqueue('org-2', job('org-1'))).toBe(false);
    expect(await queue.enqueue('org-1', job('org-1'))).toBe(true);
    expect(await queue.enqueue('org-1', job('org-1'))).toBe(false);
  });
  it('never leases a job from another organization', async () => {
    const queue = new MemoryExecutionQueue();
    const orgTwoRunner = await queue.registerRunner('org-2', 'runner-2', { browsers: ['chromium'], maxConcurrency: 1, labels: ['linux'] });
    const orgOneRunner = await queue.registerRunner('org-1', 'runner-1', { browsers: ['chromium'], maxConcurrency: 1, labels: ['linux'] });

    expect(await queue.enqueue('org-1', job('org-1'))).toBe(true);
    expect(await queue.lease('org-2', orgTwoRunner.runnerId)).toBeUndefined();
    expect(await queue.lease('org-1', orgOneRunner.runnerId)).toMatchObject({ organizationId: 'org-1', status: 'leased' });
  });

  it('reassigns an abandoned memory lease after its expiry', async () => {
    const queue = new MemoryExecutionQueue(1);
    const first = await queue.registerRunner('org-1', 'first', { browsers: ['chromium'], maxConcurrency: 1, labels: ['linux'] });
    const second = await queue.registerRunner('org-1', 'second', { browsers: ['chromium'], maxConcurrency: 1, labels: ['linux'] });
    expect(await queue.enqueue('org-1', job('org-1'))).toBe(true);
    expect(await queue.lease('org-1', first.runnerId)).toMatchObject({ status: 'leased' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await queue.lease('org-1', second.runnerId)).toMatchObject({ jobId: 'job-1', status: 'leased' });
  });

  it('cancels a queued or leased job without allowing a later lease', async () => {
    const queue = new MemoryExecutionQueue();
    const runner = await queue.registerRunner('org-1', 'runner', { browsers: ['chromium'], maxConcurrency: 1, labels: ['linux'] });
    expect(await queue.enqueue('org-1', job('org-1'))).toBe(true);
    expect(await queue.cancel('org-1', 'job-1')).toMatchObject({ status: 'cancelled' });
    expect(await queue.lease('org-1', runner.runnerId)).toBeUndefined();
  });
});
