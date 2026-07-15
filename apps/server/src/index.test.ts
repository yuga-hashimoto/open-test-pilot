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
      payload: { projectId, name: 'Login', manifestId: 'login' },
    });
    expect(test.statusCode).toBe(201);
    const listed = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${organizationId}/tests`,
      headers: { 'x-organization-id': organizationId },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ tests: Array<{ name: string }> }>().tests).toEqual([expect.objectContaining({ name: 'Login', id: expect.any(String), projectId, organizationId })]);
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
    expect(openapi.json<{ paths: Record<string, unknown> }>().paths['/v1/organizations/{organizationId}/runs']).toBeDefined();
    await app.close();
  });
});
