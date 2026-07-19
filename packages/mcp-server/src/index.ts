import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export interface PlatformClient {
  runStart(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  runStatus(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  organizationGet?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  projectGet?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  repositoryGet?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  testList?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  testGet?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  testGetManifest?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  testGetGeneratedCode?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  changeRequestList?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  changeRequestGet?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  changeRequestUpdate?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  runGetFailures?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  runGetStep?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  runCompare?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  artifactGet?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  repairRegister?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  pullRequestRegister?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  reportUrl?(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

interface McpRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

const common = { organizationId: { type: 'string' } };
const tools = [
  { name: 'organization_get', description: 'Get an organization', inputSchema: { type: 'object', properties: common, required: ['organizationId'] } },
  { name: 'project_get', description: 'Get a project', inputSchema: { type: 'object', properties: { ...common, projectId: { type: 'string' } }, required: ['organizationId', 'projectId'] } },
  { name: 'repository_get', description: 'Get a repository integration', inputSchema: { type: 'object', properties: { ...common, repositoryId: { type: 'string' } }, required: ['organizationId', 'repositoryId'] } },
  { name: 'test_list', description: 'List tests in an organization', inputSchema: { type: 'object', properties: common, required: ['organizationId'] } },
  { name: 'test_get', description: 'Get test metadata', inputSchema: { type: 'object', properties: { ...common, testId: { type: 'string' } }, required: ['organizationId', 'testId'] } },
  { name: 'test_get_manifest', description: 'Get a test Manifest', inputSchema: { type: 'object', properties: { ...common, testId: { type: 'string' } }, required: ['organizationId', 'testId'] } },
  { name: 'test_get_generated_code', description: 'Get generated test code', inputSchema: { type: 'object', properties: { ...common, testId: { type: 'string' } }, required: ['organizationId', 'testId'] } },
  { name: 'change_request_list', description: 'List change requests', inputSchema: { type: 'object', properties: common, required: ['organizationId'] } },
  { name: 'change_request_get', description: 'Get a change request', inputSchema: { type: 'object', properties: { ...common, changeRequestId: { type: 'string' } }, required: ['organizationId', 'changeRequestId'] } },
  { name: 'change_request_update', description: 'Update a change request', inputSchema: { type: 'object', properties: { ...common, changeRequestId: { type: 'string' }, status: { type: 'string' } }, required: ['organizationId', 'changeRequestId', 'status'] } },
  { name: 'run_start', description: 'Start an asynchronous OpenTestPilot run', inputSchema: { type: 'object', properties: { ...common, projectId: { type: 'string' }, testId: { type: 'string' } }, required: ['organizationId', 'projectId', 'testId'] } },
  { name: 'run_get_status', description: 'Get asynchronous run status', inputSchema: { type: 'object', properties: { ...common, runId: { type: 'string' } }, required: ['organizationId', 'runId'] } },
  { name: 'run_get_failures', description: 'Get run failure summaries', inputSchema: { type: 'object', properties: { ...common, runId: { type: 'string' } }, required: ['organizationId', 'runId'] } },
  { name: 'run_get_step', description: 'Get a run step result', inputSchema: { type: 'object', properties: { ...common, runId: { type: 'string' }, stepId: { type: 'string' } }, required: ['organizationId', 'runId', 'stepId'] } },
  { name: 'run_compare', description: 'Compare two runs', inputSchema: { type: 'object', properties: { ...common, runId: { type: 'string' }, baselineRunId: { type: 'string' } }, required: ['organizationId', 'runId', 'baselineRunId'] } },
  { name: 'artifact_get', description: 'Get artifact metadata or content', inputSchema: { type: 'object', properties: { ...common, artifactId: { type: 'string' } }, required: ['organizationId', 'artifactId'] } },
  { name: 'repair_register', description: 'Register a repair request', inputSchema: { type: 'object', properties: { ...common, runId: { type: 'string' }, reason: { type: 'string' } }, required: ['organizationId', 'runId', 'reason'] } },
  { name: 'pull_request_register', description: 'Register a pull request result', inputSchema: { type: 'object', properties: { ...common, url: { type: 'string' } }, required: ['organizationId', 'url'] } },
  { name: 'report_get_url', description: 'Get the report URL for a completed run', inputSchema: { type: 'object', properties: { ...common, runId: { type: 'string' } }, required: ['organizationId', 'runId'] } },
];

function textResult(value: Record<string, unknown>): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function paramsOf(request: McpRequest): Record<string, unknown> {
  return request.params ?? {};
}

export async function handleMcpMessage(request: McpRequest, client: PlatformClient): Promise<McpResponse> {
  try {
    if (request.method === 'initialize') return { jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'open-test-pilot', version: '0.1.0' } } };
    if (request.method === 'notifications/initialized') return { jsonrpc: '2.0', id: request.id, result: {} };
    if (request.method === 'tools/list') return { jsonrpc: '2.0', id: request.id, result: { tools } };
    if (request.method === 'tools/call') {
      const params = paramsOf(request);
      const name = params['name'];
      const argumentsValue = params['arguments'];
      if (typeof name !== 'string' || argumentsValue === null || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) return { jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'tools/call requires name and object arguments' } };
      const argumentsRecord = argumentsValue as Record<string, unknown>;
      const tool = tools.find((candidate) => candidate.name === name);
      if (tool !== undefined) {
        const missing = tool.inputSchema.required.filter((key) => typeof argumentsRecord[key] !== 'string' || String(argumentsRecord[key]).trim() === '');
        if (missing.length > 0) return { jsonrpc: '2.0', id: request.id, error: { code: -32602, message: `${name} requires: ${missing.join(', ')}` } };
      }
      const methodByTool: Record<string, keyof PlatformClient> = {
        organization_get: 'organizationGet', project_get: 'projectGet', repository_get: 'repositoryGet', test_list: 'testList', test_get: 'testGet', test_get_manifest: 'testGetManifest', test_get_generated_code: 'testGetGeneratedCode', change_request_list: 'changeRequestList', change_request_get: 'changeRequestGet', change_request_update: 'changeRequestUpdate', run_start: 'runStart', run_get_status: 'runStatus', run_get_failures: 'runGetFailures', run_get_step: 'runGetStep', run_compare: 'runCompare', artifact_get: 'artifactGet', repair_register: 'repairRegister', pull_request_register: 'pullRequestRegister', report_get_url: 'reportUrl',
      };
      const method = methodByTool[name];
      if (method === undefined) return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Unknown tool: ${name}` } };
      const operation = client[method];
      if (typeof operation !== 'function') return { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: `Tool is not configured: ${name}` } };
      const result = await operation.call(client, argumentsRecord);
      return { jsonrpc: '2.0', id: request.id, result: textResult(result) };
    }
    return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Unknown method: ${request.method}` } };
  } catch (error) {
    return { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } };
  }
}

export function createHttpClient(baseUrl: string, organizationId: string, sessionToken?: string): PlatformClient {
  function assertTenant(input: Record<string, unknown>): void {
    if (input['organizationId'] !== undefined && input['organizationId'] !== organizationId) throw new Error('MCP organizationId does not match the configured tenant');
  }
  async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { accept: 'application/json', 'x-organization-id': organizationId, ...(sessionToken === undefined ? {} : { authorization: `Bearer ${sessionToken}` }), ...(init?.headers ?? {}) } });
    if (!response.ok) throw new Error(`MCP HTTP request failed with ${response.status}`);
    return await response.json() as Record<string, unknown>;
  }
  return {
    async organizationGet(input) { assertTenant(input); return await request(`/v1/organizations/${organizationId}`); },
    async projectGet(input) { assertTenant(input); return await request(`/v1/projects/${String(input['projectId'])}`); },
    async repositoryGet(input) { assertTenant(input); return await request(`/v1/repositories/${String(input['repositoryId'])}`); },
    async testList(input) { assertTenant(input); return await request(`/v1/organizations/${organizationId}/tests`); },
    async testGet(input) { assertTenant(input); return await request(`/v1/tests/${String(input['testId'])}`); },
    async testGetManifest(input) { assertTenant(input); return await request(`/v1/tests/${String(input['testId'])}/manifest`); },
    async testGetGeneratedCode(input) { assertTenant(input); return await request(`/v1/tests/${String(input['testId'])}/generated-code`); },
    async changeRequestList(input) { assertTenant(input); return await request(`/v1/organizations/${organizationId}/change-requests`); },
    async changeRequestGet(input) { assertTenant(input); return await request(`/v1/change-requests/${String(input['changeRequestId'])}`); },
    async changeRequestUpdate(input) { assertTenant(input); return await request(`/v1/change-requests/${String(input['changeRequestId'])}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); },
    async runStart(input) {
      assertTenant(input);
      return await request(`/v1/organizations/${organizationId}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: input['projectId'], testId: input['testId'] }) });
    },
    async runStatus(input) {
      assertTenant(input);
      return await request(`/v1/runs/${String(input['runId'])}`);
    },
    async runGetFailures(input) { assertTenant(input); return await request(`/v1/runs/${String(input['runId'])}/failures`); },
    async runGetStep(input) { assertTenant(input); return await request(`/v1/runs/${String(input['runId'])}/steps/${String(input['stepId'])}`); },
    async runCompare(input) { assertTenant(input); return await request(`/v1/runs/${String(input['runId'])}/compare/${String(input['baselineRunId'])}`); },
    async artifactGet(input) { assertTenant(input); return await request(`/v1/artifacts/${String(input['artifactId'])}/metadata`); },
    async repairRegister(input) { assertTenant(input); return await request(`/v1/runs/${String(input['runId'])}/repair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); },
    async pullRequestRegister(input) { assertTenant(input); return await request('/v1/pull-requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); },
    async reportUrl(input) { assertTenant(input); return await request(`/v1/runs/${String(input['runId'])}/report`); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseUrl = process.env['OPENTESTPILOT_URL'] ?? 'http://127.0.0.1:3001';
  const organizationId = process.env['OPENTESTPILOT_ORGANIZATION_ID'] ?? '';
  const sessionToken = process.env['OPENTESTPILOT_SESSION_TOKEN'];
  const client = createHttpClient(baseUrl, organizationId, sessionToken);
  const input = createInterface({ input: process.stdin, terminal: false });
  input.on('line', async (line) => {
    const parsed = JSON.parse(line) as McpRequest;
    const response = await handleMcpMessage(parsed, client);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}
