/// <reference types="vite/client" />

export interface ApiTest { id: string; projectId: string; name: string; manifestId: string; createdAt: string; }
export interface ApiTestManifest { testId?: string; manifestId?: string; schemaVersion?: string; [key: string]: unknown; }
export interface ApiRun { id: string; projectId: string; testId: string; status: 'queued' | 'running' | 'passed' | 'failed'; createdAt: string; startedAt?: string; endedAt?: string; }
export interface ApiSchedule { id: string; projectId: string; testId: string; cron: string; enabled: boolean; createdAt: string; }

export interface TestPilotApi {
  listTests(): Promise<ApiTest[]>;
  listRuns(): Promise<ApiRun[]>;
  listSchedules(): Promise<ApiSchedule[]>;
  startRun(projectId: string, testId: string): Promise<{ runId: string; status: ApiRun['status'] }>;
  getRun(runId: string): Promise<ApiRun>;
  getTest(testId: string): Promise<ApiTest>;
  getManifest(testId: string): Promise<ApiTestManifest>;
  updateManifest(testId: string, manifest: ApiTestManifest): Promise<{ testId: string; saved: boolean }>;
}

export interface ApiConfig { baseUrl: string; organizationId: string; projectId?: string; testId?: string; }

export function getApiConfig(env: Record<string, string | undefined> = import.meta.env): ApiConfig | undefined {
  const baseUrl = env['VITE_OPENTESTPILOT_URL'];
  const organizationId = env['VITE_OPENTESTPILOT_ORGANIZATION_ID'];
  if (baseUrl === undefined || organizationId === undefined) return undefined;
  return { baseUrl: baseUrl.replace(/\/$/, ''), organizationId, ...(env['VITE_OPENTESTPILOT_PROJECT_ID'] === undefined ? {} : { projectId: env['VITE_OPENTESTPILOT_PROJECT_ID'] }), ...(env['VITE_OPENTESTPILOT_TEST_ID'] === undefined ? {} : { testId: env['VITE_OPENTESTPILOT_TEST_ID'] }) };
}

export function createApi(config: ApiConfig, fetcher: typeof fetch = fetch): TestPilotApi {
  const headers = { accept: 'application/json', 'x-organization-id': config.organizationId };
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetcher(`${config.baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    if (!response.ok) throw new Error(`OpenTestPilot API returned ${response.status}`);
    return await response.json() as T;
  }
  return {
    async listTests() { return (await request<{ tests: ApiTest[] }>(`/v1/organizations/${config.organizationId}/tests`)).tests; },
    async listRuns() { return (await request<{ runs: ApiRun[] }>(`/v1/organizations/${config.organizationId}/runs`)).runs; },
    async listSchedules() { return (await request<{ schedules: ApiSchedule[] }>(`/v1/organizations/${config.organizationId}/schedules`)).schedules; },
    async startRun(projectId, testId) { return await request<{ runId: string; status: ApiRun['status'] }>(`/v1/organizations/${config.organizationId}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, testId }) }); },
    async getRun(runId) { return await request<ApiRun>(`/v1/runs/${runId}`); },
    async getTest(testId) { return await request<ApiTest>(`/v1/tests/${testId}`); },
    async getManifest(testId) { return await request<ApiTestManifest>(`/v1/tests/${testId}/manifest`); },
    async updateManifest(testId, manifest) { return await request<{ testId: string; saved: boolean }>(`/v1/tests/${testId}/manifest`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(manifest) }); },
  };
}
