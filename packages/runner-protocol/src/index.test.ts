import { describe, expect, it } from 'vitest';
import {
  RunnerProtocolVersion,
  type Capabilities,
  type Job,
  type JobStatus,
  type LeaseStatus,
} from './index.js';

describe('Runner Protocol', () => {
  it('exports the runner protocol version', () => {
    expect(RunnerProtocolVersion).toBe('1.0.0');
  });

  it('defines all job statuses', () => {
    const statuses: JobStatus[] = [
      'queued',
      'leased',
      'running',
      'passed',
      'failed',
      'cancelled',
      'expired',
      'rejected',
    ];
    expect(statuses).toHaveLength(8);
  });

  it('defines all lease statuses', () => {
    const statuses: LeaseStatus[] = [
      'active',
      'expired',
      'released',
      'revoked',
    ];
    expect(statuses).toHaveLength(4);
  });

  describe('Capabilities', () => {
    it('declares browser and device support', () => {
      const caps: Capabilities = {
        browsers: ['Chromium', 'Firefox', 'WebKit'],
        operatingSystem: 'macOS',
        maxConcurrency: 2,
      };
      expect(caps.browsers).toContain('Chromium');
      expect(caps.maxConcurrency).toBe(2);
    });
  });

  describe('Job', () => {
    it('contains jobId, runId, manifest, and capabilities', () => {
      const job: Job = {
        jobId: 'job-001',
        runId: 'run-001',
        manifest: { schemaVersion: '1.0.0', id: 'test-login', name: 'Login Test' },
    requestedCapabilities: { browsers: ['Chromium'], maxConcurrency: 1 },
    status: 'queued',
    createdAt: '2026-07-16T00:00:00.000Z',
  };
  expect(job.jobId).toBe('job-001');
      expect(job.runId).toBe('run-001');
      expect(job.status).toBe('queued');
    });

    it('supports optional organization and project scope', () => {
      const job: Job = {
        jobId: 'job-002',
        runId: 'run-002',
        manifest: { schemaVersion: '1.0.0', id: 'test-checkout', name: 'Checkout Test' },
        requestedCapabilities: { browsers: ['Chromium'], maxConcurrency: 1 },
        status: 'queued',
        createdAt: '2026-07-16T00:00:00.000Z',
        organizationId: 'org-001',
        projectId: 'proj-001',
      };
      expect(job.organizationId).toBe('org-001');
      expect(job.projectId).toBe('proj-001');
    });

    it('supports source revision tracking for duplicate detection', () => {
      const job: Job = {
        jobId: 'job-003',
        runId: 'run-003',
        manifest: { schemaVersion: '1.0.0', id: 'test-api', name: 'API Test' },
        requestedCapabilities: { browsers: ['Chromium'], maxConcurrency: 1 },
        status: 'queued',
        createdAt: '2026-07-16T00:00:00.000Z',
        sourceRevision: 'abc123def',
      };
      expect(job.sourceRevision).toBe('abc123def');
    });

    it('supports timeout, retry policy, and execution mode', () => {
      const job: Job = {
        jobId: 'job-004',
        runId: 'run-004',
        manifest: { schemaVersion: '1.0.0', id: 'test-e2e', name: 'E2E Test' },
        requestedCapabilities: { browsers: ['Chromium'], maxConcurrency: 1 },
        status: 'queued',
        createdAt: '2026-07-16T00:00:00.000Z',
        timeout: 300_000,
        retryPolicy: { maxAttempts: 3, backoff: 'linear' },
        executionMode: 'docker',
      };
      expect(job.timeout).toBe(300_000);
      expect(job.retryPolicy?.maxAttempts).toBe(3);
      expect(job.executionMode).toBe('docker');
    });

    it('supports artifact policy', () => {
      const job: Job = {
        jobId: 'job-005',
        runId: 'run-005',
        manifest: { schemaVersion: '1.0.0', id: 'test-artifacts', name: 'Artifact Test' },
        requestedCapabilities: { browsers: ['Chromium'], maxConcurrency: 1 },
        status: 'queued',
        createdAt: '2026-07-16T00:00:00.000Z',
        artifactPolicy: {
          captureScreenshots: 'after',
          retainTraces: true,
          maxArtifactSize: 104_857_600,
        },
      };
      expect(job.artifactPolicy?.captureScreenshots).toBe('after');
      expect(job.artifactPolicy?.retainTraces).toBe(true);
    });
  });
});
