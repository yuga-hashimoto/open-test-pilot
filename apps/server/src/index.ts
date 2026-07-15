import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { buildGitHubAuthorizationUrl, exchangeGitHubOAuthCode } from '@open-test-pilot/github-adapter';
import { type RunnerCapabilities } from '@open-test-pilot/scheduler';
import type { Job } from '@open-test-pilot/runner-protocol';
import { validateCronExpression } from '@open-test-pilot/trigger-adapter';
import { verifyWebhookSignature } from '@open-test-pilot/github-adapter';
import { MemoryExecutionQueue, RedisExecutionQueue, type ExecutionQueue } from '@open-test-pilot/queue-adapter';
import { PostgresTenantRepository } from './postgres.js';

export type MaybePromise<T> = T | Promise<T>;

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
  createOrganization(name: string): MaybePromise<Organization>;
  getOrganization(id: string): MaybePromise<Organization | undefined>;
  createProject(organizationId: string, name: string): MaybePromise<Project>;
  getProject(organizationId: string, id: string): MaybePromise<Project | undefined>;
  createTest(organizationId: string, projectId: string, name: string, manifestId: string): MaybePromise<TestRecord>;
  listTests(organizationId: string): MaybePromise<TestRecord[]>;
  getTest(organizationId: string, id: string): MaybePromise<TestRecord | undefined>;
  createRun(organizationId: string, projectId: string, testId: string): MaybePromise<RunRecord>;
  getRun(id: string): MaybePromise<RunRecord | undefined>;
  listRuns(organizationId: string): MaybePromise<RunRecord[]>;
  updateRun(id: string, patch: Partial<Pick<RunRecord, 'status' | 'startedAt' | 'endedAt'>>): MaybePromise<RunRecord | undefined>;
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

  listRuns(organizationId: string): RunRecord[] { return [...this.runs.values()].filter((run) => run.organizationId === organizationId); }

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
interface GitHubStartQuery { redirectUri?: string }
interface GitHubCallbackQuery { code?: string; state?: string }
interface CreateRunnerBody { name: string; capabilities: RunnerCapabilities }
interface CreateJobBody { job: Job }
interface RunnerParams { runnerId: string }
interface JobParams { jobId: string }
interface CompleteJobBody { status: 'passed' | 'failed' | 'cancelled' }
interface CreateScheduleBody { projectId: string; testId: string; cron: string; enabled?: boolean }
interface ScheduleRecord { id: string; organizationId: string; projectId: string; testId: string; cron: string; enabled: boolean; createdAt: string }

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

export function createConfiguredRepository(): TenantRepository {
  return process.env['DATABASE_URL'] === undefined ? new InMemoryTenantRepository() : new PostgresTenantRepository(process.env['DATABASE_URL']);
}

export function createConfiguredExecutionQueue(): ExecutionQueue { return process.env['REDIS_URL'] === undefined ? new MemoryExecutionQueue() : new RedisExecutionQueue(process.env['REDIS_URL']); }

export function buildServer(repository: TenantRepository = createConfiguredRepository(), executionQueue: ExecutionQueue = createConfiguredExecutionQueue()): FastifyInstance {
  const app = Fastify({ logger: false });
  const oauthStates = new Set<string>();
  const schedules = new Map<string, ScheduleRecord>();
  void app.register(cors, { origin: process.env['WEB_ORIGIN'] ?? true });

  app.get<{ Querystring: GitHubStartQuery }>('/auth/github/start', async (request, reply) => {
    const clientId = process.env['GITHUB_CLIENT_ID'];
    if (clientId === undefined) return reply.code(503).send({ error: 'GitHub OAuth is not configured' });
    const state = randomUUID();
    oauthStates.add(state);
    const redirectUri = request.query.redirectUri ?? process.env['GITHUB_REDIRECT_URI'] ?? 'http://localhost:3001/auth/github/callback';
    return reply.send({ authorizationUrl: buildGitHubAuthorizationUrl({ clientId, redirectUri, state }) });
  });

  app.get<{ Querystring: GitHubCallbackQuery }>('/auth/github/callback', async (request, reply) => {
    const { code, state } = request.query;
    if (code === undefined || state === undefined || !oauthStates.delete(state)) return reply.code(400).send({ error: 'invalid OAuth callback state' });
    const clientId = process.env['GITHUB_CLIENT_ID'];
    const clientSecret = process.env['GITHUB_CLIENT_SECRET'];
    if (clientId === undefined || clientSecret === undefined) return reply.code(503).send({ error: 'GitHub OAuth is not configured' });
    const token = await exchangeGitHubOAuthCode(code, clientId, clientSecret);
    return reply.send({ authenticated: true, tokenType: token.tokenType, scope: token.scope });
  });

  app.post<{ Body: CreateOrganizationBody }>('/v1/organizations', async (request, reply) => {
    if (typeof request.body?.name !== 'string' || request.body.name.trim().length === 0) {
      return reply.code(400).send({ error: 'name is required' });
    }
    return reply.code(201).send(await repository.createOrganization(request.body.name.trim()));
  });

  app.get<{ Params: OrganizationParams; Headers: TenantHeaders }>('/v1/organizations/:organizationId', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    const organization = await repository.getOrganization(request.params.organizationId);
    return organization === undefined ? reply.code(404).send({ error: 'organization not found' }) : reply.send(organization);
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: CreateProjectBody }>('/v1/organizations/:organizationId/projects', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    if (typeof request.body?.name !== 'string' || request.body.name.trim().length === 0) return reply.code(400).send({ error: 'name is required' });
    if (await repository.getOrganization(request.params.organizationId) === undefined) return reply.code(404).send({ error: 'organization not found' });
    return reply.code(201).send(await repository.createProject(request.params.organizationId, request.body.name.trim()));
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: CreateTestBody }>('/v1/organizations/:organizationId/tests', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    const body = request.body;
    if (typeof body?.projectId !== 'string' || typeof body.name !== 'string' || typeof body.manifestId !== 'string') return reply.code(400).send({ error: 'projectId, name, and manifestId are required' });
    if (await repository.getProject(request.params.organizationId, body.projectId) === undefined) return reply.code(404).send({ error: 'project not found' });
    return reply.code(201).send(await repository.createTest(request.params.organizationId, body.projectId, body.name.trim(), body.manifestId));
  });

  app.get<{ Params: OrganizationParams; Headers: TenantHeaders }>('/v1/organizations/:organizationId/tests', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    return reply.send({ tests: await repository.listTests(request.params.organizationId) });
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: CreateRunBody }>('/v1/organizations/:organizationId/runs', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    const body = request.body;
    if (typeof body?.projectId !== 'string' || typeof body.testId !== 'string') return reply.code(400).send({ error: 'projectId and testId are required' });
    if (await repository.getProject(request.params.organizationId, body.projectId) === undefined || await repository.getTest(request.params.organizationId, body.testId) === undefined) return reply.code(404).send({ error: 'project or test not found' });
    const run = await repository.createRun(request.params.organizationId, body.projectId, body.testId);
    setTimeout(async () => {
      const startedAt = new Date().toISOString();
      await repository.updateRun(run.id, { status: 'running', startedAt });
      await repository.updateRun(run.id, { status: 'passed', endedAt: new Date().toISOString() });
    }, 10);
    return reply.code(202).send({ runId: run.id, status: run.status });
  });

  app.get<{ Params: RunParams; Headers: TenantHeaders }>('/v1/runs/:runId', async (request, reply) => {
    const run = await repository.getRun(request.params.runId);
    if (run === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId)) return reply;
    return reply.send(run);
  });

  app.get<{ Params: OrganizationParams; Headers: TenantHeaders }>('/v1/organizations/:organizationId/runs', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    return reply.send({ runs: await repository.listRuns(request.params.organizationId) });
  });

  app.get<{ Params: RunParams; Headers: TenantHeaders }>('/v1/runs/:runId/report', async (request, reply) => {
    const run = await repository.getRun(request.params.runId);
    if (run === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId)) return reply;
    if (run.status === 'queued' || run.status === 'running') return reply.code(202).send({ runId: run.id, status: run.status });
    return reply.send({ runId: run.id, status: run.status, reportUrl: `/v1/runs/${run.id}/report` });
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: CreateRunnerBody }>('/v1/organizations/:organizationId/runners', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    const body = request.body;
    if (typeof body?.name !== 'string' || body.name.trim().length === 0 || body.capabilities === undefined) return reply.code(400).send({ error: 'name and capabilities are required' });
    if (await repository.getOrganization(request.params.organizationId) === undefined) return reply.code(404).send({ error: 'organization not found' });
    const runnerId = `runner-${randomUUID()}`;
    const capabilities = { ...body.capabilities, runnerId };
    const runner = await executionQueue.registerRunner(request.params.organizationId, body.name.trim(), capabilities);
    return reply.code(201).send(runner);
  });

  app.post<{ Params: RunnerParams; Headers: TenantHeaders }>('/v1/runners/:runnerId/heartbeat', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    if (!await executionQueue.heartbeat(organizationId, request.params.runnerId)) return reply.code(404).send({ error: 'runner not found' });
    return reply.send({ runnerId: request.params.runnerId, heartbeatAt: new Date().toISOString() });
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: CreateJobBody }>('/v1/organizations/:organizationId/jobs', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    const job = request.body?.job;
    if (job === undefined || typeof job.jobId !== 'string' || typeof job.runId !== 'string' || job.organizationId !== request.params.organizationId) return reply.code(400).send({ error: 'tenant-scoped job is required' });
    if (!await executionQueue.enqueue(request.params.organizationId, job)) return reply.code(409).send({ error: 'job already queued or leased' });
    return reply.code(202).send({ jobId: job.jobId, status: 'queued' });
  });

  app.post<{ Params: RunnerParams; Headers: TenantHeaders }>('/v1/runners/:runnerId/lease', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const job = await executionQueue.lease(organizationId, request.params.runnerId);
    return reply.send({ job: job ?? null });
  });

  app.post<{ Params: JobParams; Headers: TenantHeaders; Body: CompleteJobBody }>('/v1/jobs/:jobId/complete', async (request, reply) => {
    const leasedJob = await executionQueue.getJob(request.params.jobId);
    if (leasedJob === undefined) return reply.code(404).send({ error: 'leased job not found' });
    if (leasedJob.organizationId !== tenantId(request)) return reply.code(403).send({ error: 'organization access denied' });
    const status = request.body?.status;
    if (status !== 'passed' && status !== 'failed' && status !== 'cancelled') return reply.code(400).send({ error: 'status must be passed, failed, or cancelled' });
    const result = await executionQueue.complete(tenantId(request) ?? '', request.params.jobId, status);
    if (result === undefined) return reply.code(404).send({ error: 'leased job not found' });
    return reply.send({ jobId: result.jobId, status: result.status });
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: CreateScheduleBody }>('/v1/organizations/:organizationId/schedules', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    const body = request.body;
    if (typeof body?.projectId !== 'string' || typeof body.testId !== 'string' || typeof body.cron !== 'string') return reply.code(400).send({ error: 'projectId, testId, and cron are required' });
    try { validateCronExpression(body.cron); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
    if (await repository.getProject(request.params.organizationId, body.projectId) === undefined || await repository.getTest(request.params.organizationId, body.testId) === undefined) return reply.code(404).send({ error: 'project or test not found' });
    const schedule = { id: `schedule-${randomUUID()}`, organizationId: request.params.organizationId, projectId: body.projectId, testId: body.testId, cron: validateCronExpression(body.cron), enabled: body.enabled ?? true, createdAt: new Date().toISOString() };
    schedules.set(schedule.id, schedule);
    return reply.code(201).send(schedule);
  });

  app.get<{ Params: OrganizationParams; Headers: TenantHeaders }>('/v1/organizations/:organizationId/schedules', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    return reply.send({ schedules: [...schedules.values()].filter((schedule) => schedule.organizationId === request.params.organizationId) });
  });

  app.post<{ Headers: { 'x-hub-signature-256'?: string; 'x-github-delivery'?: string; 'x-github-event'?: string }; Body: Record<string, unknown> }>('/v1/webhooks/github', async (request, reply) => {
    const secret = process.env['GITHUB_WEBHOOK_SECRET'];
    if (secret === undefined) return reply.code(503).send({ error: 'GitHub webhook verification is not configured' });
    const signature = request.headers['x-hub-signature-256'];
    const deliveryId = request.headers['x-github-delivery'];
    if (signature === undefined || deliveryId === undefined || !verifyWebhookSignature(JSON.stringify(request.body), signature, secret)) return reply.code(401).send({ error: 'invalid webhook signature' });
    return reply.code(202).send({ accepted: true, deliveryId, event: request.headers['x-github-event'] ?? 'unknown' });
  });

  app.get('/openapi.json', async (_request, reply) => reply.send({ openapi: '3.1.0', info: { title: 'OpenTestPilot API', version: '0.1.0' }, paths: {
    '/v1/organizations': { post: {} },
    '/v1/organizations/{organizationId}': { get: {} },
    '/v1/organizations/{organizationId}/projects': { post: {} },
    '/v1/organizations/{organizationId}/tests': { get: {}, post: {} },
    '/v1/organizations/{organizationId}/runs': { get: {}, post: {} },
    '/v1/runs/{runId}': { get: {} },
    '/v1/runs/{runId}/report': { get: {} },
    '/v1/organizations/{organizationId}/runners': { post: {} },
    '/v1/runners/{runnerId}/heartbeat': { post: {} },
    '/v1/organizations/{organizationId}/jobs': { post: {} },
    '/v1/runners/{runnerId}/lease': { post: {} },
    '/v1/jobs/{jobId}/complete': { post: {} },
    '/v1/organizations/{organizationId}/schedules': { get: {}, post: {} },
    '/v1/webhooks/github': { post: {} },
  } }));

  return app;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const app = buildServer(createConfiguredRepository());
  await app.listen({ host: '0.0.0.0', port: Number(process.env['PORT'] ?? 3001) });
}
