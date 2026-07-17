/// <reference types="vite/client" />

export interface ApiTest { id: string; projectId: string; name: string; manifestId: string; createdAt: string; }
export interface ApiTestManifest { testId?: string; manifestId?: string; schemaVersion?: string; [key: string]: unknown; }
export interface ApiRun { id: string; projectId: string; testId: string; status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled'; createdAt: string; startedAt?: string; endedAt?: string; }
export interface ApiSchedule { id: string; projectId: string; testId: string; cron: string; enabled: boolean; createdAt: string; }
export interface ApiFailure { message: string; category?: string; artifacts?: string[]; [key: string]: unknown; }
export interface ApiArtifact { id: string; runId: string; key: string; contentType: string; size: number; storageKey: string; sha256: string; createdAt: string; }
export interface ApiRunEvidence { failures: ApiFailure[]; artifacts: ApiArtifact[]; report: { runId: string; status: ApiRun['status']; reportUrl?: string }; }
export interface ApiChangeRequest { id: string; title: string; description: string; status: 'open' | 'approved' | 'rejected'; createdAt: string; updatedAt: string; }
export interface ApiRepository { id: string; owner: string; name: string; fullName: string; defaultBranch: string; private: boolean; provider: string; githubRepositoryId?: number; installationId?: number; createdAt: string; }
export interface ApiRunner { runnerId: string; organizationId: string; name: string; capabilities: { browsers: string[]; maxConcurrency: number; labels?: string[]; [key: string]: unknown }; heartbeatAt: string; }
export interface ApiPullRequest { number: number; htmlUrl: string; head: string; base: string; }
export interface ApiBranch { name: string; sha: string; }
export interface ApiBranchComparison { status: string; aheadBy: number; behindBy: number; htmlUrl?: string; files: Array<{ filename: string; status: string; additions: number; deletions: number; changes: number }>; }
export interface ApiProject { id: string; organizationId: string; name: string; createdAt: string; }
export interface ApiMember { organizationId: string; userId: string; githubUserId: string; login: string; role: string; createdAt: string; }
export interface ApiAuditEvent { id: string; organizationId: string; action: string; resourceType: string; resourceId?: string; metadata: Record<string, unknown>; createdAt: string; }
export interface ApiStoragePolicy { organizationId: string; successRetentionDays: number; failureRetentionDays: number; fixedRetention: boolean; generatedCodeRetentionDays: number; capacityBytes?: number; updatedAt: string; }
export interface ApiAiWorker { id: string; organizationId: string; name: string; policy: Record<string, unknown>; lastHeartbeatAt?: string; createdAt: string; }
export interface ApiAiWorkerJob { id: string; organizationId: string; workerId: string; operation: string; request: Record<string, unknown>; result?: Record<string, unknown>; status: 'queued' | 'leased' | 'completed' | 'failed' | 'cancelled'; attempt: number; leaseExpiresAt?: string; createdAt: string; updatedAt?: string; }
export interface ApiSecret { id: string; organizationId: string; projectId?: string; environmentId?: string; name: string; provider: string; externalReference?: string; maskedValue: string; rotatedAt?: string; createdAt: string; }

export interface TestPilotApi {
  listTests(): Promise<ApiTest[]>;
  listProjects(): Promise<ApiProject[]>;
  listMembers(): Promise<ApiMember[]>;
  listAuditLogs(): Promise<ApiAuditEvent[]>;
  getStoragePolicy(): Promise<ApiStoragePolicy>;
  updateStoragePolicy(patch: Partial<Pick<ApiStoragePolicy, 'successRetentionDays' | 'failureRetentionDays' | 'fixedRetention' | 'generatedCodeRetentionDays' | 'capacityBytes'>>): Promise<ApiStoragePolicy>;
  listAiWorkers(): Promise<ApiAiWorker[]>;
  listAiWorkerJobs(): Promise<ApiAiWorkerJob[]>;
  listSecrets(): Promise<ApiSecret[]>;
  createSecret(input: { name: string; provider: string; projectId?: string; environmentId?: string; externalReference?: string; value?: string }): Promise<ApiSecret>;
  rotateSecret(secretId: string, value: string): Promise<ApiSecret>;
  listRuns(): Promise<ApiRun[]>;
  listSchedules(): Promise<ApiSchedule[]>;
  listRunners(): Promise<ApiRunner[]>;
  startRun(projectId: string, testId: string): Promise<{ runId: string; status: ApiRun['status'] }>;
  cancelRun(runId: string): Promise<{ runId: string; status: 'cancelled' }>;
  triggerSchedule(scheduleId: string): Promise<{ scheduleId: string; runId: string; status: ApiRun['status']; trigger: 'schedule' }>;
  getRun(runId: string): Promise<ApiRun>;
  getTest(testId: string): Promise<ApiTest>;
  getManifest(testId: string): Promise<ApiTestManifest>;
  updateManifest(testId: string, manifest: ApiTestManifest): Promise<{ testId: string; saved: boolean }>;
  listRepositories(): Promise<ApiRepository[]>;
  syncRepository(repositoryId: string): Promise<ApiRepository>;
  listBranches(repositoryId: string): Promise<ApiBranch[]>;
  compareBranches(repositoryId: string, base: string, head: string): Promise<{ repositoryId: string; base: string; head: string; comparison: ApiBranchComparison }>;
  createGitHubPullRequest(repositoryId: string, input: { title: string; head: string; base?: string; body?: string; draft?: boolean }): Promise<{ repositoryId: string; pullRequest: ApiPullRequest; local: { id: string; url: string } }>;
  listChangeRequests(): Promise<ApiChangeRequest[]>;
  createChangeRequest(title: string, description?: string): Promise<ApiChangeRequest>;
  updateChangeRequest(id: string, patch: { status?: ApiChangeRequest['status']; description?: string }): Promise<ApiChangeRequest>;
  getRunFailures(runId: string): Promise<ApiFailure[]>;
  listArtifacts(runId: string): Promise<ApiArtifact[]>;
  getArtifactContent(artifactId: string): Promise<Blob>;
  getReport(runId: string): Promise<{ runId: string; status: ApiRun['status']; reportUrl?: string }>;
  getRunEvidence(runId: string): Promise<ApiRunEvidence>;
}

export interface ApiConfig { baseUrl: string; organizationId: string; projectId?: string; testId?: string; sessionToken?: string; }

export function getApiConfig(env: Record<string, string | undefined> = import.meta.env): ApiConfig | undefined {
  const baseUrl = env['VITE_OPENTESTPILOT_URL'];
  const organizationId = env['VITE_OPENTESTPILOT_ORGANIZATION_ID'];
  if (baseUrl === undefined || organizationId === undefined) return undefined;
  return { baseUrl: baseUrl.replace(/\/$/, ''), organizationId, ...(env['VITE_OPENTESTPILOT_PROJECT_ID'] === undefined ? {} : { projectId: env['VITE_OPENTESTPILOT_PROJECT_ID'] }), ...(env['VITE_OPENTESTPILOT_TEST_ID'] === undefined ? {} : { testId: env['VITE_OPENTESTPILOT_TEST_ID'] }), ...(env['VITE_OPENTESTPILOT_SESSION_TOKEN'] === undefined ? {} : { sessionToken: env['VITE_OPENTESTPILOT_SESSION_TOKEN'] }) };
}

export function createApi(config: ApiConfig, fetcher: typeof fetch = fetch): TestPilotApi {
  const headers = { accept: 'application/json', 'x-organization-id': config.organizationId, ...(config.sessionToken === undefined ? {} : { authorization: `Bearer ${config.sessionToken}` }) };
  const pathId = (value: string): string => encodeURIComponent(value);
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetcher(`${config.baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    if (!response.ok) throw new Error(`OpenTestPilot API returned ${response.status}`);
    return await response.json() as T;
  }
  return {
    async listTests() { return (await request<{ tests: ApiTest[] }>(`/v1/organizations/${pathId(config.organizationId)}/tests`)).tests; },
    async listProjects() { return (await request<{ projects: ApiProject[] }>(`/v1/organizations/${pathId(config.organizationId)}/projects`)).projects; },
    async listMembers() { return (await request<{ members: ApiMember[] }>(`/v1/organizations/${pathId(config.organizationId)}/members`)).members; },
    async listAuditLogs() { return (await request<{ events: ApiAuditEvent[] }>(`/v1/organizations/${pathId(config.organizationId)}/audit-logs`)).events; },
    async getStoragePolicy() { return await request<ApiStoragePolicy>(`/v1/organizations/${pathId(config.organizationId)}/storage-policy`); },
    async updateStoragePolicy(patch) { return await request<ApiStoragePolicy>(`/v1/organizations/${pathId(config.organizationId)}/storage-policy`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }); },
    async listAiWorkers() { return (await request<{ workers: ApiAiWorker[] }>(`/v1/organizations/${pathId(config.organizationId)}/ai-workers`)).workers; },
    async listAiWorkerJobs() { return (await request<{ jobs: ApiAiWorkerJob[] }>(`/v1/organizations/${pathId(config.organizationId)}/ai-worker-jobs`)).jobs; },
    async listSecrets() { return (await request<{ secrets: ApiSecret[] }>(`/v1/organizations/${pathId(config.organizationId)}/secrets`)).secrets; },
    async createSecret(input) { return await request<ApiSecret>(`/v1/organizations/${pathId(config.organizationId)}/secrets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); },
    async rotateSecret(secretId, value) { return await request<ApiSecret>(`/v1/secrets/${pathId(secretId)}/rotate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) }); },
    async listRuns() { return (await request<{ runs: ApiRun[] }>(`/v1/organizations/${pathId(config.organizationId)}/runs`)).runs; },
    async listSchedules() { return (await request<{ schedules: ApiSchedule[] }>(`/v1/organizations/${pathId(config.organizationId)}/schedules`)).schedules; },
    async listRunners() { return (await request<{ runners: ApiRunner[] }>(`/v1/organizations/${pathId(config.organizationId)}/runners`)).runners; },
    async startRun(projectId, testId) { return await request<{ runId: string; status: ApiRun['status'] }>(`/v1/organizations/${pathId(config.organizationId)}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, testId }) }); },
    async cancelRun(runId) { return await request<{ runId: string; status: 'cancelled' }>(`/v1/jobs/job-${pathId(runId)}/cancel`, { method: 'POST' }); },
    async triggerSchedule(scheduleId) { return await request<{ scheduleId: string; runId: string; status: ApiRun['status']; trigger: 'schedule' }>(`/v1/schedules/${pathId(scheduleId)}/trigger`, { method: 'POST' }); },
    async getRun(runId) { return await request<ApiRun>(`/v1/runs/${pathId(runId)}`); },
    async getTest(testId) { return await request<ApiTest>(`/v1/tests/${pathId(testId)}`); },
    async getManifest(testId) { return await request<ApiTestManifest>(`/v1/tests/${pathId(testId)}/manifest`); },
    async updateManifest(testId, manifest) { return await request<{ testId: string; saved: boolean }>(`/v1/tests/${pathId(testId)}/manifest`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(manifest) }); },
    async listRepositories() { return (await request<{ repositories: ApiRepository[] }>(`/v1/organizations/${pathId(config.organizationId)}/repositories`)).repositories; },
    async syncRepository(repositoryId) { return await request<ApiRepository>(`/v1/repositories/${pathId(repositoryId)}/sync`, { method: 'POST' }); },
    async listBranches(repositoryId) { return (await request<{ repositoryId: string; branches: ApiBranch[] }>(`/v1/repositories/${pathId(repositoryId)}/branches`)).branches; },
    async compareBranches(repositoryId, base, head) { return await request<{ repositoryId: string; base: string; head: string; comparison: ApiBranchComparison }>(`/v1/repositories/${pathId(repositoryId)}/compare?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`); },
    async createGitHubPullRequest(repositoryId, input) { return await request<{ repositoryId: string; pullRequest: ApiPullRequest; local: { id: string; url: string } }>(`/v1/repositories/${pathId(repositoryId)}/pull-requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); },
    async listChangeRequests() { return (await request<{ changeRequests: ApiChangeRequest[] }>(`/v1/organizations/${pathId(config.organizationId)}/change-requests`)).changeRequests; },
    async createChangeRequest(title, description) { return await request<ApiChangeRequest>(`/v1/organizations/${pathId(config.organizationId)}/change-requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, ...(description === undefined ? {} : { description }) }) }); },
    async updateChangeRequest(id, patch) { return await request<ApiChangeRequest>(`/v1/change-requests/${pathId(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }); },
    async getRunFailures(runId) { return (await request<{ failures: ApiFailure[] }>(`/v1/runs/${pathId(runId)}/failures`)).failures; },
    async listArtifacts(runId) { return (await request<{ artifacts: ApiArtifact[] }>(`/v1/runs/${pathId(runId)}/artifacts`)).artifacts; },
    async getArtifactContent(artifactId) {
      const response = await fetcher(`${config.baseUrl}/v1/artifacts/${pathId(artifactId)}`, { headers });
      if (!response.ok) throw new Error(`OpenTestPilot API returned ${response.status}`);
      return await response.blob();
    },
    async getReport(runId) { return await request<{ runId: string; status: ApiRun['status']; reportUrl?: string }>(`/v1/runs/${pathId(runId)}/report`); },
    async getRunEvidence(runId) { const [failures, artifacts, report] = await Promise.all([this.getRunFailures(runId), this.listArtifacts(runId), this.getReport(runId)]); return { failures, artifacts, report }; },
  };
}
