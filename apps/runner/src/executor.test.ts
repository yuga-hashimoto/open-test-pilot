import { describe, expect, it } from 'vitest';
import { buildDockerArgs } from './executor.js';

const job = { jobId: 'job-1', runId: 'run-1', manifest: { schemaVersion: '1.0.0', id: 'login', name: 'Login' }, requestedCapabilities: { browsers: ['chromium'], maxConcurrency: 1 }, status: 'queued' as const, createdAt: new Date().toISOString(), executionMode: 'docker' as const };

describe('Docker shared Runner policy', () => {
  it('builds a read-only, network-isolated command', () => {
    const args = buildDockerArgs(job, { image: 'runner:0.1.0', memoryMb: 512, cpus: 1 });
    expect(args).toContain('--read-only');
    expect(args).toContain('--network=none');
    expect(args).toContain('--cap-drop=ALL');
    expect(args).toContain('runner:0.1.0');
  });

  it('rejects host execution and floating image tags', () => {
    expect(() => buildDockerArgs({ ...job, executionMode: 'trusted-host' }, { image: 'runner:0.1.0' })).toThrow('cannot run mode');
    expect(() => buildDockerArgs(job, { image: 'runner' })).toThrow('explicit tag');
    expect(() => buildDockerArgs(job, { image: 'runner:0.1.0', network: 'bridge' })).toThrow('network=none');
  });
});
