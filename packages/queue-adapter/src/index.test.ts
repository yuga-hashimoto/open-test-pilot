import { describe, expect, it } from 'vitest';
import { MemoryExecutionQueue } from './index.js';

const job = (organizationId: string) => ({ jobId: 'job-1', runId: 'run-1', organizationId, manifest: { schemaVersion: '1.0.0', id: 'login', name: 'Login' }, requestedCapabilities: { browsers: ['chromium'], maxConcurrency: 1 }, status: 'queued' as const, createdAt: new Date().toISOString(), requiredLabels: ['linux'] });

describe('execution queue', () => {
  it('registers, leases, and completes a tenant-scoped job', async () => {
    const queue = new MemoryExecutionQueue();
    const runner = await queue.registerRunner('org-1', 'runner', { browsers: ['chromium'], maxConcurrency: 1, labels: ['linux'] });
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
});
