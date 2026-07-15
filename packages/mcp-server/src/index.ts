import { createInterface } from 'node:readline';

export interface PlatformClient {
  runStart(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  runStatus(input: Record<string, unknown>): Promise<Record<string, unknown>>;
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

const tools = [
  { name: 'run_start', description: 'Start an asynchronous OpenTestPilot run', inputSchema: { type: 'object', properties: { organizationId: { type: 'string' }, projectId: { type: 'string' }, testId: { type: 'string' } }, required: ['organizationId', 'projectId', 'testId'] } },
  { name: 'run_get_status', description: 'Get asynchronous run status', inputSchema: { type: 'object', properties: { organizationId: { type: 'string' }, runId: { type: 'string' } }, required: ['organizationId', 'runId'] } },
  { name: 'test_list', description: 'List tests in an organization', inputSchema: { type: 'object', properties: { organizationId: { type: 'string' } }, required: ['organizationId'] } },
  { name: 'report_get_url', description: 'Get the report URL for a completed run', inputSchema: { type: 'object', properties: { organizationId: { type: 'string' }, runId: { type: 'string' } }, required: ['organizationId', 'runId'] } },
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
      if (name === 'run_start') return { jsonrpc: '2.0', id: request.id, result: textResult(await client.runStart(argumentsRecord)) };
      if (name === 'run_get_status') return { jsonrpc: '2.0', id: request.id, result: textResult(await client.runStatus(argumentsRecord)) };
      return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Unknown tool: ${name}` } };
    }
    return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Unknown method: ${request.method}` } };
  } catch (error) {
    return { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } };
  }
}

function createHttpClient(baseUrl: string, organizationId: string): PlatformClient {
  return {
    async runStart(input) {
      const response = await fetch(`${baseUrl}/v1/organizations/${organizationId}/runs`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-organization-id': organizationId }, body: JSON.stringify({ projectId: input['projectId'], testId: input['testId'] }) });
      if (!response.ok) throw new Error(`run_start failed with ${response.status}`);
      return await response.json() as Record<string, unknown>;
    },
    async runStatus(input) {
      const response = await fetch(`${baseUrl}/v1/runs/${String(input['runId'])}`, { headers: { 'x-organization-id': organizationId } });
      if (!response.ok) throw new Error(`run_get_status failed with ${response.status}`);
      return await response.json() as Record<string, unknown>;
    },
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const baseUrl = process.env['OPENTESTPILOT_URL'] ?? 'http://127.0.0.1:3001';
  const organizationId = process.env['OPENTESTPILOT_ORGANIZATION_ID'] ?? '';
  const client = createHttpClient(baseUrl, organizationId);
  const input = createInterface({ input: process.stdin, terminal: false });
  input.on('line', async (line) => {
    const parsed = JSON.parse(line) as McpRequest;
    const response = await handleMcpMessage(parsed, client);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}
