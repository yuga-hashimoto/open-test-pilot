import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Manifest } from '@open-test-pilot/manifest-schema';
import { createManifestValidator } from '@open-test-pilot/manifest-schema';
import type { Job } from '@open-test-pilot/runner-protocol';
import { executeJobPayload } from './job-executor.js';

const manifest: Manifest = {
  schemaVersion: '1.0.0', id: 'container.smoke', name: 'Container smoke', description: 'container smoke', type: 'web', tags: [], priority: 'normal', preconditions: [], variables: [], secrets: [], setup: [], steps: [{ id: 'smoke', actions: [] }], cleanup: [], artifacts: { screenshots: 'none', traces: false }, runner: { minBrowsers: ['chromium'] }, permissions: { networkAccess: false }, source: { repository: 'local', path: 'container.smoke.yaml' }, generatedCode: { path: 'container.smoke.spec.ts' },
};

const manifestWithNetwork: Manifest = {
  ...manifest, id: 'container.network', name: 'Container with network', permissions: { networkAccess: true },
};

const manifestWithoutNetworkAccess: Omit<Manifest, 'permissions'> & { permissions: Record<string, unknown> } = {
  schemaVersion: '1.0.0', id: 'bad.no-network-perm', name: 'Bad', description: 'bad', type: 'web', tags: [], priority: 'normal', preconditions: [], variables: [], secrets: [], setup: [], steps: [{ id: 's1', actions: [] }], cleanup: [], artifacts: { screenshots: 'none', traces: false }, runner: { minBrowsers: ['chromium'] }, permissions: {} as Record<string, unknown>, source: { repository: 'local', path: 'bad.yaml' }, generatedCode: { path: 'bad.spec.ts' },
};

describe('container job executor', () => {
  it('executes a manifest snapshot and serializes its report artifacts', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'opentestpilot-runner-'));
    try {
      const job: Job = { jobId: 'job-container-smoke', runId: 'run-container-smoke', organizationId: 'org-1', projectId: 'project-1', manifest: { schemaVersion: '1.0.0', id: manifest.id, name: manifest.name }, manifestDocument: manifest, requestedCapabilities: { browsers: ['chromium'], maxConcurrency: 1 }, status: 'queued', createdAt: new Date().toISOString(), executionMode: 'docker' };
      const output = await executeJobPayload(job, rootDir);
      expect(output.result.status).toBe('passed');
      expect(output.result.runId).toBe(job.runId);
      expect(output.result.steps).toHaveLength(1);
      expect(output.artifacts.some((artifact) => artifact.key === 'container/index.html')).toBe(true);
      expect(output.artifacts.some((artifact) => artifact.key === 'container/report.json')).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('executes a manifest snapshot that opts into network access', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'opentestpilot-runner-'));
    try {
      const job: Job = { jobId: 'job-container-network', runId: 'run-container-network', organizationId: 'org-1', projectId: 'project-1', manifest: { schemaVersion: '1.0.0', id: manifestWithNetwork.id, name: manifestWithNetwork.name }, manifestDocument: manifestWithNetwork, requestedCapabilities: { browsers: ['chromium'], maxConcurrency: 1 }, status: 'queued', createdAt: new Date().toISOString(), executionMode: 'docker' };
      const output = await executeJobPayload(job, rootDir);
      expect(output.result.status).toBe('passed');
      expect(output.result.runId).toBe(job.runId);
      expect(output.result.steps).toHaveLength(1);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects jobs without an immutable manifest snapshot', async () => {
    const job: Job = { jobId: 'job-missing-manifest', runId: 'run-missing-manifest', manifest: { schemaVersion: '1.0.0', id: 'missing', name: 'Missing' }, requestedCapabilities: { browsers: ['chromium'], maxConcurrency: 1 }, status: 'queued', createdAt: new Date().toISOString(), executionMode: 'docker' };
    await expect(executeJobPayload(job)).rejects.toThrow('does not contain a manifest snapshot');
  });

  it('rejects a manifest that omits the required networkAccess permission', () => {
    const validation = createManifestValidator()(manifestWithoutNetworkAccess);
    expect(validation.valid).toBe(false);
    expect(validation.errors?.some((e) => e.instancePath === '/permissions' && e.keyword === 'required')).toBe(true);
  });
});
