import { describe, expect, it } from 'vitest';
import type { Capabilities, Job } from '@open-test-pilot/runner-protocol';
import { Scheduler } from './index.js';

const job = (id: string, priority: number, browser: string): Job => ({
  jobId: id,
  runId: `run-${id}`,
  manifest: { schemaVersion: '1.0.0', id: 'login', name: 'Login' },
  requestedCapabilities: { browsers: [browser], maxConcurrency: 1 },
  status: 'queued',
  createdAt: new Date().toISOString(),
  priority,
});

const runner = (id: string, browsers: string[], labels: string[] = []): Capabilities & { runnerId: string; labels: string[] } => ({
  runnerId: id,
  browsers,
  labels,
  maxConcurrency: 1,
});

describe('Scheduler', () => {
  it('assigns the highest-priority compatible job first', () => {
    const scheduler = new Scheduler();
    scheduler.enqueue(job('low', 1, 'chromium'));
    scheduler.enqueue(job('high', 10, 'chromium'));
    expect(scheduler.leaseNext(runner('r1', ['chromium']))?.jobId).toBe('high');
  });

  it('does not lease a job to an incompatible runner', () => {
    const scheduler = new Scheduler();
    scheduler.enqueue(job('webkit', 10, 'webkit'));
    expect(scheduler.leaseNext(runner('r1', ['chromium']))).toBeUndefined();
    expect(scheduler.size).toBe(1);
  });

  it('prevents duplicate enqueue and requeues an expired lease', () => {
    const scheduler = new Scheduler({ leaseDurationMs: 1 });
    const item = job('once', 1, 'chromium');
    expect(scheduler.enqueue(item)).toBe(true);
    expect(scheduler.enqueue(item)).toBe(false);
    expect(scheduler.leaseNext(runner('r1', ['chromium']))?.jobId).toBe('once');
    expect(scheduler.expireLeases(Date.now() + 10)).toEqual(['once']);
    expect(scheduler.size).toBe(1);
  });
});
