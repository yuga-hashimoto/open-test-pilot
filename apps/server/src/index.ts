import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  createdAt: string;
}

export interface TestRecord {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  manifestId: string;
  createdAt: string;
}

export type ServerRunStatus = 'queued' | 'running' | 'passed' | 'failed';

export interface RunRecord {
  id: string;
  organizationId: string;
  projectId: string;
  testId: string;
  status: ServerRunStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface TenantRepository {
  createOrganization(name: string): Organization;
  getOrganization(id: string): Organization | undefined;
  createProject(organizationId: string, name: string): Project;
  getProject(organizationId: string, id: string): Project | undefined;
  createTest(organizationId: string, projectId: string, name: string, manifestId: string): TestRecord;
  listTests(organizationId: string): TestRecord[];
  getTest(organizationId: string, id: string): TestRecord | undefined;
  createRun(organizationId: string, projectId: string, testId: string): RunRecord;
  getRun(id: string): RunRecord | undefined;
  updateRun(id: string, patch: Partial<Pick<RunRecord, 'status' | 'startedAt' | 'endedAt'>>): RunRecord | undefined;
}

export class InMemoryTenantRepository implements TenantRepository {
  private readonly organizations = new Map<string, Organization>();
  private readonly projects = new Map<string, Project>();
  private readonly tests = new Map<string, TestRecord>();
  private readonly runs = new Map<string, RunRecord>();

  createOrganization(name: string): Organization {
    const organization = { id: `org-${randomUUID()}`, name, createdAt: new Date().toISOString() };
    this.organizations.set(organization.id, organization);
    return organization;
  }

  getOrganization(id: string): Organization | undefined { return this.organizations.get(id); }

  createProject(organizationId: string, name: string): Project {
    const project = { id: `project-${randomUUID()}`, organizationId, name, createdAt: new Date().toISOString() };
    this.projects.set(project.id, project);
    return project;
  }

  getProject(organizationId: string, id: string): Project | undefined {
    const project = this.projects.get(id);
    return project?.organizationId === organizationId ? project : undefined;
  }

  createTest(organizationId: string, projectId: string, name: string, manifestId: string): TestRecord {
    const test = { id: `test-${randomUUID()}`, organizationId, projectId, name, manifestId, createdAt: new Date().toISOString() };
    this.tests.set(test.id, test);
    return test;
  }

  listTests(organizationId: string): TestRecord[] {
    return [...this.tests.values()].filter((test) => test.organizationId === organizationId);
  }

  getTest(organizationId: string, id: string): TestRecord | undefined {
    const test = this.tests.get(id);
    return test?.organizationId === organizationId ? test : undefined;
  }

  createRun(organizationId: string, projectId: string, testId: string): RunRecord {
    const run = { id: `run-${randomUUID()}`, organizationId, projectId, testId, status: 'queued' as const, createdAt: new Date().toISOString() };
    this.runs.set(run.id, run);
    return run;
  }

  getRun(id: string): RunRecord | undefined { return this.runs.get(id); }

  updateRun(id: string, patch: Partial<Pick<RunRecord, 'status' | 'startedAt' | 'endedAt'>>): RunRecord | undefined {
    const current = this.runs.get(id);
    if (current === undefined) return undefined;
    const updated = { ...current, ...patch };
    this.runs.set(id, updated);
    return updated;
  }
}

interface OrganizationParams { organizationId: string }
interface RunParams { runId: string }
interface CreateOrganizationBody { name: string }
interface CreateProjectBody { name: string }
interface CreateTestBody { projectId: string; name: string; manifestId: string }
interface CreateRunBody { projectId: string; testId: string }
interface TenantHeaders { 'x-organization-id'?: string }

function tenantId(request: FastifyRequest<{ Headers: TenantHeaders }>): string | undefined {
  return request.headers['x-organization-id'];
}

function requireTenant(request: FastifyRequest<{ Headers: TenantHeaders }>, reply: FastifyReply, organizationId: string): boolean {
  const requested = tenantId(request);
  if (requested === undefined) {
    reply.code(401).send({ error: 'organization context required' });
    return false;
  }
  if (requested !== organizationId) {
    reply.code(403).send({ error: 'organization access denied' });
    return false;
  }
  return true;
}

export function buildServer(repository: TenantRepository = new InMemoryTenantRepository()): FastifyInstance {
  const app = Fastify({ logger: false });

  app.post<{ Body: CreateOrganizationBody }>('/v1/organizations', async (request, reply) => {
    if (typeof request.body?.name !== 'string' || request.body.name.trim().length === 0) {
      return reply.code(400).send({ error: 'name is required' });
    }
    return reply.code(201).send(repository.createOrganization(request.body.name.trim()));
  });

  app.get<{ Params: OrganizationParams; Headers: TenantHeaders }>('/v1/organizations/:organizationId', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    const organization = repository.getOrganization(request.params.organizationId);
    return organization === undefined ? reply.code(404).send({ error: 'organization not found' }) : reply.send(organization);
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: CreateProjectBody }>('/v1/organizations/:organizationId/projects', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    if (typeof request.body?.name !== 'string' || request.body.name.trim().length === 0) return reply.code(400).send({ error: 'name is required' });
    if (repository.getOrganization(request.params.organizationId) === undefined) return reply.code(404).send({ error: 'organization not found' });
    return reply.code(201).send(repository.createProject(request.params.organizationId, request.body.name.trim()));
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: CreateTestBody }>('/v1/organizations/:organizationId/tests', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    const body = request.body;
    if (typeof body?.projectId !== 'string' || typeof body.name !== 'string' || typeof body.manifestId !== 'string') return reply.code(400).send({ error: 'projectId, name, and manifestId are required' });
    if (repository.getProject(request.params.organizationId, body.projectId) === undefined) return reply.code(404).send({ error: 'project not found' });
    return reply.code(201).send(repository.createTest(request.params.organizationId, body.projectId, body.name.trim(), body.manifestId));
  });

  app.get<{ Params: OrganizationParams; Headers: TenantHeaders }>('/v1/organizations/:organizationId/tests', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    return reply.send({ tests: repository.listTests(request.params.organizationId) });
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: CreateRunBody }>('/v1/organizations/:organizationId/runs', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    const body = request.body;
    if (typeof body?.projectId !== 'string' || typeof body.testId !== 'string') return reply.code(400).send({ error: 'projectId and testId are required' });
    if (repository.getProject(request.params.organizationId, body.projectId) === undefined || repository.getTest(request.params.organizationId, body.testId) === undefined) return reply.code(404).send({ error: 'project or test not found' });
    const run = repository.createRun(request.params.organizationId, body.projectId, body.testId);
    setTimeout(() => {
      const startedAt = new Date().toISOString();
      repository.updateRun(run.id, { status: 'running', startedAt });
      repository.updateRun(run.id, { status: 'passed', endedAt: new Date().toISOString() });
    }, 10);
    return reply.code(202).send({ runId: run.id, status: run.status });
  });

  app.get<{ Params: RunParams; Headers: TenantHeaders }>('/v1/runs/:runId', async (request, reply) => {
    const run = repository.getRun(request.params.runId);
    if (run === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId)) return reply;
    return reply.send(run);
  });

  app.get<{ Params: RunParams; Headers: TenantHeaders }>('/v1/runs/:runId/report', async (request, reply) => {
    const run = repository.getRun(request.params.runId);
    if (run === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId)) return reply;
    if (run.status === 'queued' || run.status === 'running') return reply.code(202).send({ runId: run.id, status: run.status });
    return reply.send({ runId: run.id, status: run.status, reportUrl: `/v1/runs/${run.id}/report` });
  });

  app.get('/openapi.json', async (_request, reply) => reply.send({ openapi: '3.1.0', info: { title: 'OpenTestPilot API', version: '0.1.0' }, paths: {
    '/v1/organizations': { post: {} },
    '/v1/organizations/{organizationId}': { get: {} },
    '/v1/organizations/{organizationId}/projects': { post: {} },
    '/v1/organizations/{organizationId}/tests': { get: {}, post: {} },
    '/v1/organizations/{organizationId}/runs': { post: {} },
    '/v1/runs/{runId}': { get: {} },
    '/v1/runs/{runId}/report': { get: {} },
  } }));

  return app;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const app = buildServer();
  await app.listen({ host: '0.0.0.0', port: Number(process.env['PORT'] ?? 3001) });
}
