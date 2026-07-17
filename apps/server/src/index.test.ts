import { createHmac, generateKeyPairSync } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildServer, createConfiguredRepository, InMemoryTenantRepository } from './index.js';

function validManifest(id: string, name: string): Record<string, unknown> {
  return { schemaVersion: '1.0.0', id, name, description: '', type: 'web', tags: [], priority: 'normal', preconditions: [], variables: [], secrets: [], setup: [], steps: [], cleanup: [], artifacts: { screenshots: 'after' }, runner: { minBrowsers: ['chromium'] }, permissions: { networkAccess: true }, source: { repository: 'local', path: `${id}.yaml` }, generatedCode: { path: `generated/${id}.spec.ts` } };
}

describe('OpenTestPilot server API', () => {
  it('exposes tenant administration resources for projects, members, storage, audit, and AI workers', async () => {
    const repository = new InMemoryTenantRepository();
    const app = buildServer(repository);
    const organization = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Admin surface' } });
    const organizationId = organization.json<{ id: string }>().id;
    const project = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/projects`, headers: { 'x-organization-id': organizationId }, payload: { name: 'Checkout' } });
    expect(project.statusCode).toBe(201);

    const projects = await app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/projects`, headers: { 'x-organization-id': organizationId } });
    expect(projects.statusCode).toBe(200);
    expect(projects.json<{ projects: Array<{ name: string }> }>().projects).toEqual([expect.objectContaining({ name: 'Checkout' })]);

    const members = await app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/members`, headers: { 'x-organization-id': organizationId } });
    expect(members.statusCode).toBe(200);
    expect(members.json<{ members: unknown[] }>().members).toEqual([]);

    const policy = await app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/storage-policy`, headers: { 'x-organization-id': organizationId } });
    expect(policy.statusCode).toBe(200);
    expect(policy.json<{ successRetentionDays: number }>().successRetentionDays).toBe(30);
    const updatedPolicy = await app.inject({ method: 'PUT', url: `/v1/organizations/${organizationId}/storage-policy`, headers: { 'x-organization-id': organizationId }, payload: { successRetentionDays: 7, capacityBytes: 1_000_000 } });
    expect(updatedPolicy.statusCode).toBe(200);
    expect(updatedPolicy.json<{ successRetentionDays: number; capacityBytes: number }>().successRetentionDays).toBe(7);

    const worker = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/ai-workers`, headers: { 'x-organization-id': organizationId }, payload: { name: 'codex-worker', policy: { maxRetries: 3, allowPublish: false } } });
    expect(worker.statusCode).toBe(201);
    const workerId = worker.json<{ id: string }>().id;
    const heartbeat = await app.inject({ method: 'POST', url: `/v1/ai-workers/${workerId}/heartbeat`, headers: { 'x-organization-id': organizationId } });
    expect(heartbeat.statusCode).toBe(200);
    const workers = await app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/ai-workers`, headers: { 'x-organization-id': organizationId } });
    expect(workers.statusCode).toBe(200);
    expect(workers.json<{ workers: Array<{ name: string; lastHeartbeatAt?: string }> }>().workers[0]).toMatchObject({ name: 'codex-worker', lastHeartbeatAt: expect.any(String) });

    const audit = await app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/audit-logs`, headers: { 'x-organization-id': organizationId } });
    expect(audit.statusCode).toBe(200);
    expect(audit.json<{ events: Array<{ action: string }> }>().events.map((event) => event.action)).toEqual(expect.arrayContaining(['project.created', 'storage_policy.updated', 'ai_worker.created', 'ai_worker.heartbeat']));
    await app.close();
  });

  it('enforces a GitHub OAuth session and organization membership when auth is required', async () => {
    process.env['AUTH_REQUIRED'] = 'true';
    try {
      const repository = new InMemoryTenantRepository();
      const app = buildServer(repository);
      const user = repository.upsertGitHubUser('123', 'qa-user');
      const session = repository.createAuthSession(user.id, new Date(Date.now() + 60_000).toISOString());
      const organization = repository.createOrganization('Private QA');
      repository.addOrganizationMembership(organization.id, user.id, 'owner');
      const missing = await app.inject({ method: 'GET', url: `/v1/organizations/${organization.id}`, headers: { 'x-organization-id': organization.id } });
      expect(missing.statusCode).toBe(401);
      const allowed = await app.inject({ method: 'GET', url: `/v1/organizations/${organization.id}`, headers: { 'x-organization-id': organization.id, authorization: `Bearer ${session.token}` } });
      expect(allowed.statusCode).toBe(200);
      const other = repository.createOrganization('Other');
      const denied = await app.inject({ method: 'GET', url: `/v1/organizations/${other.id}`, headers: { 'x-organization-id': other.id, authorization: `Bearer ${session.token}` } });
      expect(denied.statusCode).toBe(403);
      await app.close();
    } finally {
      delete process.env['AUTH_REQUIRED'];
    }
  });

  it('stores secret metadata without exposing values and supports rotation', async () => {
    const repository = new InMemoryTenantRepository();
    const app = buildServer(repository);
    const organization = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Secrets' } });
    const organizationId = organization.json<{ id: string }>().id;
    const created = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/secrets`, headers: { 'x-organization-id': organizationId }, payload: { name: 'checkout-token', provider: 'builtin', value: 'do-not-return-this' } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty('value');
    expect(created.json<{ name: string; provider: string; maskedValue: string }>().maskedValue).not.toBe('do-not-return-this');
    const secretId = created.json<{ id: string }>().id;
    const listed = await app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/secrets`, headers: { 'x-organization-id': organizationId } });
    expect(listed.statusCode).toBe(200);
    expect(JSON.stringify(listed.json())).not.toContain('do-not-return-this');
    const rotated = await app.inject({ method: 'POST', url: `/v1/secrets/${secretId}/rotate`, headers: { 'x-organization-id': organizationId }, payload: { value: 'rotated-value' } });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json()).not.toHaveProperty('value');
    const audit = await app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/audit-logs`, headers: { 'x-organization-id': organizationId } });
    expect(audit.json<{ events: Array<{ action: string }> }>().events.map((event) => event.action)).toEqual(expect.arrayContaining(['secret.created', 'secret.rotated']));
    await app.close();
  });

  it('cancels a queued run through the tenant-safe job API', async () => {
    const app = buildServer(new InMemoryTenantRepository());
    const organization = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Cancellation' } });
    const organizationId = organization.json<{ id: string }>().id;
    const project = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/projects`, headers: { 'x-organization-id': organizationId }, payload: { name: 'Cancel project' } });
    const projectId = project.json<{ id: string }>().id;
    const test = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/tests`, headers: { 'x-organization-id': organizationId }, payload: { projectId, name: 'Cancel test', manifestId: 'cancel-test', manifest: validManifest('cancel-test', 'Cancel test') } });
    const run = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/runs`, headers: { 'x-organization-id': organizationId }, payload: { projectId, testId: test.json<{ id: string }>().id } });
    const jobId = `job-${run.json<{ runId: string }>().runId}`;
    const cancelled = await app.inject({ method: 'POST', url: `/v1/jobs/${jobId}/cancel`, headers: { 'x-organization-id': organizationId } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<{ status: string }>().status).toBe('cancelled');
    const storedRun = await app.inject({ method: 'GET', url: `/v1/runs/${run.json<{ runId: string }>().runId}`, headers: { 'x-organization-id': organizationId } });
    expect(storedRun.json<{ status: string }>().status).toBe('cancelled');
    await app.close();
  });

  it('runs an AI worker job through create, lease, and complete states', async () => {
    const app = buildServer(new InMemoryTenantRepository());
    const organizationId = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'AI jobs' } })).json<{ id: string }>().id;
    const workerId = (await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/ai-workers`, headers: { 'x-organization-id': organizationId }, payload: { name: 'codex-worker' } })).json<{ id: string }>().id;
    const created = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/ai-worker-jobs`, headers: { 'x-organization-id': organizationId }, payload: { workerId, operation: 'analyze-failure', request: { requestId: 'repair-api-1', protocolVersion: '1.0.0' } } });
    expect(created.statusCode).toBe(201);
    const jobId = created.json<{ id: string; status: string }>().id;
    expect(created.json<{ status: string }>().status).toBe('queued');
    const leased = await app.inject({ method: 'POST', url: `/v1/ai-workers/${workerId}/jobs/lease`, headers: { 'x-organization-id': organizationId } });
    expect(leased.statusCode).toBe(200);
    expect(leased.json<{ job: { id: string; status: string } }>().job).toMatchObject({ id: jobId, status: 'leased' });
    const completed = await app.inject({ method: 'POST', url: `/v1/ai-worker-jobs/${jobId}/complete`, headers: { 'x-organization-id': organizationId }, payload: { status: 'completed', result: { findings: [{ type: 'verified' }] } } });
    expect(completed.statusCode).toBe(200);
    expect(completed.json<{ status: string }>().status).toBe('completed');
    const jobs = await app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/ai-worker-jobs`, headers: { 'x-organization-id': organizationId } });
    expect(jobs.json<{ jobs: Array<{ id: string; result?: { findings: unknown[] } }> }>().jobs[0]).toMatchObject({ id: jobId, result: { findings: [{ type: 'verified' }] } });
    await app.close();
  });

  it('creates an organization and denies a cross-organization read', async () => {
    const app = buildServer();
    const first = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'First' } });
    const second = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Second' } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstOrganization = first.json<{ id: string }>();
    const secondOrganization = second.json<{ id: string }>();
    const denied = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${secondOrganization.id}`,
      headers: { 'x-organization-id': firstOrganization.id },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('creates a tenant-scoped project and test', async () => {
    const app = buildServer();
    const organization = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'QA' } });
    const organizationId = organization.json<{ id: string }>().id;
    const project = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/projects`,
      headers: { 'x-organization-id': organizationId },
      payload: { name: 'Store' },
    });
    expect(project.statusCode).toBe(201);
    const projectId = project.json<{ id: string }>().id;
    const test = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/tests`,
      headers: { 'x-organization-id': organizationId },
      payload: { projectId, name: 'Login', manifestId: 'login', manifest: validManifest('login', 'Login') },
    });
    expect(test.statusCode).toBe(201);
    const listed = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${organizationId}/tests`,
      headers: { 'x-organization-id': organizationId },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ tests: Array<{ name: string }> }>().tests).toEqual([expect.objectContaining({ name: 'Login', id: expect.any(String), projectId, organizationId })]);
    const testId = listed.json<{ tests: Array<{ id: string }> }>().tests[0]?.id;
    const detail = await app.inject({ method: 'GET', url: `/v1/tests/${testId}`, headers: { 'x-organization-id': organizationId } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ manifestId: string }>().manifestId).toBe('login');
    const manifest = await app.inject({ method: 'GET', url: `/v1/tests/${testId}/manifest`, headers: { 'x-organization-id': organizationId } });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json<{ manifestId: string }>().manifestId).toBe('login');
    expect(manifest.json<{ id: string }>().id).toBe('login');
    const updatedManifest = await app.inject({ method: 'PUT', url: `/v1/tests/${testId}/manifest`, headers: { 'x-organization-id': organizationId }, payload: { ...validManifest('login', 'Updated'), testId, manifestId: 'login' } });
    expect(updatedManifest.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/v1/tests/${testId}/manifest`, headers: { 'x-organization-id': organizationId } })).json<{ name: string }>().name).toBe('Updated');
    const versions = await app.inject({ method: 'GET', url: `/v1/tests/${testId}/manifest/versions`, headers: { 'x-organization-id': organizationId } });
    expect(versions.statusCode).toBe(200);
    expect(versions.json<{ versions: Array<{ version: number; manifest: { name: string } }> }>().versions[0]).toEqual(expect.objectContaining({ version: 2, manifest: expect.objectContaining({ name: 'Updated' }) }));
    const invalidManifest = await app.inject({ method: 'PUT', url: `/v1/tests/${testId}/manifest`, headers: { 'x-organization-id': organizationId }, payload: { schemaVersion: '1.0.0', id: 'login' } });
    expect(invalidManifest.statusCode).toBe(400);
    const generated = await app.inject({ method: 'GET', url: `/v1/tests/${testId}/generated-code`, headers: { 'x-organization-id': organizationId } });
    expect(generated.statusCode).toBe(200);
    expect(generated.json<{ testId: string }>().testId).toBe(testId);
  });

  it('returns an asynchronous run ID and exposes OpenAPI', async () => {
    const app = buildServer();
    const organization = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Runs' } });
    const organizationId = organization.json<{ id: string }>().id;
    const project = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/projects`,
      headers: { 'x-organization-id': organizationId },
      payload: { name: 'Project' },
    });
    const projectId = project.json<{ id: string }>().id;
    const test = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/tests`,
      headers: { 'x-organization-id': organizationId },
      payload: { projectId, name: 'Login', manifestId: 'login' },
    });
    const testId = test.json<{ id: string }>().id;
    const run = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/runs`,
      headers: { 'x-organization-id': organizationId },
      payload: { projectId, testId },
    });
    expect(run.statusCode).toBe(202);
    expect(run.json<{ runId: string; status: string }>().status).toBe('queued');
    const openapi = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(openapi.statusCode).toBe(200);
    const paths = openapi.json<{ paths: Record<string, Record<string, { responses?: unknown }>> }>().paths;
    expect(paths['/v1/organizations/{organizationId}/runs']).toBeDefined();
    for (const path of Object.values(paths)) for (const operation of Object.values(path)) expect(operation.responses).toBeDefined();
    await app.close();
  });

  it('exposes GitHub OAuth start and validates callback state', async () => {
    process.env['GITHUB_CLIENT_ID'] = 'client-id';
    const app = buildServer();
    const start = await app.inject({ method: 'GET', url: '/auth/github/start?redirectUri=https%3A%2F%2Fpilot.test%2Fcallback' });
    expect(start.statusCode).toBe(200);
    expect(start.json<{ authorizationUrl: string }>().authorizationUrl).toContain('client_id=client-id');
    const callback = await app.inject({ method: 'GET', url: '/auth/github/callback?code=unused&state=wrong' });
    expect(callback.statusCode).toBe(400);
    delete process.env['GITHUB_CLIENT_ID'];
    await app.close();
  });

  it('registers a runner, leases a tenant job, and rejects cross-tenant completion', async () => {
    const app = buildServer();
    const first = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Runner Org' } });
    const firstOrg = first.json<{ id: string }>().id;
    const second = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Other Org' } });
    const secondOrg = second.json<{ id: string }>().id;
    const runner = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${firstOrg}/runners`,
      headers: { 'x-organization-id': firstOrg },
      payload: { name: 'Chromium runner', capabilities: { browsers: ['chromium'], maxConcurrency: 1, labels: ['linux'] } },
    });
    expect(runner.statusCode).toBe(201);
    const runnerId = runner.json<{ runnerId: string }>().runnerId;
    const listedRunners = await app.inject({ method: 'GET', url: `/v1/organizations/${firstOrg}/runners`, headers: { 'x-organization-id': firstOrg } });
    expect(listedRunners.statusCode).toBe(200);
    expect(listedRunners.json<{ runners: Array<{ runnerId: string; organizationId: string }> }>().runners).toEqual([expect.objectContaining({ runnerId, organizationId: firstOrg })]);
    const job = { jobId: 'job-1', runId: 'run-1', organizationId: firstOrg, manifest: { schemaVersion: '1.0.0', id: 'login', name: 'Login' }, requestedCapabilities: { browsers: ['chromium'], maxConcurrency: 1 }, status: 'queued', createdAt: new Date().toISOString(), requiredLabels: ['linux'] };
    const queued = await app.inject({ method: 'POST', url: `/v1/organizations/${firstOrg}/jobs`, headers: { 'x-organization-id': firstOrg }, payload: { job } });
    expect(queued.statusCode).toBe(202);
    const lease = await app.inject({ method: 'POST', url: `/v1/runners/${runnerId}/lease`, headers: { 'x-organization-id': firstOrg } });
    expect(lease.statusCode).toBe(200);
    expect(lease.json<{ job: { jobId: string } }>().job.jobId).toBe('job-1');
    const denied = await app.inject({ method: 'POST', url: '/v1/jobs/job-1/complete', headers: { 'x-organization-id': secondOrg }, payload: { status: 'passed' } });
    expect(denied.statusCode).toBe(403);
    const completed = await app.inject({ method: 'POST', url: '/v1/jobs/job-1/complete', headers: { 'x-organization-id': firstOrg }, payload: { status: 'passed' } });
    expect(completed.statusCode).toBe(200);
    await app.close();
  });

  it('keeps GitHub run notifications behind App credential configuration', async () => {
    delete process.env['GITHUB_APP_ID'];
    delete process.env['GITHUB_PRIVATE_KEY_PATH'];
    const app = buildServer();
    const organization = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'GitHub notify' } });
    const organizationId = organization.json<{ id: string }>().id;
    const project = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/projects`, headers: { 'x-organization-id': organizationId }, payload: { name: 'Project' } });
    const projectId = project.json<{ id: string }>().id;
    const test = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/tests`, headers: { 'x-organization-id': organizationId }, payload: { projectId, name: 'Smoke', manifestId: 'smoke' } });
    const testId = test.json<{ id: string }>().id;
    const run = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/runs`, headers: { 'x-organization-id': organizationId }, payload: { projectId, testId } });
    const repository = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/repositories`, headers: { 'x-organization-id': organizationId }, payload: { owner: 'yuga-hashimoto', name: 'open-test-pilot', installationId: 146977164 } });
    const notification = await app.inject({ method: 'POST', url: `/v1/runs/${run.json<{ runId: string }>().runId}/github-notify`, headers: { 'x-organization-id': organizationId }, payload: { repositoryId: repository.json<{ id: string }>().id, headSha: 'abc123' } });
    expect(notification.statusCode).toBe(503);
    expect(notification.json<{ error: string }>().error).toContain('not configured');
    await app.close();
  });

  it('creates tenant-scoped schedules and exposes an explicit webhook configuration gate', async () => {
    const app = buildServer();
    const organization = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Schedules' } });
    const organizationId = organization.json<{ id: string }>().id;
    const project = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/projects`, headers: { 'x-organization-id': organizationId }, payload: { name: 'Store' } });
    const projectId = project.json<{ id: string }>().id;
    const test = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/tests`, headers: { 'x-organization-id': organizationId }, payload: { projectId, name: 'Smoke', manifestId: 'smoke' } });
    const testId = test.json<{ id: string }>().id;
    const schedule = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/schedules`, headers: { 'x-organization-id': organizationId }, payload: { projectId, testId, cron: '0 9 * * 1' } });
    expect(schedule.statusCode).toBe(201);
    expect(schedule.json<{ cron: string; enabled: boolean }>().enabled).toBe(true);
    const invalid = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/schedules`, headers: { 'x-organization-id': organizationId }, payload: { projectId, testId, cron: 'tomorrow morning' } });
    expect(invalid.statusCode).toBe(400);
    const webhook = await app.inject({ method: 'POST', url: '/v1/webhooks/github', payload: { action: 'push' } });
    expect(webhook.statusCode).toBe(503);
    await app.close();
  });

  it('verifies, records, and deduplicates signed GitHub webhook deliveries', async () => {
    const previousSecret = process.env['GITHUB_WEBHOOK_SECRET'];
    process.env['GITHUB_WEBHOOK_SECRET'] = 'webhook-secret';
    try {
      const repository = new InMemoryTenantRepository();
      const app = buildServer(repository);
      const organization = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Webhook org' } });
      const organizationId = organization.json<{ id: string }>().id;
      const linked = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/repositories`, headers: { 'x-organization-id': organizationId }, payload: { owner: 'octo', name: 'demo' } });
      const project = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/projects`, headers: { 'x-organization-id': organizationId }, payload: { name: 'Webhook project' } });
      const projectId = project.json<{ id: string }>().id;
      const test = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/tests`, headers: { 'x-organization-id': organizationId }, payload: { projectId, name: 'Webhook test', manifestId: 'webhook-test' } });
      const testId = test.json<{ id: string }>().id;
      await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/schedules`, headers: { 'x-organization-id': organizationId }, payload: { projectId, testId, cron: '*/5 * * * *' } });
      const body = { action: 'opened', repository: { full_name: 'octo/demo' }, pull_request: { number: 7 } };
      const payload = JSON.stringify(body);
      const signature = `sha256=${createHmac('sha256', 'webhook-secret').update(payload).digest('hex')}`;
      const headers = { 'x-hub-signature-256': signature, 'x-github-delivery': 'delivery-1', 'x-github-event': 'pull_request', 'x-organization-id': organizationId };
      const accepted = await app.inject({ method: 'POST', url: '/v1/webhooks/github', headers, payload: body });
      expect(accepted.statusCode).toBe(202);
      expect(accepted.json<{ processed: boolean; triggeredRuns: string[] }>().processed).toBe(true);
      expect(accepted.json<{ triggeredRuns: string[] }>().triggeredRuns).toHaveLength(1);
      const duplicate = await app.inject({ method: 'POST', url: '/v1/webhooks/github', headers, payload: body });
      expect(duplicate.statusCode).toBe(200);
      expect(duplicate.json<{ duplicate: boolean }>().duplicate).toBe(true);
      const audit = await app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/audit-logs`, headers: { 'x-organization-id': organizationId } });
      expect(audit.json<{ events: Array<{ action: string; metadata: Record<string, unknown> }> }>().events).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'github.webhook.pull_request', metadata: expect.objectContaining({ pullRequestNumber: 7 }) })]));
      expect(linked.statusCode).toBe(201);
      await app.close();
    } finally {
      if (previousSecret === undefined) delete process.env['GITHUB_WEBHOOK_SECRET'];
      else process.env['GITHUB_WEBHOOK_SECRET'] = previousSecret;
    }
  });

  it('triggers an enabled schedule into the tenant queue', async () => {
    const app = buildServer();
    const organization = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Schedule trigger org' } });
    const organizationId = organization.json<{ id: string }>().id;
    const project = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/projects`, headers: { 'x-organization-id': organizationId }, payload: { name: 'Scheduled project' } });
    const projectId = project.json<{ id: string }>().id;
    const test = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/tests`, headers: { 'x-organization-id': organizationId }, payload: { projectId, name: 'Scheduled test', manifestId: 'scheduled-test' } });
    const testId = test.json<{ id: string }>().id;
    const schedule = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/schedules`, headers: { 'x-organization-id': organizationId }, payload: { projectId, testId, cron: '*/5 * * * *' } });
    const triggered = await app.inject({ method: 'POST', url: `/v1/schedules/${schedule.json<{ id: string }>().id}/trigger`, headers: { 'x-organization-id': organizationId } });
    expect(triggered.statusCode).toBe(202);
    expect(triggered.json<{ trigger: string; runId: string }>().trigger).toBe('schedule');
    await app.close();
  });

  it('publishes tenant-scoped custom action plugin metadata and versions', async () => {
    const app = buildServer();
    const organization = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Plugin org' } });
    const organizationId = organization.json<{ id: string }>().id;
    const published = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/plugins`, headers: { 'x-organization-id': organizationId }, payload: { pluginType: 'custom-action', name: 'Company actions', version: '1.0.0', manifest: { apiVersion: '1.0.0', actions: [{ type: 'company.createOrder', title: 'Create order' }] } } });
    expect(published.statusCode).toBe(201);
    const pluginId = published.json<{ plugin: { id: string } }>().plugin.id;
    const next = await app.inject({ method: 'POST', url: `/v1/plugins/${pluginId}/versions`, headers: { 'x-organization-id': organizationId }, payload: { version: '1.1.0', manifest: { apiVersion: '1.0.0', actions: [{ type: 'company.createOrder', title: 'Create order v2' }] } } });
    expect(next.statusCode).toBe(201);
    const versions = await app.inject({ method: 'GET', url: `/v1/plugins/${pluginId}/versions`, headers: { 'x-organization-id': organizationId } });
    expect(versions.json<{ versions: Array<{ version: string }> }>().versions.map((version) => version.version)).toEqual(['1.1.0', '1.0.0']);
    const duplicate = await app.inject({ method: 'POST', url: `/v1/plugins/${pluginId}/versions`, headers: { 'x-organization-id': organizationId }, payload: { version: '1.1.0', manifest: {} } });
    expect(duplicate.statusCode).toBe(409);
    await app.close();
  });

  it('uploads and reads an organization-scoped artifact', async () => {
    const app = buildServer();
    const organization = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Artifacts' } });
    const organizationId = organization.json<{ id: string }>().id;
    const project = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/projects`, headers: { 'x-organization-id': organizationId }, payload: { name: 'Store' } });
    const projectId = project.json<{ id: string }>().id;
    const test = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/tests`, headers: { 'x-organization-id': organizationId }, payload: { projectId, name: 'Smoke', manifestId: 'smoke' } });
    const testId = test.json<{ id: string }>().id;
    const run = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/runs`, headers: { 'x-organization-id': organizationId }, payload: { projectId, testId } });
    const runId = run.json<{ runId: string }>().runId;
    const artifact = await app.inject({ method: 'POST', url: `/v1/runs/${runId}/artifacts`, headers: { 'x-organization-id': organizationId }, payload: { key: 'stdout.log', contentType: 'text/plain', bodyBase64: Buffer.from('hello').toString('base64') } });
    expect(artifact.statusCode).toBe(201);
    const artifactId = artifact.json<{ id: string }>().id;
    const listed = await app.inject({ method: 'GET', url: `/v1/runs/${runId}/artifacts`, headers: { 'x-organization-id': organizationId } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ artifacts: Array<{ id: string }> }>().artifacts).toEqual([expect.objectContaining({ id: artifactId })]);
    const body = await app.inject({ method: 'GET', url: `/v1/artifacts/${artifactId}`, headers: { 'x-organization-id': organizationId } });
    expect(body.statusCode).toBe(200);
    expect(body.body).toBe('hello');
    const malformedTenant = await app.inject({ method: 'GET', url: `/v1/artifacts/${artifactId}`, headers: { 'x-organization-id': 'not-a-tenant' } });
    expect(malformedTenant.statusCode).toBe(401);
    await app.close();
  });

  it('supports tenant-scoped artifact retention dry-runs and audited deletion', async () => {
    const app = buildServer();
    const organizationId = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Retention' } })).json<{ id: string }>().id;
    const projectId = (await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/projects`, headers: { 'x-organization-id': organizationId }, payload: { name: 'Store' } })).json<{ id: string }>().id;
    const testId = (await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/tests`, headers: { 'x-organization-id': organizationId }, payload: { projectId, name: 'Smoke', manifestId: 'smoke' } })).json<{ id: string }>().id;
    const runId = (await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/runs`, headers: { 'x-organization-id': organizationId }, payload: { projectId, testId } })).json<{ runId: string }>().runId;
    const uploaded = await app.inject({ method: 'POST', url: `/v1/runs/${runId}/artifacts`, headers: { 'x-organization-id': organizationId }, payload: { key: 'old.log', contentType: 'text/plain', bodyBase64: Buffer.from('old').toString('base64') } });
    const artifactId = uploaded.json<{ id: string }>().id;
    const before = new Date(Date.now() + 1_000).toISOString();
    const dryRun = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/artifacts/purge`, headers: { 'x-organization-id': organizationId }, payload: { before, dryRun: true } });
    expect(dryRun.statusCode).toBe(200);
    expect(dryRun.json<{ count: number; dryRun: boolean }>().dryRun).toBe(true);
    expect(dryRun.json<{ count: number }>().count).toBe(1);
    expect((await app.inject({ method: 'GET', url: `/v1/artifacts/${artifactId}`, headers: { 'x-organization-id': organizationId } })).statusCode).toBe(200);
    const purged = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/artifacts/purge`, headers: { 'x-organization-id': organizationId }, payload: { before } });
    expect(purged.statusCode).toBe(200);
    expect(purged.json<{ count: number }>().count).toBe(1);
    expect((await app.inject({ method: 'GET', url: `/v1/artifacts/${artifactId}`, headers: { 'x-organization-id': organizationId } })).statusCode).toBe(404);
    await app.close();
  });

  it('moves a run through queued, running, and completed runner states', async () => {
    const app = buildServer();
    const organization = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Lifecycle' } });
    const organizationId = organization.json<{ id: string }>().id;
    const project = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/projects`, headers: { 'x-organization-id': organizationId }, payload: { name: 'Store' } });
    const projectId = project.json<{ id: string }>().id;
    const test = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/tests`, headers: { 'x-organization-id': organizationId }, payload: { projectId, name: 'Smoke', manifestId: 'smoke' } });
    const testId = test.json<{ id: string }>().id;
    const run = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/runs`, headers: { 'x-organization-id': organizationId }, payload: { projectId, testId } });
    const runId = run.json<{ runId: string }>().runId;
    const runner = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/runners`, headers: { 'x-organization-id': organizationId }, payload: { name: 'runner', capabilities: { browsers: ['chromium'], maxConcurrency: 1 } } });
    const runnerId = runner.json<{ runnerId: string }>().runnerId;
    const leased = await app.inject({ method: 'POST', url: `/v1/runners/${runnerId}/lease`, headers: { 'x-organization-id': organizationId } });
    const jobId = leased.json<{ job: { jobId: string } }>().job.jobId;
    const running = await app.inject({ method: 'GET', url: `/v1/runs/${runId}`, headers: { 'x-organization-id': organizationId } });
    expect(running.json<{ status: string }>().status).toBe('running');
    await app.inject({ method: 'POST', url: `/v1/jobs/${jobId}/complete`, headers: { 'x-organization-id': organizationId }, payload: { status: 'passed' } });
    const completed = await app.inject({ method: 'GET', url: `/v1/runs/${runId}`, headers: { 'x-organization-id': organizationId } });
    expect(completed.json<{ status: string }>().status).toBe('passed');
    await app.close();
  });

  it('stores runner result evidence for failure and step APIs', async () => {
    const app = buildServer();
    const organizationId = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Results' } })).json<{ id: string }>().id;
    const projectId = (await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/projects`, headers: { 'x-organization-id': organizationId }, payload: { name: 'Store' } })).json<{ id: string }>().id;
    const testId = (await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/tests`, headers: { 'x-organization-id': organizationId }, payload: { projectId, name: 'Smoke', manifestId: 'smoke' } })).json<{ id: string }>().id;
    const runId = (await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/runs`, headers: { 'x-organization-id': organizationId }, payload: { projectId, testId } })).json<{ runId: string }>().runId;
    const runnerId = (await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/runners`, headers: { 'x-organization-id': organizationId }, payload: { name: 'runner', capabilities: { browsers: ['chromium'], maxConcurrency: 1 } } })).json<{ runnerId: string }>().runnerId;
    const jobId = (await app.inject({ method: 'POST', url: `/v1/runners/${runnerId}/lease`, headers: { 'x-organization-id': organizationId } })).json<{ job: { jobId: string } }>().job.jobId;
    const completion = await app.inject({ method: 'POST', url: `/v1/jobs/${jobId}/complete`, headers: { 'x-organization-id': organizationId }, payload: {
      status: 'failed',
      result: {
        failures: [{ actionId: 'assert-title', message: 'Expected Welcome', category: 'PRODUCT_DEFECT' }],
        steps: [{ stepId: 'login', status: 'failed', actions: [{ actionId: 'assert-title', status: 'failed' }] }],
      },
      },
    });
    expect(completion.statusCode).toBe(200);
    const failures = await app.inject({ method: 'GET', url: `/v1/runs/${runId}/failures`, headers: { 'x-organization-id': organizationId } });
    expect(failures.statusCode).toBe(200);
    expect(failures.json<{ failures: Array<{ actionId: string }> }>().failures[0]?.actionId).toBe('assert-title');
    const result = await app.inject({ method: 'GET', url: `/v1/runs/${runId}/result`, headers: { 'x-organization-id': organizationId } });
    expect(result.statusCode).toBe(200);
    expect(result.json<{ result: { steps: Array<{ stepId: string }> } }>().result.steps[0]?.stepId).toBe('login');
    const otherOrganizationId = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Other tenant' } })).json<{ id: string }>().id;
    expect((await app.inject({ method: 'GET', url: `/v1/runs/${runId}/result`, headers: { 'x-organization-id': otherOrganizationId } })).statusCode).toBe(403);
    const step = await app.inject({ method: 'GET', url: `/v1/runs/${runId}/steps/login`, headers: { 'x-organization-id': organizationId } });
    expect(step.statusCode).toBe(200);
    expect(step.json<{ stepId: string }>().stepId).toBe('login');
    await app.close();
  });

  it('imports unit, component, and integration results into a tenant run', async () => {
    const app = buildServer();
    const organizationId = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Imported results' } })).json<{ id: string }>().id;
    const projectId = (await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/projects`, headers: { 'x-organization-id': organizationId }, payload: { name: 'Store' } })).json<{ id: string }>().id;
    const testId = (await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/tests`, headers: { 'x-organization-id': organizationId }, payload: { projectId, name: 'Smoke', manifestId: 'smoke' } })).json<{ id: string }>().id;
    const runId = (await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/runs`, headers: { 'x-organization-id': organizationId }, payload: { projectId, testId } })).json<{ runId: string }>().runId;
    const imported = await app.inject({ method: 'POST', url: `/v1/runs/${runId}/results/import`, headers: { 'x-organization-id': organizationId }, payload: { framework: 'integration', result: { testResults: [{ name: 'checkout', status: 'failed', message: 'payment unavailable' }] } } });
    expect(imported.statusCode).toBe(202);
    expect(imported.json<{ status: string; failureCount: number }>().status).toBe('failed');
    expect(imported.json<{ failureCount: number }>().failureCount).toBe(1);
    const failures = await app.inject({ method: 'GET', url: `/v1/runs/${runId}/failures`, headers: { 'x-organization-id': organizationId } });
    expect(failures.json<{ failures: Array<{ name: string; framework: string }> }>().failures).toEqual([expect.objectContaining({ name: 'checkout', framework: 'integration' })]);
    await app.close();
  });

  it('serves repository, change-request, repair, and pull-request MCP resources', async () => {
    const app = buildServer();
    const organization = await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'MCP' } });
    const organizationId = organization.json<{ id: string }>().id;
    const repository = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/repositories`, headers: { 'x-organization-id': organizationId }, payload: { owner: 'openai', name: 'open-test-pilot', provider: 'github' } });
    expect(repository.statusCode).toBe(201);
    const repositoryId = repository.json<{ id: string }>().id;
    expect((await app.inject({ method: 'GET', url: `/v1/repositories/${repositoryId}`, headers: { 'x-organization-id': organizationId } })).statusCode).toBe(200);
    const created = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/change-requests`, headers: { 'x-organization-id': organizationId }, payload: { title: 'Fix login', description: 'Repair selector' } });
    expect(created.statusCode).toBe(201);
    const changeRequestId = created.json<{ id: string }>().id;
    expect((await app.inject({ method: 'GET', url: `/v1/organizations/${organizationId}/change-requests`, headers: { 'x-organization-id': organizationId } })).json<{ changeRequests: unknown[] }>().changeRequests).toHaveLength(1);
    expect((await app.inject({ method: 'PATCH', url: `/v1/change-requests/${changeRequestId}`, headers: { 'x-organization-id': organizationId }, payload: { status: 'approved' } })).json<{ status: string }>().status).toBe('approved');
    const project = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/projects`, headers: { 'x-organization-id': organizationId }, payload: { name: 'MCP project' } });
    const projectId = project.json<{ id: string }>().id;
    const test = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/tests`, headers: { 'x-organization-id': organizationId }, payload: { projectId, name: 'MCP test', manifestId: 'mcp' } });
    const testId = test.json<{ id: string }>().id;
    const run = await app.inject({ method: 'POST', url: `/v1/organizations/${organizationId}/runs`, headers: { 'x-organization-id': organizationId }, payload: { projectId, testId } });
    const runId = run.json<{ runId: string }>().runId;
    expect((await app.inject({ method: 'POST', url: `/v1/runs/${runId}/repair`, headers: { 'x-organization-id': organizationId }, payload: { reason: 'flaky selector' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/v1/pull-requests', headers: { 'x-organization-id': organizationId }, payload: { url: 'https://github.com/openai/open-test-pilot/pull/1' } })).statusCode).toBe(201);
    await app.close();
  });
});

describe('repository persistence and sync', () => {
  it('creates, lists, and reads tenant-scoped repositories', async () => {
    const app = buildServer();
    const orgA = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Org A' } })).json<{ id: string }>().id;
    const orgB = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Org B' } })).json<{ id: string }>().id;

    const repoA = (await app.inject({ method: 'POST', url: `/v1/organizations/${orgA}/repositories`, headers: { 'x-organization-id': orgA }, payload: { owner: 'owner-a', name: 'repo-a', provider: 'github' } })).json<{ id: string; fullName: string; defaultBranch: string }>();
    expect(repoA.fullName).toBe('owner-a/repo-a');
    expect(repoA.defaultBranch).toBe('main');

    const repoB = (await app.inject({ method: 'POST', url: `/v1/organizations/${orgA}/repositories`, headers: { 'x-organization-id': orgA }, payload: { owner: 'owner-b', name: 'repo-b', installationId: 123 } })).json<{ id: string; installationId: number }>();
    expect(repoB.installationId).toBe(123);

    const listA = (await app.inject({ method: 'GET', url: `/v1/organizations/${orgA}/repositories`, headers: { 'x-organization-id': orgA } })).json<{ repositories: Array<{ id: string }> }>();
    expect(listA.repositories).toHaveLength(2);

    const listB = (await app.inject({ method: 'GET', url: `/v1/organizations/${orgB}/repositories`, headers: { 'x-organization-id': orgB } })).json<{ repositories: Array<{ id: string }> }>();
    expect(listB.repositories).toHaveLength(0);

    const denied = await app.inject({ method: 'GET', url: `/v1/repositories/${repoA.id}`, headers: { 'x-organization-id': orgB } });
    expect(denied.statusCode).toBe(404);

    await app.close();
  });

  it('rejects repository access without a tenant header', async () => {
    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Tenant' } })).json<{ id: string }>().id;
    const repo = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/repositories`, headers: { 'x-organization-id': org }, payload: { owner: 'org', name: 'repo' } })).json<{ id: string }>();
    expect((await app.inject({ method: 'GET', url: `/v1/repositories/${repo.id}` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/v1/organizations/${org}/repositories` })).statusCode).toBe(401);
    await app.close();
  });

  it('syncs a repository from GitHub App installation credentials', async () => {
    const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const keyPath = join(tmpdir(), `testpilot-repo-sync-${Date.now()}.pem`);
    await writeFile(keyPath, privateKeyPem);

    process.env['GITHUB_APP_ID'] = '67890';
    process.env['GITHUB_PRIVATE_KEY_PATH'] = keyPath;
    process.env['GITHUB_INSTALLATION_ID'] = '456';

    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Sync Org' } })).json<{ id: string }>().id;
    const repo = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/repositories`, headers: { 'x-organization-id': org }, payload: { owner: 'syncowner', name: 'syncrepo' } })).json<{ id: string; organizationId: string; private: boolean }>();
    expect(repo.private).toBe(false);

    const capturedUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: unknown, init?: unknown) => {
      const url = String(input);
      capturedUrls.push(url);
      const isTokenExchange = url.includes('access_tokens');
      const body = isTokenExchange
        ? { token: 'ghs_test123', expires_at: '2026-12-31T23:59:59Z' }
        : { id: 42, full_name: 'syncowner/syncrepo', default_branch: 'trunk', private: true };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    });

    try {
      const synced = await app.inject({ method: 'POST', url: `/v1/repositories/${repo.id}/sync`, headers: { 'x-organization-id': org } });
      expect(synced.statusCode).toBe(200);
      const body = synced.json<{ githubRepositoryId: number; fullName: string; defaultBranch: string; private: boolean; installationId: number }>();
      expect(body.githubRepositoryId).toBe(42);
      expect(body.fullName).toBe('syncowner/syncrepo');
      expect(body.defaultBranch).toBe('trunk');
      expect(body.private).toBe(true);
      expect(body.installationId).toBe(456);
      expect(capturedUrls.filter((u) => u.includes('access_tokens'))).toHaveLength(1);
      expect(capturedUrls.filter((u) => u.includes('/repos/syncowner/syncrepo') && !u.includes('git/refs') && !u.includes('contents') && !u.includes('pulls') && !u.includes('check-runs') && !u.includes('statuses') && !u.includes('comments'))).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      await unlink(keyPath).catch(() => undefined);
      delete process.env['GITHUB_APP_ID'];
      delete process.env['GITHUB_PRIVATE_KEY_PATH'];
      delete process.env['GITHUB_INSTALLATION_ID'];
      await app.close();
    }
  });

  it('returns 503 from sync when GitHub App is not configured', async () => {
    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'NoApp' } })).json<{ id: string }>().id;
    const repo = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/repositories`, headers: { 'x-organization-id': org }, payload: { owner: 'o', name: 'r' } })).json<{ id: string }>();
    const result = await app.inject({ method: 'POST', url: `/v1/repositories/${repo.id}/sync`, headers: { 'x-organization-id': org } });
    expect(result.statusCode).toBe(503);
    await app.close();
  });

  it('keeps GitHub App pull requests behind credential configuration', async () => {
    delete process.env['GITHUB_APP_ID'];
    delete process.env['GITHUB_PRIVATE_KEY_PATH'];
    delete process.env['GITHUB_INSTALLATION_ID'];
    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'NoPullRequestApp' } })).json<{ id: string }>().id;
    const repo = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/repositories`, headers: { 'x-organization-id': org }, payload: { owner: 'o', name: 'r' } })).json<{ id: string }>();
    const result = await app.inject({ method: 'POST', url: `/v1/repositories/${repo.id}/pull-requests`, headers: { 'x-organization-id': org }, payload: { title: 'Repair', head: 'testpilot/repair' } });
    expect(result.statusCode).toBe(503);
    await app.close();
  });

  it('exposes tenant-safe branch and comparison read gates', async () => {
    delete process.env['GITHUB_APP_ID'];
    delete process.env['GITHUB_PRIVATE_KEY_PATH'];
    delete process.env['GITHUB_INSTALLATION_ID'];
    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'NoBranchApp' } })).json<{ id: string }>().id;
    const repo = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/repositories`, headers: { 'x-organization-id': org }, payload: { owner: 'o', name: 'r' } })).json<{ id: string }>();
    const branches = await app.inject({ method: 'GET', url: `/v1/repositories/${repo.id}/branches`, headers: { 'x-organization-id': org } });
    const comparison = await app.inject({ method: 'GET', url: `/v1/repositories/${repo.id}/compare?base=main&head=repair`, headers: { 'x-organization-id': org } });
    expect(branches.statusCode).toBe(503);
    expect(comparison.statusCode).toBe(503);
    await app.close();
  });

  it('creates GitHub branches and commits through the App installation token', async () => {
    const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const keyPath = join(tmpdir(), `testpilot-branch-commit-${Date.now()}.pem`);
    await writeFile(keyPath, privateKeyPem);
    process.env['GITHUB_APP_ID'] = '67890';
    process.env['GITHUB_PRIVATE_KEY_PATH'] = keyPath;
    process.env['GITHUB_INSTALLATION_ID'] = '456';
    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Branch Commit Org' } })).json<{ id: string }>().id;
    const repo = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/repositories`, headers: { 'x-organization-id': org }, payload: { owner: 'owner', name: 'repo' } })).json<{ id: string }>();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
      const url = String(input);
      const body = url.includes('access_tokens') ? { token: 'ghs_branch_commit', expires_at: '2026-12-31T23:59:59Z' } : url.includes('/contents/') ? { commit: { sha: 'commit-branch-1' } } : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    try {
      const branch = await app.inject({ method: 'POST', url: `/v1/repositories/${repo.id}/branches`, headers: { 'x-organization-id': org }, payload: { branch: 'testpilot/repair-1', baseSha: 'base-sha-1' } });
      const commit = await app.inject({ method: 'PUT', url: `/v1/repositories/${repo.id}/contents`, headers: { 'x-organization-id': org }, payload: { branch: 'testpilot/repair-1', path: 'tests/repair.yaml', content: 'name: Repair\n', message: 'test: add repair manifest' } });
      expect(branch.statusCode).toBe(201);
      expect(commit.statusCode).toBe(201);
      expect(commit.json<{ commitSha: string }>().commitSha).toBe('commit-branch-1');
      expect(calls.map((call) => `${call.init?.method ?? 'GET'} ${call.url}`)).toEqual(expect.arrayContaining(['POST https://api.github.com/repos/owner/repo/git/refs', 'PUT https://api.github.com/repos/owner/repo/contents/tests/repair.yaml']));
    } finally {
      vi.unstubAllGlobals();
      await unlink(keyPath).catch(() => undefined);
      delete process.env['GITHUB_APP_ID'];
      delete process.env['GITHUB_PRIVATE_KEY_PATH'];
      delete process.env['GITHUB_INSTALLATION_ID'];
      await app.close();
    }
  });

  it('reads repository contents and the complete pull request history through the App installation token', async () => {
    const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const keyPath = join(tmpdir(), `testpilot-repository-read-${Date.now()}.pem`);
    await writeFile(keyPath, privateKeyPem);
    process.env['GITHUB_APP_ID'] = '67890';
    process.env['GITHUB_PRIVATE_KEY_PATH'] = keyPath;
    process.env['GITHUB_INSTALLATION_ID'] = '456';
    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Repository Read Org' } })).json<{ id: string }>().id;
    const repo = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/repositories`, headers: { 'x-organization-id': org }, payload: { owner: 'owner', name: 'repo' } })).json<{ id: string }>();
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      const body = url.includes('access_tokens')
        ? { token: 'ghs_repository_read', expires_at: '2026-12-31T23:59:59Z' }
        : url.includes('/contents/tests/login.yaml')
          ? { path: 'tests/login.yaml', sha: 'file-sha-1', encoding: 'base64', content: Buffer.from('name: Login\n').toString('base64') }
          : [{ number: 12, html_url: 'https://github.com/owner/repo/pull/12', title: 'Closed repair', state: 'closed', head: { ref: 'repair/12' }, base: { ref: 'main' }, merged_at: '2026-07-17T00:00:00Z', updated_at: '2026-07-17T00:00:00Z' }];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    try {
      const file = await app.inject({ method: 'GET', url: `/v1/repositories/${repo.id}/contents?path=tests%2Flogin.yaml&ref=main`, headers: { 'x-organization-id': org } });
      const pullRequests = await app.inject({ method: 'GET', url: `/v1/repositories/${repo.id}/pull-requests?state=all`, headers: { 'x-organization-id': org } });
      expect(file.statusCode).toBe(200);
      expect(file.json<{ file: { path: string; sha: string; content: string } }>().file).toEqual({ path: 'tests/login.yaml', sha: 'file-sha-1', content: 'name: Login\n' });
      expect(pullRequests.statusCode).toBe(200);
      expect(pullRequests.json<{ pullRequests: Array<{ number: number; state: string; mergedAt?: string }> }>().pullRequests).toEqual([expect.objectContaining({ number: 12, state: 'closed', mergedAt: '2026-07-17T00:00:00Z' })]);
      expect(calls).toEqual(expect.arrayContaining(['GET https://api.github.com/repos/owner/repo/contents/tests/login.yaml?ref=main', 'GET https://api.github.com/repos/owner/repo/pulls?state=all&per_page=100&page=1'].map((methodUrl) => methodUrl.slice(4))));
    } finally {
      vi.unstubAllGlobals();
      await unlink(keyPath).catch(() => undefined);
      delete process.env['GITHUB_APP_ID'];
      delete process.env['GITHUB_PRIVATE_KEY_PATH'];
      delete process.env['GITHUB_INSTALLATION_ID'];
      await app.close();
    }
  });
});

describe('schedule persistence', () => {
  it('creates and lists tenant-scoped schedules via repository', async () => {
    const app = buildServer();
    const orgA = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Sched A' } })).json<{ id: string }>().id;
    const orgB = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Sched B' } })).json<{ id: string }>().id;
    const projectA = (await app.inject({ method: 'POST', url: `/v1/organizations/${orgA}/projects`, headers: { 'x-organization-id': orgA }, payload: { name: 'pA' } })).json<{ id: string }>().id;
    const testA = (await app.inject({ method: 'POST', url: `/v1/organizations/${orgA}/tests`, headers: { 'x-organization-id': orgA }, payload: { projectId: projectA, name: 'tA', manifestId: 'ma' } })).json<{ id: string }>().id;
    const projectB = (await app.inject({ method: 'POST', url: `/v1/organizations/${orgB}/projects`, headers: { 'x-organization-id': orgB }, payload: { name: 'pB' } })).json<{ id: string }>().id;
    const testB = (await app.inject({ method: 'POST', url: `/v1/organizations/${orgB}/tests`, headers: { 'x-organization-id': orgB }, payload: { projectId: projectB, name: 'tB', manifestId: 'mb' } })).json<{ id: string }>().id;

    const s1 = await app.inject({ method: 'POST', url: `/v1/organizations/${orgA}/schedules`, headers: { 'x-organization-id': orgA }, payload: { projectId: projectA, testId: testA, cron: '0 9 * * 1' } });
    expect(s1.statusCode).toBe(201);
    expect(s1.json<{ enabled: boolean; cron: string }>().enabled).toBe(true);
    expect(s1.json<{ cron: string }>().cron).toBe('0 9 * * 1');

    const s2 = await app.inject({ method: 'POST', url: `/v1/organizations/${orgA}/schedules`, headers: { 'x-organization-id': orgA }, payload: { projectId: projectA, testId: testA, cron: '0 12 * * 5', enabled: false } });
    expect(s2.statusCode).toBe(201);
    expect(s2.json<{ enabled: boolean }>().enabled).toBe(false);

    const s3 = await app.inject({ method: 'POST', url: `/v1/organizations/${orgB}/schedules`, headers: { 'x-organization-id': orgB }, payload: { projectId: projectB, testId: testB, cron: '0 18 * * *' } });
    expect(s3.statusCode).toBe(201);

    const listA = await app.inject({ method: 'GET', url: `/v1/organizations/${orgA}/schedules`, headers: { 'x-organization-id': orgA } });
    expect(listA.statusCode).toBe(200);
    expect(listA.json<{ schedules: Array<{ cron: string }> }>().schedules).toHaveLength(2);

    const listB = await app.inject({ method: 'GET', url: `/v1/organizations/${orgB}/schedules`, headers: { 'x-organization-id': orgB } });
    expect(listB.statusCode).toBe(200);
    expect(listB.json<{ schedules: Array<{ cron: string }> }>().schedules).toHaveLength(1);

    const denied = await app.inject({ method: 'GET', url: `/v1/organizations/${orgA}/schedules`, headers: { 'x-organization-id': orgB } });
    expect(denied.statusCode).toBe(403);

    await app.close();
  });

  it('rejects invalid cron expressions', async () => {
    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Cron' } })).json<{ id: string }>().id;
    const proj = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/projects`, headers: { 'x-organization-id': org }, payload: { name: 'p' } })).json<{ id: string }>().id;
    const test = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/tests`, headers: { 'x-organization-id': org }, payload: { projectId: proj, name: 't', manifestId: 'm' } })).json<{ id: string }>().id;
    const bad = await app.inject({ method: 'POST', url: `/v1/organizations/${org}/schedules`, headers: { 'x-organization-id': org }, payload: { projectId: proj, testId: test, cron: 'not-a-cron' } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});

describe('change-request persistence', () => {
  it('creates, lists, gets, and patches tenant-scoped change requests', async () => {
    const app = buildServer();
    const orgA = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'CR A' } })).json<{ id: string }>().id;
    const orgB = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'CR B' } })).json<{ id: string }>().id;

    const cr1 = await app.inject({ method: 'POST', url: `/v1/organizations/${orgA}/change-requests`, headers: { 'x-organization-id': orgA }, payload: { title: 'Fix login', description: 'Update selector' } });
    expect(cr1.statusCode).toBe(201);
    expect(cr1.json<{ title: string; status: string }>().title).toBe('Fix login');
    expect(cr1.json<{ status: string }>().status).toBe('open');
    const cr1Id = cr1.json<{ id: string }>().id;

    const cr2 = await app.inject({ method: 'POST', url: `/v1/organizations/${orgA}/change-requests`, headers: { 'x-organization-id': orgA }, payload: { title: 'Add signup' } });
    expect(cr2.statusCode).toBe(201);
    const cr2Id = cr2.json<{ id: string }>().id;

    const cr3 = await app.inject({ method: 'POST', url: `/v1/organizations/${orgB}/change-requests`, headers: { 'x-organization-id': orgB }, payload: { title: 'Org B CR' } });
    expect(cr3.statusCode).toBe(201);

    const listA = await app.inject({ method: 'GET', url: `/v1/organizations/${orgA}/change-requests`, headers: { 'x-organization-id': orgA } });
    expect(listA.json<{ changeRequests: Array<{ id: string }> }>().changeRequests).toHaveLength(2);

    const listB = await app.inject({ method: 'GET', url: `/v1/organizations/${orgB}/change-requests`, headers: { 'x-organization-id': orgB } });
    expect(listB.json<{ changeRequests: Array<{ id: string }> }>().changeRequests).toHaveLength(1);

    const denied = await app.inject({ method: 'GET', url: `/v1/organizations/${orgA}/change-requests`, headers: { 'x-organization-id': orgB } });
    expect(denied.statusCode).toBe(403);

    const getCr1 = await app.inject({ method: 'GET', url: `/v1/change-requests/${cr1Id}`, headers: { 'x-organization-id': orgA } });
    expect(getCr1.statusCode).toBe(200);
    expect(getCr1.json<{ title: string; description: string }>().title).toBe('Fix login');
    expect(getCr1.json<{ description: string }>().description).toBe('Update selector');

    const crossOrgRead = await app.inject({ method: 'GET', url: `/v1/change-requests/${cr1Id}`, headers: { 'x-organization-id': orgB } });
    expect(crossOrgRead.statusCode).toBe(404);

    const patch = await app.inject({ method: 'PATCH', url: `/v1/change-requests/${cr1Id}`, headers: { 'x-organization-id': orgA }, payload: { status: 'approved' } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json<{ status: string }>().status).toBe('approved');

    const reFetch = await app.inject({ method: 'GET', url: `/v1/change-requests/${cr1Id}`, headers: { 'x-organization-id': orgA } });
    expect(reFetch.json<{ status: string }>().status).toBe('approved');

    const patchDesc = await app.inject({ method: 'PATCH', url: `/v1/change-requests/${cr2Id}`, headers: { 'x-organization-id': orgA }, payload: { description: 'Updated desc' } });
    expect(patchDesc.statusCode).toBe(200);
    expect(patchDesc.json<{ description: string }>().description).toBe('Updated desc');
    expect(patchDesc.json<{ status: string }>().status).toBe('open');

    const crossOrgPatch = await app.inject({ method: 'PATCH', url: `/v1/change-requests/${cr1Id}`, headers: { 'x-organization-id': orgB }, payload: { status: 'rejected' } });
    expect(crossOrgPatch.statusCode).toBe(404);

    await app.close();
  });

  it('rejects missing title and invalid status', async () => {
    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Invalid CR' } })).json<{ id: string }>().id;

    const noTitle = await app.inject({ method: 'POST', url: `/v1/organizations/${org}/change-requests`, headers: { 'x-organization-id': org }, payload: { description: 'no title' } });
    expect(noTitle.statusCode).toBe(400);

    const cr = await app.inject({ method: 'POST', url: `/v1/organizations/${org}/change-requests`, headers: { 'x-organization-id': org }, payload: { title: 'Good CR' } });
    const crId = cr.json<{ id: string }>().id;

    const badStatus = await app.inject({ method: 'PATCH', url: `/v1/change-requests/${crId}`, headers: { 'x-organization-id': org }, payload: { status: 'closed' } });
    expect(badStatus.statusCode).toBe(400);

    await app.close();
  });

  it('returns 404 for nonexistent change request', async () => {
    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'NF CR' } })).json<{ id: string }>().id;
    const notFound = await app.inject({ method: 'GET', url: '/v1/change-requests/change-request-nonexistent', headers: { 'x-organization-id': org } });
    expect(notFound.statusCode).toBe(404);
    await app.close();
  });
});

describe('repair persistence', () => {
  it('creates a repair through repository', async () => {
    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Repair Org' } })).json<{ id: string }>().id;
    const proj = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/projects`, headers: { 'x-organization-id': org }, payload: { name: 'p' } })).json<{ id: string }>().id;
    const test = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/tests`, headers: { 'x-organization-id': org }, payload: { projectId: proj, name: 't', manifestId: 'm' } })).json<{ id: string }>().id;
    const run = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/runs`, headers: { 'x-organization-id': org }, payload: { projectId: proj, testId: test } })).json<{ runId: string }>().runId;

    const repair = await app.inject({ method: 'POST', url: `/v1/runs/${run}/repair`, headers: { 'x-organization-id': org }, payload: { reason: 'flaky selector' } });
    expect(repair.statusCode).toBe(201);
    expect(repair.json<{ reason: string; status: string; runId: string }>().reason).toBe('flaky selector');
    expect(repair.json<{ status: string }>().status).toBe('queued');
    expect(repair.json<{ runId: string }>().runId).toBe(run);

    await app.close();
  });

  it('rejects repair without a reason', async () => {
    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Repair NoReason' } })).json<{ id: string }>().id;
    const proj = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/projects`, headers: { 'x-organization-id': org }, payload: { name: 'p' } })).json<{ id: string }>().id;
    const test = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/tests`, headers: { 'x-organization-id': org }, payload: { projectId: proj, name: 't', manifestId: 'm' } })).json<{ id: string }>().id;
    const run = (await app.inject({ method: 'POST', url: `/v1/organizations/${org}/runs`, headers: { 'x-organization-id': org }, payload: { projectId: proj, testId: test } })).json<{ runId: string }>().runId;

    const badRepair = await app.inject({ method: 'POST', url: `/v1/runs/${run}/repair`, headers: { 'x-organization-id': org }, payload: { reason: '' } });
    expect(badRepair.statusCode).toBe(400);

    await app.close();
  });

  it('rejects cross-tenant repair', async () => {
    const app = buildServer();
    const orgA = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Repair A' } })).json<{ id: string }>().id;
    const orgB = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Repair B' } })).json<{ id: string }>().id;
    const proj = (await app.inject({ method: 'POST', url: `/v1/organizations/${orgA}/projects`, headers: { 'x-organization-id': orgA }, payload: { name: 'p' } })).json<{ id: string }>().id;
    const test = (await app.inject({ method: 'POST', url: `/v1/organizations/${orgA}/tests`, headers: { 'x-organization-id': orgA }, payload: { projectId: proj, name: 't', manifestId: 'm' } })).json<{ id: string }>().id;
    const run = (await app.inject({ method: 'POST', url: `/v1/organizations/${orgA}/runs`, headers: { 'x-organization-id': orgA }, payload: { projectId: proj, testId: test } })).json<{ runId: string }>().runId;

    const denied = await app.inject({ method: 'POST', url: `/v1/runs/${run}/repair`, headers: { 'x-organization-id': orgB }, payload: { reason: 'unauthorized' } });
    expect(denied.statusCode).toBe(403);

    await app.close();
  });
});

describe('pull-request persistence', () => {
  it('creates a pull request through repository', async () => {
    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'PR Org' } })).json<{ id: string }>().id;

    const pr = await app.inject({ method: 'POST', url: '/v1/pull-requests', headers: { 'x-organization-id': org }, payload: { url: 'https://github.com/openai/open-test-pilot/pull/42' } });
    expect(pr.statusCode).toBe(201);
    expect(pr.json<{ url: string }>().url).toBe('https://github.com/openai/open-test-pilot/pull/42');
    expect(pr.json<{ organizationId: string }>().organizationId).toBe(org);

    await app.close();
  });

  it('rejects pull request without url', async () => {
    const app = buildServer();
    const org = (await app.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'PR NoUrl' } })).json<{ id: string }>().id;

    const bad = await app.inject({ method: 'POST', url: '/v1/pull-requests', headers: { 'x-organization-id': org }, payload: {} });
    expect(bad.statusCode).toBe(400);

    await app.close();
  });

  it('rejects pull request without tenant header', async () => {
    const app = buildServer();
    const bad = await app.inject({ method: 'POST', url: '/v1/pull-requests', payload: { url: 'https://github.com/a/b/pull/1' } });
    expect(bad.statusCode).toBe(401);
    await app.close();
  });
});

describe('restart-like persistence via shared repository', () => {
  it('survives server recreation when sharing the same repository', async () => {
    const repository = new InMemoryTenantRepository();

    const firstApp = buildServer(repository);
    const org = (await firstApp.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'Persistent' } })).json<{ id: string }>().id;
    const proj = (await firstApp.inject({ method: 'POST', url: `/v1/organizations/${org}/projects`, headers: { 'x-organization-id': org }, payload: { name: 'p' } })).json<{ id: string }>().id;
    const test = (await firstApp.inject({ method: 'POST', url: `/v1/organizations/${org}/tests`, headers: { 'x-organization-id': org }, payload: { projectId: proj, name: 't', manifestId: 'm' } })).json<{ id: string }>().id;
    const run = (await firstApp.inject({ method: 'POST', url: `/v1/organizations/${org}/runs`, headers: { 'x-organization-id': org }, payload: { projectId: proj, testId: test } })).json<{ runId: string }>().runId;

    await firstApp.inject({ method: 'POST', url: `/v1/organizations/${org}/schedules`, headers: { 'x-organization-id': org }, payload: { projectId: proj, testId: test, cron: '0 9 * * 1' } });
    await firstApp.inject({ method: 'POST', url: `/v1/organizations/${org}/change-requests`, headers: { 'x-organization-id': org }, payload: { title: 'Persist CR', description: 'Pre-restart' } });
    await firstApp.inject({ method: 'POST', url: `/v1/runs/${run}/repair`, headers: { 'x-organization-id': org }, payload: { reason: 'Pre-restart repair' } });
    await firstApp.inject({ method: 'POST', url: '/v1/pull-requests', headers: { 'x-organization-id': org }, payload: { url: 'https://github.com/org/repo/pull/1' } });
    await firstApp.close();

    const secondApp = buildServer(repository);
    const schedules = await secondApp.inject({ method: 'GET', url: `/v1/organizations/${org}/schedules`, headers: { 'x-organization-id': org } });
    expect(schedules.json<{ schedules: Array<{ cron: string }> }>().schedules).toHaveLength(1);

    const crList = await secondApp.inject({ method: 'GET', url: `/v1/organizations/${org}/change-requests`, headers: { 'x-organization-id': org } });
    expect(crList.json<{ changeRequests: Array<{ title: string }> }>().changeRequests).toHaveLength(1);
    expect(crList.json<{ changeRequests: Array<{ title: string }> }>().changeRequests[0]?.title).toBe('Persist CR');
    const crId = crList.json<{ changeRequests: Array<{ id: string }> }>().changeRequests[0]?.id;

    const crGet = await secondApp.inject({ method: 'GET', url: `/v1/change-requests/${crId}`, headers: { 'x-organization-id': org } });
    expect(crGet.statusCode).toBe(200);
    expect(crGet.json<{ description: string }>().description).toBe('Pre-restart');

    const crPatch = await secondApp.inject({ method: 'PATCH', url: `/v1/change-requests/${crId}`, headers: { 'x-organization-id': org }, payload: { status: 'approved' } });
    expect(crPatch.statusCode).toBe(200);
    expect(crPatch.json<{ status: string }>().status).toBe('approved');

    await secondApp.close();
  });

  it('isolates tenants after restart', async () => {
    const repository = new InMemoryTenantRepository();

    const app1 = buildServer(repository);
    const orgA = (await app1.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'RT A' } })).json<{ id: string }>().id;
    const orgB = (await app1.inject({ method: 'POST', url: '/v1/organizations', payload: { name: 'RT B' } })).json<{ id: string }>().id;
    const projA = (await app1.inject({ method: 'POST', url: `/v1/organizations/${orgA}/projects`, headers: { 'x-organization-id': orgA }, payload: { name: 'p' } })).json<{ id: string }>().id;
    const testA = (await app1.inject({ method: 'POST', url: `/v1/organizations/${orgA}/tests`, headers: { 'x-organization-id': orgA }, payload: { projectId: projA, name: 't', manifestId: 'm' } })).json<{ id: string }>().id;
    await app1.inject({ method: 'POST', url: `/v1/organizations/${orgA}/schedules`, headers: { 'x-organization-id': orgA }, payload: { projectId: projA, testId: testA, cron: '0 9 * * 1' } });
    await app1.inject({ method: 'POST', url: `/v1/organizations/${orgA}/change-requests`, headers: { 'x-organization-id': orgA }, payload: { title: 'Org A CR' } });
    await app1.inject({ method: 'POST', url: `/v1/organizations/${orgB}/change-requests`, headers: { 'x-organization-id': orgB }, payload: { title: 'Org B CR' } });
    await app1.close();

    const app2 = buildServer(repository);
    const schedA = await app2.inject({ method: 'GET', url: `/v1/organizations/${orgA}/schedules`, headers: { 'x-organization-id': orgA } });
    expect(schedA.json<{ schedules: Array<{ cron: string }> }>().schedules).toHaveLength(1);

    const schedB = await app2.inject({ method: 'GET', url: `/v1/organizations/${orgB}/schedules`, headers: { 'x-organization-id': orgB } });
    expect(schedB.json<{ schedules: Array<{ cron: string }> }>().schedules).toHaveLength(0);

    const denied = await app2.inject({ method: 'GET', url: `/v1/organizations/${orgA}/schedules`, headers: { 'x-organization-id': orgB } });
    expect(denied.statusCode).toBe(403);

    const crA = await app2.inject({ method: 'GET', url: `/v1/organizations/${orgA}/change-requests`, headers: { 'x-organization-id': orgA } });
    expect(crA.json<{ changeRequests: Array<{ title: string }> }>().changeRequests[0]?.title).toBe('Org A CR');

    const crB = await app2.inject({ method: 'GET', url: `/v1/organizations/${orgB}/change-requests`, headers: { 'x-organization-id': orgB } });
    expect(crB.json<{ changeRequests: Array<{ title: string }> }>().changeRequests[0]?.title).toBe('Org B CR');

    await app2.close();
  });
});

describe('repository tenant isolation (data-layer)', () => {
  it('enforces cross-org isolation for schedules, change requests, repairs, and pull requests', async () => {
    const repo = new InMemoryTenantRepository();
    const orgA = await repo.createOrganization('Org A');
    const orgB = await repo.createOrganization('Org B');
    const projA = await repo.createProject(orgA.id, 'pA');
    const testA = await repo.createTest(orgA.id, projA.id, 'tA', 'ma');
    const projB = await repo.createProject(orgB.id, 'pB');
    const testB = await repo.createTest(orgB.id, projB.id, 'tB', 'mb');

    const sched = await repo.createSchedule(orgA.id, projA.id, testA.id, '0 9 * * 1');
    expect(sched.organizationId).toBe(orgA.id);
    expect(await repo.listSchedules(orgB.id)).toHaveLength(0);
    expect(await repo.listSchedules(orgA.id)).toHaveLength(1);

    const cr = await repo.createChangeRequest(orgA.id, 'CR-A', 'desc');
    expect(cr.organizationId).toBe(orgA.id);
    expect(await repo.getChangeRequest(orgB.id, cr.id)).toBeUndefined();
    expect(await repo.getChangeRequest(orgA.id, cr.id)).toMatchObject({ title: 'CR-A', status: 'open' });
    expect(await repo.listChangeRequests(orgB.id)).toHaveLength(0);
    expect(await repo.listChangeRequests(orgA.id)).toHaveLength(1);

    const updated = await repo.updateChangeRequest(orgB.id, cr.id, { status: 'approved' });
    expect(updated).toBeUndefined();
    expect((await repo.getChangeRequest(orgA.id, cr.id))?.status).toBe('open');

    const patched = await repo.updateChangeRequest(orgA.id, cr.id, { status: 'approved', description: 'updated' });
    expect(patched).toBeDefined();
    expect(patched?.status).toBe('approved');
    expect(patched?.description).toBe('updated');

    const runA = await repo.createRun(orgA.id, projA.id, testA.id);
    const repair = await repo.createRepair(orgA.id, runA.id, 'flaky');
    expect(repair.organizationId).toBe(orgA.id);
    expect(repair.reason).toBe('flaky');
    expect(repair.status).toBe('queued');
    expect(repair.runId).toBe(runA.id);

    const pr = await repo.createPullRequest(orgA.id, 'https://github.com/org/repo/pull/1');
    expect(pr.organizationId).toBe(orgA.id);
    expect(pr.url).toBe('https://github.com/org/repo/pull/1');
  });

  it('rejects nonexistent updateChangeRequest on wrong org', async () => {
    const repo = new InMemoryTenantRepository();
    const org = await repo.createOrganization('Org');
    const result = await repo.updateChangeRequest(org.id, 'change-request-nonexistent', { status: 'rejected' });
    expect(result).toBeUndefined();
  });

  it('isolates independent org data with same resource keys', async () => {
    const repo = new InMemoryTenantRepository();
    const orgA = await repo.createOrganization('A');
    const orgB = await repo.createOrganization('B');

    const crA = await repo.createChangeRequest(orgA.id, 'Title A');
    const crB = await repo.createChangeRequest(orgB.id, 'Title B');

    expect(crA.id).not.toBe(crB.id);
    expect(await repo.getChangeRequest(orgA.id, crB.id)).toBeUndefined();
    expect(await repo.getChangeRequest(orgB.id, crA.id)).toBeUndefined();
    expect(await repo.listChangeRequests(orgA.id)).toHaveLength(1);
    expect(await repo.listChangeRequests(orgB.id)).toHaveLength(1);
  });
});

describe('createConfiguredRepository factory', () => {
  it('returns InMemoryTenantRepository when DATABASE_URL is unset', () => {
    delete process.env['DATABASE_URL'];
    expect(createConfiguredRepository()).toBeInstanceOf(InMemoryTenantRepository);
  });

  it('returns PostgresTenantRepository when DATABASE_URL is set', () => {
    process.env['DATABASE_URL'] = 'postgresql://localhost:5432/test';
    try {
      const repo = createConfiguredRepository();
      // The Postgres class is not exported, but the factory should return
      // a non-InMemory implementation.
      expect(repo).not.toBeInstanceOf(InMemoryTenantRepository);
      expect(typeof (repo as { close?: () => Promise<void> }).close).toBe('function');
      void (repo as { close?: () => Promise<void> }).close?.();
    } finally {
      delete process.env['DATABASE_URL'];
    }
  });
});
