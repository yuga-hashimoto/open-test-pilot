import { describe, expect, it } from 'vitest';
import { buildServer } from './index.js';

describe('OpenTestPilot server API', () => {
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
      payload: { projectId, name: 'Login', manifestId: 'login', manifest: { schemaVersion: '1.0.0', id: 'login' } },
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
    const updatedManifest = await app.inject({ method: 'PUT', url: `/v1/tests/${testId}/manifest`, headers: { 'x-organization-id': organizationId }, payload: { schemaVersion: '1.0.0', id: 'login', name: 'Updated' } });
    expect(updatedManifest.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/v1/tests/${testId}/manifest`, headers: { 'x-organization-id': organizationId } })).json<{ name: string }>().name).toBe('Updated');
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
    const body = await app.inject({ method: 'GET', url: `/v1/artifacts/${artifactId}`, headers: { 'x-organization-id': organizationId } });
    expect(body.statusCode).toBe(200);
    expect(body.body).toBe('hello');
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
    const step = await app.inject({ method: 'GET', url: `/v1/runs/${runId}/steps/login`, headers: { 'x-organization-id': organizationId } });
    expect(step.statusCode).toBe(200);
    expect(step.json<{ stepId: string }>().stepId).toBe('login');
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
