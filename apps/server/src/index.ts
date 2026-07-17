import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { buildGitHubAuthorizationUrl, createGitHubInstallationToken, exchangeGitHubOAuthCode, GitHubApiClient, verifyWebhookSignature } from '@open-test-pilot/github-adapter';
import { createManifestValidator } from '@open-test-pilot/manifest-schema';
import { importExternalResult } from '@open-test-pilot/result-importer';
import { type RunnerCapabilities } from '@open-test-pilot/scheduler';
import type { Job } from '@open-test-pilot/runner-protocol';
import { validateCronExpression } from '@open-test-pilot/trigger-adapter';
import { MemoryExecutionQueue, RedisExecutionQueue, type ExecutionQueue } from '@open-test-pilot/queue-adapter';
import { LocalStorageAdapter, S3StorageAdapter, type StorageAdapter } from '@open-test-pilot/storage-adapter';
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

export interface StoredRunResult {
  failures: unknown[];
  steps: unknown[];
  [key: string]: unknown;
}

export interface ArtifactMetadata {
  id: string;
  organizationId: string;
  runId: string;
  key: string;
  contentType: string;
  size: number;
  storageKey: string;
  sha256: string;
  createdAt: string;
}

export interface RepositoryRecord {
  id: string;
  organizationId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  provider: string;
  githubRepositoryId?: number;
  installationId?: number;
  createdAt: string;
}

export interface TenantRepository {
  createOrganization(name: string): MaybePromise<Organization>;
  getOrganization(id: string): MaybePromise<Organization | undefined>;
  createProject(organizationId: string, name: string): MaybePromise<Project>;
  getProject(organizationId: string, id: string): MaybePromise<Project | undefined>;
  createTest(organizationId: string, projectId: string, name: string, manifestId: string): MaybePromise<TestRecord>;
  listTests(organizationId: string): MaybePromise<TestRecord[]>;
  getTest(organizationId: string, id: string): MaybePromise<TestRecord | undefined>;
  getTestManifest(organizationId: string, id: string): MaybePromise<unknown | undefined>;
  updateTestManifest(organizationId: string, id: string, manifest: unknown): MaybePromise<boolean>;
  createRun(organizationId: string, projectId: string, testId: string): MaybePromise<RunRecord>;
  getRun(id: string, organizationId?: string): MaybePromise<RunRecord | undefined>;
  listRuns(organizationId: string): MaybePromise<RunRecord[]>;
  updateRun(id: string, patch: Partial<Pick<RunRecord, 'status' | 'startedAt' | 'endedAt'>>, organizationId?: string): MaybePromise<RunRecord | undefined>;
  saveRunResult(organizationId: string, runId: string, result: StoredRunResult): MaybePromise<void>;
  getRunResult(organizationId: string, runId: string): MaybePromise<StoredRunResult | undefined>;
  createArtifact(organizationId: string, input: Omit<ArtifactMetadata, 'id' | 'organizationId' | 'createdAt'>): MaybePromise<ArtifactMetadata>;
  listArtifacts(organizationId: string, runId: string): MaybePromise<ArtifactMetadata[]>;
  listArtifactsBefore(organizationId: string, before: string): MaybePromise<ArtifactMetadata[]>;
  deleteArtifact(organizationId: string, artifactId: string): MaybePromise<boolean>;
  recordAuditEvent(organizationId: string, action: string, resourceType: string, resourceId: string | undefined, metadata: Record<string, unknown>): MaybePromise<void>;
  getArtifact(organizationId: string, artifactId: string): MaybePromise<ArtifactMetadata | undefined>;
  createRepository(organizationId: string, input: { owner: string; name: string; provider?: string; installationId?: number }): MaybePromise<RepositoryRecord>;
  getRepository(organizationId: string, id: string): MaybePromise<RepositoryRecord | undefined>;
  listRepositories(organizationId: string): MaybePromise<RepositoryRecord[]>;
  updateRepository(organizationId: string, id: string, patch: { fullName?: string; defaultBranch?: string; private?: boolean; githubRepositoryId?: number | null; installationId?: number | null }): MaybePromise<RepositoryRecord | undefined>;
  createSchedule(organizationId: string, projectId: string, testId: string, cron: string, enabled?: boolean): MaybePromise<ScheduleRecord>;
  listSchedules(organizationId: string): MaybePromise<ScheduleRecord[]>;
  createChangeRequest(organizationId: string, title: string, description?: string): MaybePromise<ChangeRequestRecord>;
  listChangeRequests(organizationId: string): MaybePromise<ChangeRequestRecord[]>;
  getChangeRequest(organizationId: string, id: string): MaybePromise<ChangeRequestRecord | undefined>;
  updateChangeRequest(organizationId: string, id: string, patch: { status?: ChangeRequestRecord['status']; description?: string }): MaybePromise<ChangeRequestRecord | undefined>;
  createRepair(organizationId: string, runId: string, reason: string): MaybePromise<RepairRecord>;
  createPullRequest(organizationId: string, url: string): MaybePromise<PullRequestRecord>;
  upsertGitHubUser(githubUserId: string, login: string): MaybePromise<{ id: string; githubUserId: string; login: string }>;
  createAuthSession(userId: string, expiresAt: string): MaybePromise<{ token: string; expiresAt: string }>;
  getAuthSession(token: string): MaybePromise<{ userId: string; expiresAt: string } | undefined>;
  addOrganizationMembership(organizationId: string, userId: string, role: string): MaybePromise<void>;
  isOrganizationMember(organizationId: string, userId: string): MaybePromise<boolean>;
}

export class InMemoryTenantRepository implements TenantRepository {
  private readonly organizations = new Map<string, Organization>();
  private readonly projects = new Map<string, Project>();
  private readonly tests = new Map<string, TestRecord>();
  private readonly runs = new Map<string, RunRecord>();
  private readonly manifests = new Map<string, unknown>();
  private readonly runResults = new Map<string, StoredRunResult>();
  private readonly artifacts = new Map<string, ArtifactMetadata>();
  private readonly auditEvents: Array<{ organizationId: string; action: string; resourceType: string; resourceId?: string; metadata: Record<string, unknown> }> = [];
  private readonly repositories = new Map<string, RepositoryRecord>();
  private readonly schedules = new Map<string, ScheduleRecord>();
  private readonly changeRequests = new Map<string, ChangeRequestRecord>();
  private readonly repairs = new Map<string, RepairRecord>();
  private readonly pullRequests = new Map<string, PullRequestRecord>();
  private readonly users = new Map<string, { id: string; githubUserId: string; login: string }>();
  private readonly sessions = new Map<string, { userId: string; expiresAt: string }>();
  private readonly memberships = new Set<string>();

  createOrganization(name: string): Organization {
    const organization = { id: `org-${randomUUID()}`, name, createdAt: new Date().toISOString() };
    this.organizations.set(organization.id, organization);
    return organization;
  }

  upsertGitHubUser(githubUserId: string, login: string): { id: string; githubUserId: string; login: string } {
    const existing = [...this.users.values()].find((user) => user.githubUserId === githubUserId);
    if (existing !== undefined) {
      const updated = { ...existing, login };
      this.users.set(existing.id, updated);
      return updated;
    }
    const user = { id: `user-${randomUUID()}`, githubUserId, login };
    this.users.set(user.id, user);
    return user;
  }

  createAuthSession(userId: string, expiresAt: string): { token: string; expiresAt: string } {
    const token = randomUUID();
    this.sessions.set(createHash('sha256').update(token).digest('hex'), { userId, expiresAt });
    return { token, expiresAt };
  }

  getAuthSession(token: string): { userId: string; expiresAt: string } | undefined {
    const session = this.sessions.get(createHash('sha256').update(token).digest('hex'));
    if (session === undefined || Date.parse(session.expiresAt) <= Date.now()) return undefined;
    return session;
  }

  addOrganizationMembership(organizationId: string, userId: string, role: string): void {
    this.memberships.add(`${organizationId}:${userId}:${role}`);
  }

  isOrganizationMember(organizationId: string, userId: string): boolean {
    return [...this.memberships].some((membership) => membership.startsWith(`${organizationId}:${userId}:`));
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

  getTestManifest(organizationId: string, id: string): unknown | undefined {
    return this.getTest(organizationId, id) === undefined ? undefined : this.manifests.get(id);
  }

  updateTestManifest(organizationId: string, id: string, manifest: unknown): boolean {
    if (this.getTest(organizationId, id) === undefined) return false;
    this.manifests.set(id, manifest);
    return true;
  }

  createRun(organizationId: string, projectId: string, testId: string): RunRecord {
    const run = { id: `run-${randomUUID()}`, organizationId, projectId, testId, status: 'queued' as const, createdAt: new Date().toISOString() };
    this.runs.set(run.id, run);
    return run;
  }

  getRun(id: string, _organizationId?: string): RunRecord | undefined { return this.runs.get(id); }

  listRuns(organizationId: string): RunRecord[] { return [...this.runs.values()].filter((run) => run.organizationId === organizationId); }

  updateRun(id: string, patch: Partial<Pick<RunRecord, 'status' | 'startedAt' | 'endedAt'>>, _organizationId?: string): RunRecord | undefined {
    const current = this.runs.get(id);
    if (current === undefined) return undefined;
    const updated = { ...current, ...patch };
    this.runs.set(id, updated);
    return updated;
  }

  saveRunResult(_organizationId: string, runId: string, result: StoredRunResult): void { this.runResults.set(runId, result); }

  getRunResult(_organizationId: string, runId: string): StoredRunResult | undefined { return this.runResults.get(runId); }

  createArtifact(organizationId: string, input: Omit<ArtifactMetadata, 'id' | 'organizationId' | 'createdAt'>): ArtifactMetadata {
    const artifact: ArtifactMetadata = { ...input, id: `artifact-${randomUUID()}`, organizationId, createdAt: new Date().toISOString() };
    this.artifacts.set(artifact.id, artifact);
    return artifact;
  }

  listArtifacts(organizationId: string, runId: string): ArtifactMetadata[] { return [...this.artifacts.values()].filter((artifact) => artifact.organizationId === organizationId && artifact.runId === runId); }

  listArtifactsBefore(organizationId: string, before: string): ArtifactMetadata[] { const timestamp = Date.parse(before); return [...this.artifacts.values()].filter((artifact) => artifact.organizationId === organizationId && Date.parse(artifact.createdAt) < timestamp); }

  deleteArtifact(organizationId: string, artifactId: string): boolean { const artifact = this.getArtifact(organizationId, artifactId); return artifact === undefined ? false : this.artifacts.delete(artifact.id); }

  recordAuditEvent(organizationId: string, action: string, resourceType: string, resourceId: string | undefined, metadata: Record<string, unknown>): void { this.auditEvents.push({ organizationId, action, resourceType, ...(resourceId === undefined ? {} : { resourceId }), metadata }); }

  getArtifact(organizationId: string, artifactId: string): ArtifactMetadata | undefined {
    const artifact = this.artifacts.get(artifactId);
    return artifact?.organizationId === organizationId ? artifact : undefined;
  }

  createRepository(organizationId: string, input: { owner: string; name: string; provider?: string; installationId?: number }): RepositoryRecord {
    const record: RepositoryRecord = { id: `repository-${randomUUID()}`, organizationId, owner: input.owner, name: input.name, fullName: `${input.owner}/${input.name}`, defaultBranch: 'main', private: false, provider: input.provider ?? 'github', ...(input.installationId === undefined ? {} : { installationId: input.installationId }), createdAt: new Date().toISOString() };
    this.repositories.set(record.id, record);
    return record;
  }

  getRepository(organizationId: string, id: string): RepositoryRecord | undefined {
    const record = this.repositories.get(id);
    return record?.organizationId === organizationId ? record : undefined;
  }

  listRepositories(organizationId: string): RepositoryRecord[] {
    return [...this.repositories.values()].filter((record) => record.organizationId === organizationId);
  }

  updateRepository(organizationId: string, id: string, patch: { fullName?: string; defaultBranch?: string; private?: boolean; githubRepositoryId?: number | null; installationId?: number | null }): RepositoryRecord | undefined {
    const record = this.repositories.get(id);
    if (record === undefined || record.organizationId !== organizationId) return undefined;
    const updated: RepositoryRecord = { ...record, ...('fullName' in patch ? { fullName: patch.fullName ?? record.fullName } : {}), ...('defaultBranch' in patch ? { defaultBranch: patch.defaultBranch ?? record.defaultBranch } : {}), ...('private' in patch ? { private: patch.private ?? record.private } : {}), ...('githubRepositoryId' in patch) ? (patch.githubRepositoryId === null ? {} : { githubRepositoryId: patch.githubRepositoryId }) : {}, ...('installationId' in patch) ? (patch.installationId === null ? {} : { installationId: patch.installationId }) : {} };
    this.repositories.set(updated.id, updated);
    return updated;
  }

  createSchedule(organizationId: string, projectId: string, testId: string, cron: string, enabled?: boolean): ScheduleRecord {
    const schedule: ScheduleRecord = { id: `schedule-${randomUUID()}`, organizationId, projectId, testId, cron, enabled: enabled ?? true, createdAt: new Date().toISOString() };
    this.schedules.set(schedule.id, schedule);
    return schedule;
  }

  listSchedules(organizationId: string): ScheduleRecord[] {
    return [...this.schedules.values()].filter((s) => s.organizationId === organizationId);
  }

  createChangeRequest(organizationId: string, title: string, description?: string): ChangeRequestRecord {
    const timestamp = new Date().toISOString();
    const record: ChangeRequestRecord = { id: `change-request-${randomUUID()}`, organizationId, title, description: description ?? '', status: 'open', createdAt: timestamp, updatedAt: timestamp };
    this.changeRequests.set(record.id, record);
    return record;
  }

  listChangeRequests(organizationId: string): ChangeRequestRecord[] {
    return [...this.changeRequests.values()].filter((r) => r.organizationId === organizationId);
  }

  getChangeRequest(organizationId: string, id: string): ChangeRequestRecord | undefined {
    const record = this.changeRequests.get(id);
    return record?.organizationId === organizationId ? record : undefined;
  }

  updateChangeRequest(organizationId: string, id: string, patch: { status?: ChangeRequestRecord['status']; description?: string }): ChangeRequestRecord | undefined {
    const record = this.changeRequests.get(id);
    if (record === undefined || record.organizationId !== organizationId) return undefined;
    const updated: ChangeRequestRecord = { ...record, ...(patch.status === undefined ? {} : { status: patch.status }), ...(patch.description === undefined ? {} : { description: patch.description }), updatedAt: new Date().toISOString() };
    this.changeRequests.set(updated.id, updated);
    return updated;
  }

  createRepair(organizationId: string, runId: string, reason: string): RepairRecord {
    const repair: RepairRecord = { id: `repair-${randomUUID()}`, organizationId, runId, reason, status: 'queued', createdAt: new Date().toISOString() };
    this.repairs.set(repair.id, repair);
    return repair;
  }

  createPullRequest(organizationId: string, url: string): PullRequestRecord {
    const record: PullRequestRecord = { id: `pull-request-${randomUUID()}`, organizationId, url, createdAt: new Date().toISOString() };
    this.pullRequests.set(record.id, record);
    return record;
  }
}

interface OrganizationParams { organizationId: string }
interface RunParams { runId: string }
interface StepParams { runId: string; stepId: string }
interface ResourceParams { id: string }
interface CreateOrganizationBody { name: string }
interface CreateProjectBody { name: string }
interface CreateTestBody { projectId: string; name: string; manifestId: string; manifest?: unknown }
interface CreateRunBody { projectId: string; testId: string; priority?: number; requiredLabels?: string[] }
interface TenantHeaders { 'x-organization-id'?: string }
interface GitHubStartQuery { redirectUri?: string }
interface GitHubCallbackQuery { code?: string; state?: string }
interface CreateRunnerBody { name: string; capabilities: RunnerCapabilities }
interface CreateJobBody { job: Job }
interface RunnerParams { runnerId: string }
interface JobParams { jobId: string }
interface CompleteJobBody { status: 'passed' | 'failed' | 'cancelled'; result?: { failures?: unknown[]; steps?: unknown[]; [key: string]: unknown } }
interface ImportResultBody { framework: 'unit' | 'component' | 'integration'; result: string | Record<string, unknown> }
interface PurgeArtifactsBody { before?: string; dryRun?: boolean }
interface CreateScheduleBody { projectId: string; testId: string; cron: string; enabled?: boolean }
export interface ScheduleRecord { id: string; organizationId: string; projectId: string; testId: string; cron: string; enabled: boolean; createdAt: string }
interface CreateArtifactBody { key: string; contentType: string; bodyBase64: string }
interface CreateRepositoryBody { owner: string; name: string; provider?: string; installationId?: number }
interface PublishGitHubRunBody { repositoryId: string; headSha: string; issueNumber?: number; comment?: string }
export interface ChangeRequestRecord { id: string; organizationId: string; title: string; description: string; status: 'open' | 'approved' | 'rejected'; createdAt: string; updatedAt: string }
interface CreateChangeRequestBody { title: string; description?: string }
export interface RepairRecord { id: string; organizationId: string; runId: string; reason: string; status: 'queued'; createdAt: string }
export interface PullRequestRecord { id: string; organizationId: string; url: string; createdAt: string }

function tenantId(request: FastifyRequest<{ Headers: TenantHeaders }>): string | undefined {
  const value = request.headers['x-organization-id'];
  if (value === undefined) return undefined;
  // PostgreSQL RLS casts app.organization_id to uuid. Reject malformed
  // tenant headers before they reach the repository so they cannot become
  // database errors or bypass the normal authorization response.
  return /^org-[A-Za-z0-9-]+$/.test(value) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ? value : undefined;
}

function parseInstallationId(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
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

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token.length === 0 ? undefined : token;
}

export function createConfiguredRepository(): TenantRepository {
  return process.env['DATABASE_URL'] === undefined ? new InMemoryTenantRepository() : new PostgresTenantRepository(process.env['DATABASE_URL']);
}

export function createConfiguredExecutionQueue(): ExecutionQueue { return process.env['REDIS_URL'] === undefined ? new MemoryExecutionQueue() : new RedisExecutionQueue(process.env['REDIS_URL']); }
export function createConfiguredArtifactStore(): StorageAdapter { if (process.env['S3_BUCKET'] !== undefined) return new S3StorageAdapter({ bucket: process.env['S3_BUCKET'], ...(process.env['S3_ENDPOINT'] === undefined ? {} : { endpoint: process.env['S3_ENDPOINT'] }), ...(process.env['S3_REGION'] === undefined ? {} : { region: process.env['S3_REGION'] }), ...(process.env['S3_ACCESS_KEY_ID'] === undefined ? {} : { accessKeyId: process.env['S3_ACCESS_KEY_ID'] }), ...(process.env['S3_SECRET_ACCESS_KEY'] === undefined ? {} : { secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] }) }); return new LocalStorageAdapter(process.env['ARTIFACT_DIR'] ?? '.testpilot/artifacts'); }

export function buildServer(repository: TenantRepository = createConfiguredRepository(), executionQueue: ExecutionQueue = createConfiguredExecutionQueue(), artifactStore: StorageAdapter = createConfiguredArtifactStore()): FastifyInstance {
  const app = Fastify({ logger: false });
  const oauthStates = new Set<string>();
  const authenticatedUsers = new WeakMap<object, string>();
  const validateManifest = createManifestValidator();
  void app.register(cors, { origin: process.env['WEB_ORIGIN'] ?? true });

  app.addHook('preHandler', async (request, reply) => {
    if (process.env['AUTH_REQUIRED'] !== 'true' || !request.url.startsWith('/v1/') || request.url.startsWith('/v1/webhooks/')) return;
    const session = await repository.getAuthSession(bearerToken(request) ?? '');
    if (session === undefined) return reply.code(401).send({ error: 'GitHub OAuth session required' });
    authenticatedUsers.set(request, session.userId);
    const pathOrganization = /^\/v1\/organizations\/([^/]+)/.exec(request.url)?.[1];
    const headerOrganization = request.headers['x-organization-id'];
    const organizationId = pathOrganization ?? (typeof headerOrganization === 'string' ? headerOrganization : undefined);
    if (organizationId !== undefined && !await repository.isOrganizationMember(organizationId, session.userId)) return reply.code(403).send({ error: 'organization membership required' });
  });

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
    const githubUser = await new GitHubApiClient(token.accessToken).getAuthenticatedUser();
    const user = await repository.upsertGitHubUser(String(githubUser.id), githubUser.login);
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const session = await repository.createAuthSession(user.id, expiresAt);
    return reply.send({ authenticated: true, sessionToken: session.token, expiresAt: session.expiresAt, login: user.login, scope: token.scope });
  });

  app.post<{ Body: CreateOrganizationBody }>('/v1/organizations', async (request, reply) => {
    if (typeof request.body?.name !== 'string' || request.body.name.trim().length === 0) {
      return reply.code(400).send({ error: 'name is required' });
    }
    const organization = await repository.createOrganization(request.body.name.trim());
    const userId = authenticatedUsers.get(request);
    if (userId !== undefined) await repository.addOrganizationMembership(organization.id, userId, 'owner');
    return reply.code(201).send(organization);
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
    if (body.manifest !== undefined) {
      const validation = validateManifest(body.manifest);
      if (!validation.valid) return reply.code(400).send({ error: 'manifest validation failed', errors: validation.errors });
    }
    const test = await repository.createTest(request.params.organizationId, body.projectId, body.name.trim(), body.manifestId);
    if (body.manifest !== undefined) await repository.updateTestManifest(request.params.organizationId, test.id, body.manifest);
    return reply.code(201).send(test);
  });

  app.get<{ Params: OrganizationParams; Headers: TenantHeaders }>('/v1/organizations/:organizationId/tests', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    return reply.send({ tests: await repository.listTests(request.params.organizationId) });
  });

  app.get<{ Params: { projectId: string }; Headers: TenantHeaders }>('/v1/projects/:projectId', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const project = await repository.getProject(organizationId, request.params.projectId);
    return project === undefined ? reply.code(404).send({ error: 'project not found' }) : reply.send(project);
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: CreateRepositoryBody }>('/v1/organizations/:organizationId/repositories', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    const body = request.body;
    if (typeof body?.owner !== 'string' || typeof body.name !== 'string' || body.owner.trim() === '' || body.name.trim() === '') return reply.code(400).send({ error: 'owner and name are required' });
    return reply.code(201).send(await repository.createRepository(request.params.organizationId, { owner: body.owner.trim(), name: body.name.trim(), ...(body.provider === undefined ? {} : { provider: body.provider }), ...(body.installationId === undefined ? {} : { installationId: body.installationId }) }));
  });

  app.get<{ Params: OrganizationParams; Headers: TenantHeaders }>('/v1/organizations/:organizationId/repositories', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    return reply.send({ repositories: await repository.listRepositories(request.params.organizationId) });
  });

  app.get<{ Params: { repositoryId: string }; Headers: TenantHeaders }>('/v1/repositories/:repositoryId', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const record = await repository.getRepository(organizationId, request.params.repositoryId);
    return record === undefined ? reply.code(404).send({ error: 'repository not found' }) : reply.send(record);
  });

  app.post<{ Params: { repositoryId: string }; Headers: TenantHeaders }>('/v1/repositories/:repositoryId/sync', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const record = await repository.getRepository(organizationId, request.params.repositoryId);
    if (record === undefined) return reply.code(404).send({ error: 'repository not found' });
    if (record.provider !== 'github') return reply.code(400).send({ error: 'repository provider does not support GitHub sync' });
    const appId = process.env['GITHUB_APP_ID'];
    const privateKeyPath = process.env['GITHUB_PRIVATE_KEY_PATH'];
    const installationId = record.installationId ?? parseInstallationId(process.env['GITHUB_INSTALLATION_ID']);
    if (appId === undefined || privateKeyPath === undefined || installationId === undefined) return reply.code(503).send({ error: 'GitHub App sync is not configured' });
    try {
      const privateKey = await readFile(privateKeyPath, 'utf8');
      const installationToken = await createGitHubInstallationToken(installationId, { appId, privateKey });
      const github = new GitHubApiClient(installationToken.token);
      const metadata = await github.getRepository(record.owner, record.name);
      const updated = await repository.updateRepository(organizationId, record.id, { fullName: metadata.fullName, defaultBranch: metadata.defaultBranch, private: metadata.private, githubRepositoryId: metadata.id, installationId });
      return updated === undefined ? reply.code(404).send({ error: 'repository not found' }) : reply.send(updated);
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: ResourceParams; Headers: TenantHeaders }>('/v1/tests/:id', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const test = await repository.getTest(organizationId, request.params.id);
    return test === undefined ? reply.code(404).send({ error: 'test not found' }) : reply.send(test);
  });

  app.get<{ Params: ResourceParams; Headers: TenantHeaders }>('/v1/tests/:id/manifest', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const test = await repository.getTest(organizationId, request.params.id);
    if (test === undefined) return reply.code(404).send({ error: 'test not found' });
    const manifest = await repository.getTestManifest(organizationId, test.id);
    return reply.send(manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest) ? { testId: test.id, manifestId: test.manifestId, ...(manifest as Record<string, unknown>) } : { testId: test.id, manifestId: test.manifestId, schemaVersion: '1.0.0' });
  });

  app.put<{ Params: ResourceParams; Headers: TenantHeaders; Body: unknown }>('/v1/tests/:id/manifest', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    if (request.body === null || typeof request.body !== 'object' || Array.isArray(request.body)) return reply.code(400).send({ error: 'manifest object is required' });
    const body = { ...(request.body as Record<string, unknown>) };
    delete body['testId'];
    delete body['manifestId'];
    const validation = validateManifest(body);
    if (!validation.valid) return reply.code(400).send({ error: 'manifest validation failed', errors: validation.errors });
    if (!await repository.updateTestManifest(organizationId, request.params.id, body)) return reply.code(404).send({ error: 'test not found' });
    return reply.send({ testId: request.params.id, saved: true });
  });

  app.get<{ Params: ResourceParams; Headers: TenantHeaders }>('/v1/tests/:id/generated-code', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const test = await repository.getTest(organizationId, request.params.id);
    return test === undefined ? reply.code(404).send({ error: 'test not found' }) : reply.send({ testId: test.id, manifestId: test.manifestId, path: `generated/${test.manifestId}.spec.ts` });
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: CreateChangeRequestBody }>('/v1/organizations/:organizationId/change-requests', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    if (typeof request.body?.title !== 'string' || request.body.title.trim() === '') return reply.code(400).send({ error: 'title is required' });
    const record = await repository.createChangeRequest(request.params.organizationId, request.body.title.trim(), request.body.description);
    return reply.code(201).send(record);
  });

  app.get<{ Params: OrganizationParams; Headers: TenantHeaders }>('/v1/organizations/:organizationId/change-requests', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    return reply.send({ changeRequests: await repository.listChangeRequests(request.params.organizationId) });
  });

  app.get<{ Params: { changeRequestId: string }; Headers: TenantHeaders }>('/v1/change-requests/:changeRequestId', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const record = await repository.getChangeRequest(organizationId, request.params.changeRequestId);
    if (record === undefined) return reply.code(404).send({ error: 'change request not found' });
    return reply.send(record);
  });

  app.patch<{ Params: { changeRequestId: string }; Headers: TenantHeaders; Body: { status?: ChangeRequestRecord['status']; description?: string } }>('/v1/change-requests/:changeRequestId', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const record = await repository.getChangeRequest(organizationId, request.params.changeRequestId);
    if (record === undefined) return reply.code(404).send({ error: 'change request not found' });
    if (request.body?.status !== undefined && !['open', 'approved', 'rejected'].includes(request.body.status)) return reply.code(400).send({ error: 'invalid change request status' });
    const updated = await repository.updateChangeRequest(organizationId, request.params.changeRequestId, { ...(request.body?.status === undefined ? {} : { status: request.body.status }), ...(request.body?.description === undefined ? {} : { description: request.body.description }) });
    return reply.send(updated);
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: CreateRunBody }>('/v1/organizations/:organizationId/runs', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    const body = request.body;
    if (typeof body?.projectId !== 'string' || typeof body.testId !== 'string') return reply.code(400).send({ error: 'projectId and testId are required' });
    const project = await repository.getProject(request.params.organizationId, body.projectId);
    const test = await repository.getTest(request.params.organizationId, body.testId);
    if (project === undefined || test === undefined) return reply.code(404).send({ error: 'project or test not found' });
    const run = await repository.createRun(request.params.organizationId, body.projectId, body.testId);
    const manifestDocument = await repository.getTestManifest(request.params.organizationId, test.id);
    const job: Job = { jobId: `job-${run.id}`, runId: run.id, organizationId: request.params.organizationId, projectId: project.id, manifest: { schemaVersion: '1.0.0', id: test.manifestId, name: test.name }, ...(manifestDocument === undefined ? {} : { manifestDocument }), requestedCapabilities: { browsers: ['chromium'], maxConcurrency: 1 }, status: 'queued', createdAt: run.createdAt, executionMode: 'docker', ...(body.priority === undefined ? {} : { priority: body.priority }), ...(body.requiredLabels === undefined ? {} : { requiredLabels: body.requiredLabels }) };
    if (!await executionQueue.enqueue(request.params.organizationId, job)) { await repository.updateRun(run.id, { status: 'failed', endedAt: new Date().toISOString() }, request.params.organizationId); return reply.code(503).send({ error: 'run queue unavailable' }); }
    return reply.code(202).send({ runId: run.id, status: run.status });
  });

  app.get<{ Params: RunParams; Headers: TenantHeaders }>('/v1/runs/:runId', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const run = await repository.getRun(request.params.runId, organizationId);
    if (run === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId)) return reply;
    return reply.send(run);
  });

  app.get<{ Params: OrganizationParams; Headers: TenantHeaders }>('/v1/organizations/:organizationId/runs', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    return reply.send({ runs: await repository.listRuns(request.params.organizationId) });
  });

  app.get<{ Params: RunParams; Headers: TenantHeaders }>('/v1/runs/:runId/report', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const run = await repository.getRun(request.params.runId, organizationId);
    if (run === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId)) return reply;
    if (run.status === 'queued' || run.status === 'running') return reply.code(202).send({ runId: run.id, status: run.status });
    return reply.send({ runId: run.id, status: run.status, reportUrl: `/v1/runs/${run.id}/report` });
  });

  app.get<{ Params: RunParams; Headers: TenantHeaders }>('/v1/runs/:runId/failures', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const run = await repository.getRun(request.params.runId, organizationId);
    if (run === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId)) return reply;
    const result = await repository.getRunResult(run.organizationId, run.id);
    return reply.send({ runId: run.id, failures: result?.failures ?? [] });
  });

  app.post<{ Params: RunParams; Headers: TenantHeaders; Body: ImportResultBody }>('/v1/runs/:runId/results/import', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const run = await repository.getRun(request.params.runId, organizationId);
    if (run === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId)) return reply;
    const framework = request.body?.framework;
    if (framework !== 'unit' && framework !== 'component' && framework !== 'integration') return reply.code(400).send({ error: 'framework must be unit, component, or integration' });
    if (request.body?.result === undefined || request.body.result === null) return reply.code(400).send({ error: 'result is required' });
    const imported = importExternalResult(request.body.result, run.id, framework);
    const failures = imported.tests.filter((test) => test.status === 'failed').map((test) => ({ name: test.name, message: test.message, framework }));
    await repository.saveRunResult(run.organizationId, run.id, { protocolVersion: '1.0.0', status: imported.status, importedFramework: framework, importedTests: imported.tests, failures, steps: [{ stepId: `imported:${framework}`, status: imported.status, actions: imported.tests }] });
    await repository.updateRun(run.id, { status: imported.status, endedAt: new Date().toISOString() }, run.organizationId);
    return reply.code(202).send({ runId: run.id, framework, status: imported.status, testCount: imported.tests.length, failureCount: failures.length });
  });

  app.get<{ Params: StepParams; Headers: TenantHeaders }>('/v1/runs/:runId/steps/:stepId', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const run = await repository.getRun(request.params.runId, organizationId);
    if (run === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId)) return reply;
    const result = await repository.getRunResult(run.organizationId, run.id);
    const step = result?.steps.find((candidate) => candidate !== null && typeof candidate === 'object' && (candidate as { stepId?: unknown }).stepId === request.params.stepId);
    return step === undefined ? reply.code(404).send({ error: 'step result not found' }) : reply.send(step);
  });

  app.get<{ Params: { runId: string; baselineRunId: string }; Headers: TenantHeaders }>('/v1/runs/:runId/compare/:baselineRunId', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const run = await repository.getRun(request.params.runId, organizationId);
    const baseline = await repository.getRun(request.params.baselineRunId, organizationId);
    if (run === undefined || baseline === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId) || baseline.organizationId !== run.organizationId) return reply.code(403).send({ error: 'organization access denied' });
    return reply.send({ runId: run.id, baselineRunId: baseline.id, statusChanged: run.status !== baseline.status });
  });

  app.post<{ Params: RunParams; Headers: TenantHeaders; Body: { reason?: string } }>('/v1/runs/:runId/repair', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const run = await repository.getRun(request.params.runId, organizationId);
    if (run === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId)) return reply;
    if (typeof request.body?.reason !== 'string' || request.body.reason.trim() === '') return reply.code(400).send({ error: 'reason is required' });
    const repair = await repository.createRepair(run.organizationId, run.id, request.body.reason.trim());
    return reply.code(201).send(repair);
  });

  app.post<{ Params: RunParams; Headers: TenantHeaders; Body: PublishGitHubRunBody }>('/v1/runs/:runId/github-notify', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const run = await repository.getRun(request.params.runId, organizationId);
    if (run === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId)) return reply;
    const body = request.body;
    if (typeof body?.repositoryId !== 'string' || typeof body.headSha !== 'string' || body.headSha.trim() === '') return reply.code(400).send({ error: 'repositoryId and headSha are required' });
    const record = await repository.getRepository(organizationId, body.repositoryId);
    if (record === undefined) return reply.code(404).send({ error: 'repository not found' });
    if (record.provider !== 'github') return reply.code(400).send({ error: 'repository provider does not support GitHub notifications' });
    const appId = process.env['GITHUB_APP_ID'];
    const privateKeyPath = process.env['GITHUB_PRIVATE_KEY_PATH'];
    const installationId = record.installationId ?? parseInstallationId(process.env['GITHUB_INSTALLATION_ID']);
    if (appId === undefined || privateKeyPath === undefined || installationId === undefined) return reply.code(503).send({ error: 'GitHub App notifications are not configured' });
    try {
      const privateKey = await readFile(privateKeyPath, 'utf8');
      const installationToken = await createGitHubInstallationToken(installationId, { appId, privateKey });
      const github = new GitHubApiClient(installationToken.token);
      const conclusion = run.status === 'passed' ? 'success' : run.status === 'failed' ? 'failure' : undefined;
      const check = await github.createCheckRun(record.owner, record.name, { name: 'OpenTestPilot', headSha: body.headSha, status: conclusion === undefined ? 'in_progress' : 'completed', ...(conclusion === undefined ? {} : { conclusion }), title: `OpenTestPilot ${run.status}`, summary: `Run ${run.id} finished with status ${run.status}.` });
      const commitState = conclusion === undefined ? 'pending' : conclusion === 'success' ? 'success' : 'failure';
      await github.createCommitStatus(record.owner, record.name, body.headSha, commitState, `OpenTestPilot run ${run.status}`, check.htmlUrl);
      const comment = typeof body.issueNumber === 'number' ? await github.createIssueComment(record.owner, record.name, body.issueNumber, body.comment ?? `OpenTestPilot run ${run.id}: ${run.status}`) : undefined;
      return reply.send({ runId: run.id, repositoryId: record.id, check, commitState, ...(comment === undefined ? {} : { comment }) });
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Headers: TenantHeaders; Body: { url?: string } }>('/v1/pull-requests', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    if (typeof request.body?.url !== 'string' || request.body.url.trim() === '') return reply.code(400).send({ error: 'url is required' });
    const record = await repository.createPullRequest(organizationId, request.body.url.trim());
    return reply.code(201).send(record);
  });

  app.post<{ Params: RunParams; Headers: TenantHeaders; Body: CreateArtifactBody }>('/v1/runs/:runId/artifacts', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const run = await repository.getRun(request.params.runId, organizationId);
    if (run === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId)) return reply;
    const body = request.body;
    if (typeof body?.key !== 'string' || typeof body.contentType !== 'string' || typeof body.bodyBase64 !== 'string') return reply.code(400).send({ error: 'key, contentType, and bodyBase64 are required' });
    let bytes: Buffer;
    try { bytes = Buffer.from(body.bodyBase64, 'base64'); } catch { return reply.code(400).send({ error: 'bodyBase64 is invalid' }); }
    const storageKey = `${run.id}/${randomUUID()}/${body.key}`;
    await artifactStore.put({ organizationId: run.organizationId, key: storageKey, body: bytes, contentType: body.contentType });
    const record = await repository.createArtifact(run.organizationId, { runId: run.id, key: body.key, contentType: body.contentType, size: bytes.byteLength, storageKey, sha256: createHash('sha256').update(bytes).digest('hex') });
    return reply.code(201).send(record);
  });

  app.get<{ Params: RunParams; Headers: TenantHeaders }>('/v1/runs/:runId/artifacts', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const run = await repository.getRun(request.params.runId, organizationId);
    if (run === undefined) return reply.code(404).send({ error: 'run not found' });
    if (!requireTenant(request, reply, run.organizationId)) return reply;
    return reply.send({ runId: run.id, artifacts: await repository.listArtifacts(run.organizationId, run.id) });
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: PurgeArtifactsBody }>('/v1/organizations/:organizationId/artifacts/purge', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    const before = request.body?.before === undefined ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) : new Date(request.body.before);
    if (Number.isNaN(before.getTime())) return reply.code(400).send({ error: 'before must be an ISO timestamp' });
    const candidates = await repository.listArtifactsBefore(request.params.organizationId, before.toISOString());
    const dryRun = request.body?.dryRun === true;
    if (dryRun) return reply.send({ organizationId: request.params.organizationId, dryRun: true, before: before.toISOString(), count: candidates.length, bytes: candidates.reduce((sum, artifact) => sum + artifact.size, 0), artifactIds: candidates.map((artifact) => artifact.id) });
    for (const artifact of candidates) {
      await artifactStore.delete({ organizationId: artifact.organizationId, key: artifact.storageKey });
      await repository.deleteArtifact(artifact.organizationId, artifact.id);
      await repository.recordAuditEvent(artifact.organizationId, 'artifact.deleted', 'artifact', artifact.id, { storageKey: artifact.storageKey, reason: 'retention' });
    }
    return reply.send({ organizationId: request.params.organizationId, dryRun: false, before: before.toISOString(), count: candidates.length, bytes: candidates.reduce((sum, artifact) => sum + artifact.size, 0), artifactIds: candidates.map((artifact) => artifact.id) });
  });

  app.get<{ Params: { artifactId: string }; Headers: TenantHeaders }>('/v1/artifacts/:artifactId', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const record = await repository.getArtifact(organizationId, request.params.artifactId);
    if (record === undefined) return reply.code(404).send({ error: 'artifact not found' });
    if (!requireTenant(request, reply, record.organizationId)) return reply;
    const bytes = await artifactStore.get({ organizationId: record.organizationId, key: record.storageKey });
    if (bytes === undefined) return reply.code(404).send({ error: 'artifact body not found' });
    return reply.type(record.contentType).send(bytes);
  });

  app.get<{ Params: { artifactId: string }; Headers: TenantHeaders }>('/v1/artifacts/:artifactId/metadata', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const record = await repository.getArtifact(organizationId, request.params.artifactId);
    if (record === undefined) return reply.code(404).send({ error: 'artifact not found' });
    if (!requireTenant(request, reply, record.organizationId)) return reply;
    return reply.send(record);
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

  app.get<{ Params: OrganizationParams; Headers: TenantHeaders }>('/v1/organizations/:organizationId/runners', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    return reply.send({ organizationId: request.params.organizationId, runners: await executionQueue.listRunners(request.params.organizationId) });
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
    if (job !== undefined) await repository.updateRun(job.runId, { status: 'running', startedAt: new Date().toISOString() }, organizationId);
    return reply.send({ job: job ?? null });
  });

  app.post<{ Params: JobParams; Headers: TenantHeaders; Body: CompleteJobBody }>('/v1/jobs/:jobId/complete', async (request, reply) => {
    const leasedJob = await executionQueue.getJob(request.params.jobId);
    if (leasedJob === undefined) return reply.code(404).send({ error: 'leased job not found' });
    const leasedOrganizationId = leasedJob.organizationId;
    if (leasedOrganizationId === undefined || leasedOrganizationId !== tenantId(request)) return reply.code(403).send({ error: 'organization access denied' });
    const status = request.body?.status;
    if (status !== 'passed' && status !== 'failed' && status !== 'cancelled') return reply.code(400).send({ error: 'status must be passed, failed, or cancelled' });
    const result = await executionQueue.complete(tenantId(request) ?? '', request.params.jobId, status);
    if (result === undefined) return reply.code(404).send({ error: 'leased job not found' });
    const completedRunId = result.runId ?? leasedJob.runId;
    if (completedRunId === undefined) return reply.code(500).send({ error: 'completed job did not include run id' });
    if (request.body?.result !== undefined) await repository.saveRunResult(leasedOrganizationId, completedRunId, { ...request.body.result, failures: request.body.result.failures ?? [], steps: request.body.result.steps ?? [] });
    await repository.updateRun(completedRunId, { status: result.status === 'passed' ? 'passed' : 'failed', endedAt: new Date().toISOString() }, leasedOrganizationId);
    return reply.send({ jobId: result.jobId, status: result.status });
  });

  app.post<{ Params: OrganizationParams; Headers: TenantHeaders; Body: CreateScheduleBody }>('/v1/organizations/:organizationId/schedules', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    const body = request.body;
    if (typeof body?.projectId !== 'string' || typeof body.testId !== 'string' || typeof body.cron !== 'string') return reply.code(400).send({ error: 'projectId, testId, and cron are required' });
    try { validateCronExpression(body.cron); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
    if (await repository.getProject(request.params.organizationId, body.projectId) === undefined || await repository.getTest(request.params.organizationId, body.testId) === undefined) return reply.code(404).send({ error: 'project or test not found' });
    const schedule = await repository.createSchedule(request.params.organizationId, body.projectId, body.testId, validateCronExpression(body.cron), body.enabled);
    return reply.code(201).send(schedule);
  });

  app.get<{ Params: OrganizationParams; Headers: TenantHeaders }>('/v1/organizations/:organizationId/schedules', async (request, reply) => {
    if (!requireTenant(request, reply, request.params.organizationId)) return reply;
    return reply.send({ schedules: await repository.listSchedules(request.params.organizationId) });
  });

  app.post<{ Params: { scheduleId: string }; Headers: TenantHeaders }>('/v1/schedules/:scheduleId/trigger', async (request, reply) => {
    const organizationId = tenantId(request);
    if (organizationId === undefined) return reply.code(401).send({ error: 'organization context required' });
    const schedule = (await repository.listSchedules(organizationId)).find((candidate) => candidate.id === request.params.scheduleId);
    if (schedule === undefined) return reply.code(404).send({ error: 'schedule not found' });
    if (!schedule.enabled) return reply.code(409).send({ error: 'schedule is disabled' });
    const test = await repository.getTest(organizationId, schedule.testId);
    const project = await repository.getProject(organizationId, schedule.projectId);
    if (test === undefined || project === undefined) return reply.code(404).send({ error: 'scheduled project or test not found' });
    const run = await repository.createRun(organizationId, project.id, test.id);
    const manifestDocument = await repository.getTestManifest(organizationId, test.id);
    const job: Job = { jobId: `job-${run.id}`, runId: run.id, organizationId, projectId: project.id, manifest: { schemaVersion: '1.0.0', id: test.manifestId, name: test.name }, ...(manifestDocument === undefined ? {} : { manifestDocument }), requestedCapabilities: { browsers: ['chromium'], maxConcurrency: 1 }, status: 'queued', createdAt: run.createdAt, executionMode: 'docker', priority: 0 };
    if (!await executionQueue.enqueue(organizationId, job)) return reply.code(503).send({ error: 'run queue unavailable' });
    return reply.code(202).send({ scheduleId: schedule.id, runId: run.id, status: run.status, trigger: 'schedule' });
  });

  app.post<{ Headers: { 'x-hub-signature-256'?: string; 'x-github-delivery'?: string; 'x-github-event'?: string }; Body: Record<string, unknown> }>('/v1/webhooks/github', async (request, reply) => {
    const secret = process.env['GITHUB_WEBHOOK_SECRET'];
    if (secret === undefined) return reply.code(503).send({ error: 'GitHub webhook verification is not configured' });
    const signature = request.headers['x-hub-signature-256'];
    const deliveryId = request.headers['x-github-delivery'];
    if (signature === undefined || deliveryId === undefined || !verifyWebhookSignature(JSON.stringify(request.body), signature, secret)) return reply.code(401).send({ error: 'invalid webhook signature' });
    return reply.code(202).send({ accepted: true, deliveryId, event: request.headers['x-github-event'] ?? 'unknown' });
  });

  app.get('/openapi.json', async (_request, reply) => reply.send({ openapi: '3.1.0', info: { title: 'OpenTestPilot API', version: '0.1.0' }, paths: Object.fromEntries(Object.entries({
    '/v1/organizations': { post: {} },
    '/v1/organizations/{organizationId}': { get: {} },
    '/v1/organizations/{organizationId}/projects': { post: {} },
    '/v1/organizations/{organizationId}/repositories': { get: {}, post: {} },
    '/v1/repositories/{repositoryId}': { get: {} },
    '/v1/repositories/{repositoryId}/sync': { post: {} },
    '/v1/organizations/{organizationId}/tests': { get: {}, post: {} },
    '/v1/tests/{id}': { get: {} },
    '/v1/tests/{id}/manifest': { get: {}, put: {} },
    '/v1/tests/{id}/generated-code': { get: {} },
    '/v1/organizations/{organizationId}/change-requests': { get: {}, post: {} },
    '/v1/change-requests/{changeRequestId}': { get: {}, patch: {} },
    '/v1/organizations/{organizationId}/runs': { get: {}, post: {} },
    '/v1/runs/{runId}': { get: {} },
    '/v1/runs/{runId}/report': { get: {} },
    '/v1/runs/{runId}/failures': { get: {} },
    '/v1/runs/{runId}/results/import': { post: {} },
    '/v1/runs/{runId}/steps/{stepId}': { get: {} },
    '/v1/runs/{runId}/compare/{baselineRunId}': { get: {} },
    '/v1/runs/{runId}/repair': { post: {} },
    '/v1/runs/{runId}/github-notify': { post: {} },
    '/v1/runs/{runId}/artifacts': { post: {}, get: {} },
    '/v1/organizations/{organizationId}/artifacts/purge': { post: {} },
    '/v1/artifacts/{artifactId}': { get: {} },
    '/v1/artifacts/{artifactId}/metadata': { get: {} },
    '/v1/pull-requests': { post: {} },
    '/v1/organizations/{organizationId}/runners': { get: {}, post: {} },
    '/v1/runners/{runnerId}/heartbeat': { post: {} },
    '/v1/organizations/{organizationId}/jobs': { post: {} },
    '/v1/runners/{runnerId}/lease': { post: {} },
    '/v1/jobs/{jobId}/complete': { post: {} },
    '/v1/organizations/{organizationId}/schedules': { get: {}, post: {} },
    '/v1/schedules/{scheduleId}/trigger': { post: {} },
    '/v1/webhooks/github': { post: {} },
  }).map(([path, operations]) => [path, Object.fromEntries(Object.entries(operations).map(([method, operation]) => [method, { ...(operation as Record<string, unknown>), responses: { '200': { description: 'Successful response' } } }]))])) }));

  return app;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const app = buildServer(createConfiguredRepository());
  await app.listen({ host: '0.0.0.0', port: Number(process.env['PORT'] ?? 3001) });
}
