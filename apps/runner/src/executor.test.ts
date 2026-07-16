import { describe, expect, it } from 'vitest';
import type { Job } from '@open-test-pilot/runner-protocol';
import { buildDockerArgs } from './executor.js';

const baseJob: Job = { jobId: 'job-1', runId: 'run-1', manifest: { schemaVersion: '1.0.0', id: 'login', name: 'Login' }, requestedCapabilities: { browsers: ['chromium'], maxConcurrency: 1 }, status: 'queued', createdAt: new Date().toISOString(), executionMode: 'docker' };

describe('Docker shared Runner policy', () => {
  it('builds a read-only, network-isolated command when no manifest snapshot is present', () => {
    const args = buildDockerArgs(baseJob, { image: 'runner:0.1.0', memoryMb: 512, cpus: 1 });
    expect(args).toContain('--read-only');
    expect(args).toContain('--network=none');
    expect(args).toContain('--cap-drop=ALL');
    expect(args).toContain('runner:0.1.0');
  });

  it('rejects host execution and floating image tags', () => {
    expect(() => buildDockerArgs({ ...baseJob, executionMode: 'trusted-host' }, { image: 'runner:0.1.0' })).toThrow('cannot run mode');
    expect(() => buildDockerArgs(baseJob, { image: 'runner' })).toThrow('explicit tag');
  });

  it('defaults to network=none when manifest does not opt in', () => {
    const job: Job = { ...baseJob, manifestDocument: { permissions: { networkAccess: false } } };
    const args = buildDockerArgs(job, { image: 'runner:0.1.0' });
    expect(args).toContain('--network=none');
  });

  it('defaults to network=none when manifestDocument is absent', () => {
    const args = buildDockerArgs(baseJob, { image: 'runner:0.1.0' });
    expect(args).toContain('--network=none');
  });

  it('uses network=bridge when manifest explicitly opts in', () => {
    const job: Job = { ...baseJob, manifestDocument: { permissions: { networkAccess: true } } };
    const args = buildDockerArgs(job, { image: 'runner:0.1.0' });
    expect(args).toContain('--network=bridge');
    expect(args).not.toContain('--network=none');
  });

  it('rejects explicit network flag that conflicts with manifest opt-in', () => {
    const jobOptIn: Job = { ...baseJob, manifestDocument: { permissions: { networkAccess: true } } };
    expect(() => buildDockerArgs(jobOptIn, { image: 'runner:0.1.0', network: 'none' })).toThrow('network=bridge');
  });

  it('rejects explicit network=bridge when manifest does not opt in', () => {
    const jobDeny: Job = { ...baseJob, manifestDocument: { permissions: { networkAccess: false } } };
    expect(() => buildDockerArgs(jobDeny, { image: 'runner:0.1.0', network: 'bridge' })).toThrow('network=none');
  });

  it('allows explicit network flag that matches manifest opt-out', () => {
    const jobDeny: Job = { ...baseJob, manifestDocument: { permissions: { networkAccess: false } } };
    const args = buildDockerArgs(jobDeny, { image: 'runner:0.1.0', network: 'none' });
    expect(args).toContain('--network=none');
  });

  it('allows explicit network flag that matches manifest opt-in', () => {
    const jobOptIn: Job = { ...baseJob, manifestDocument: { permissions: { networkAccess: true } } };
    const args = buildDockerArgs(jobOptIn, { image: 'runner:0.1.0', network: 'bridge' });
    expect(args).toContain('--network=bridge');
  });
});
