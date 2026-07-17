import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentProtocolVersion, validateAgentResult, type AgentOperation, type AgentRequest, type AgentResult } from '@open-test-pilot/agent-protocol';

interface CommandOutput { stdout: string; stderr: string; }

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`command timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else {
        const error = new Error(`command failed with ${signal ?? `exit code ${code}`}`) as Error & { stderr?: string; stdout?: string };
        error.stderr = stderr;
        error.stdout = stdout;
        reject(error);
      }
    });
    child.stdin.end();
  });
}

export interface WorkerPolicy { allowedOperations: Array<AgentRequest['operation']>; maxRetries: number; allowPublish: boolean; }
export const defaultWorkerPolicy: WorkerPolicy = { allowedOperations: ['analyze', 'analyze-failure', 'repair', 'review'], maxRetries: 2, allowPublish: false };

export function validateWorkerRequest(request: AgentRequest, policy: WorkerPolicy = defaultWorkerPolicy): void {
  if (!policy.allowedOperations.includes(request.operation)) throw new Error(`operation ${request.operation} is not allowed for this worker`);
  if (request.operation === 'publish' && !policy.allowPublish) throw new Error('publish requires explicit worker policy');
  if ((request.constraints?.maxRetries ?? 0) > policy.maxRetries) throw new Error('request exceeds worker retry policy');
  if (request.operation === 'repair' && request.constraints?.forbidAppCodeChanges !== true) throw new Error('repair requires forbidAppCodeChanges=true');
}

export interface ClaudeCodeWorkerOptions { command?: string; cwd: string; timeoutMs?: number; policy?: WorkerPolicy; }

export interface CliAgentWorkerOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  policy?: WorkerPolicy;
  strictStructuredOutput?: boolean;
}

function promptFor(request: AgentRequest): string {
  return [
    'You are an Open Test Pilot agent.',
    'Return exactly one JSON object and no markdown. It must be an AgentResult with this shape:',
    '{"requestId":"...","protocolVersion":"1.0.0","status":"completed|failed|rejected","findings":[{"type":"...","severity":"info|warning|error","source":{"file":"..."},"message":"..."}],"proposedChanges":{"manifest":"..."},"pullRequestIntent":{"title":"...","branch":"..."}}',
    'Only include proposedChanges.manifest when a repair is explicitly requested. Never change application source code.',
    JSON.stringify({ requestId: request.requestId, protocolVersion: request.protocolVersion, operation: request.operation, repository: request.repository, constraints: request.constraints, artifacts: request.requestArtifacts }),
  ].join('\n');
}

function jsonCandidates(output: string): unknown[] {
  const candidates: unknown[] = [];
  for (const line of output.split('\n').reverse()) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try { candidates.push(JSON.parse(trimmed) as unknown); } catch { /* Codex JSONL may contain human-readable lines. */ }
  }
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced !== undefined) {
    try { candidates.push(JSON.parse(fenced) as unknown); } catch { /* fall through to a structured parse error */ }
  }
  return candidates;
}

function embeddedTexts(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  const texts: string[] = [];
  for (const key of ['text', 'message', 'content']) {
    const candidate = record[key];
    if (typeof candidate === 'string') texts.push(candidate);
    if (Array.isArray(candidate)) texts.push(...candidate.filter((item): item is string => typeof item === 'string'));
  }
  const item = record['item'];
  if (item !== undefined) texts.push(...embeddedTexts(item));
  return texts;
}

export function parseStructuredAgentResult(request: AgentRequest, output: string): AgentResult {
  const candidates = jsonCandidates(output);
  for (const candidate of candidates) {
    const values = [candidate, ...embeddedTexts(candidate).flatMap((text) => jsonCandidates(text))];
    for (const value of values) {
      if (typeof value !== 'object' || value === null) continue;
      const record = value as Partial<AgentResult>;
      if (record.requestId !== request.requestId || record.protocolVersion !== AgentProtocolVersion || !Array.isArray(record.findings)) continue;
      return validateAgentResult(request, record as AgentResult);
    }
  }
  throw new Error('agent output did not contain a correlated structured AgentResult JSON object');
}

function unstructuredResult(request: AgentRequest, output: string): AgentResult {
  return { requestId: request.requestId, protocolVersion: request.protocolVersion, status: 'completed', findings: [{ type: 'worker-output', severity: 'info', source: { file: request.repository.url }, message: output.trim().slice(0, 20_000) }] };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const details = error as Error & { stderr?: string; stdout?: string };
    const stderr = details.stderr?.trim();
    return stderr === undefined || stderr.length === 0 ? error.message : `${error.message}\n${stderr.slice(0, 8_000)}`;
  }
  return String(error);
}

export class CliAgentWorker {
  private readonly policy: WorkerPolicy;
  constructor(private readonly options: CliAgentWorkerOptions) { this.policy = options.policy ?? defaultWorkerPolicy; }

  async handle(request: AgentRequest): Promise<AgentResult> {
    return this.handleInDirectory(request, this.options.cwd);
  }

  async handleInDirectory(request: AgentRequest, cwd: string): Promise<AgentResult> {
    try { validateWorkerRequest(request, this.policy); } catch (error) { return rejected(request, error); }
    try {
      const result = await runCommand(this.options.command, [...this.options.args, promptFor(request)], cwd, this.options.timeoutMs ?? 300_000);
      if (this.options.strictStructuredOutput === true) return parseStructuredAgentResult(request, result.stdout);
      try { return parseStructuredAgentResult(request, result.stdout); } catch { return unstructuredResult(request, result.stdout); }
    } catch (error) {
      return { requestId: request.requestId, protocolVersion: request.protocolVersion, status: 'failed', findings: [{ type: 'worker-error', severity: 'error', source: { file: request.repository.url }, message: errorMessage(error) }] };
    }
  }
}

export type CodexCodeWorkerOptions = Omit<Partial<CliAgentWorkerOptions>, 'command' | 'args'> & { cwd: string; command?: string; args?: string[] };

export class CodexCodeWorker extends CliAgentWorker {
  constructor(options: CodexCodeWorkerOptions) {
    super({ command: options.command ?? 'codex', args: options.args ?? ['exec', '--json', '--sandbox', 'read-only', '--model', 'gpt-5.5', '--skip-git-repo-check'], strictStructuredOutput: true, ...options });
  }
}

export class ClaudeCodeWorker {
  private readonly policy: WorkerPolicy;
  constructor(private readonly options: ClaudeCodeWorkerOptions) { this.policy = options.policy ?? defaultWorkerPolicy; }

  async handle(request: AgentRequest): Promise<AgentResult> {
    return this.handleInDirectory(request, this.options.cwd);
  }

  async handleInDirectory(request: AgentRequest, cwd: string): Promise<AgentResult> {
    try { validateWorkerRequest(request, this.policy); } catch (error) { return rejected(request, error); }
    try {
      const result = await runCommand(this.options.command ?? 'claude', ['--print', promptFor(request)], cwd, this.options.timeoutMs ?? 300_000);
      try { return parseStructuredAgentResult(request, result.stdout); } catch { return unstructuredResult(request, result.stdout); }
    } catch (error) {
      return { requestId: request.requestId, protocolVersion: request.protocolVersion, status: 'failed', findings: [{ type: 'worker-error', severity: 'error', source: { file: request.repository.url }, message: errorMessage(error) }] };
    }
  }
}

export interface AiWorkerApiClient {
  registerWorker(name: string, policy: WorkerPolicy): Promise<{ id: string }>;
  heartbeat(workerId: string): Promise<void>;
  lease(workerId: string): Promise<{ id: string; operation: string; request: Record<string, unknown> } | undefined>;
  complete(jobId: string, status: 'completed' | 'failed' | 'cancelled', result?: Record<string, unknown>): Promise<void>;
}

export interface AiWorkerDaemonOptions {
  baseUrl: string;
  organizationId: string;
  name: string;
  rootDirectory: string;
  policy?: WorkerPolicy;
  sessionToken?: string;
  gitToken?: string;
  fetcher?: typeof fetch;
  pollIntervalMs?: number;
  worker?: Pick<CliAgentWorker, 'handleInDirectory'>;
  workspace?: { prepare(request: AgentRequest, rootDirectory: string): Promise<string> };
}

export function createAiWorkerApiClient(baseUrl: string, organizationId: string, fetcher: typeof fetch = fetch, sessionToken?: string): AiWorkerApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const headers = { accept: 'application/json', 'x-organization-id': organizationId, ...(sessionToken === undefined ? {} : { authorization: `Bearer ${sessionToken}` }) };
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetcher(`${normalizedBaseUrl}${path}`, { ...init, headers: { ...headers, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...(init.headers ?? {}) } });
    if (!response.ok) throw new Error(`AI Worker API returned ${response.status}`);
    return await response.json() as T;
  }
  return {
    async registerWorker(name, policy) { return await request<{ id: string }>(`/v1/organizations/${encodeURIComponent(organizationId)}/ai-workers`, { method: 'POST', body: JSON.stringify({ name, policy }) }); },
    async heartbeat(workerId) { await request(`/v1/ai-workers/${encodeURIComponent(workerId)}/heartbeat`, { method: 'POST' }); },
    async lease(workerId) { const response = await request<{ job: { id: string; operation: string; request: Record<string, unknown> } | null }>(`/v1/ai-workers/${encodeURIComponent(workerId)}/jobs/lease`, { method: 'POST' }); return response.job ?? undefined; },
    async complete(jobId, status, result) { await request(`/v1/ai-worker-jobs/${encodeURIComponent(jobId)}/complete`, { method: 'POST', body: JSON.stringify({ status, ...(result === undefined ? {} : { result }) }) }); },
  };
}

function parseAgentOperation(value: unknown): AgentOperation {
  const operations: readonly AgentOperation[] = ['analyze', 'design', 'generate', 'run', 'analyze-failure', 'repair', 'publish', 'review'];
  if (typeof value !== 'string' || !operations.includes(value as AgentOperation)) throw new Error(`AI Worker job operation is invalid: ${String(value)}`);
  return value as AgentOperation;
}

function parseAgentRequest(value: Record<string, unknown>): AgentRequest {
  const repository = value['repository'];
  if (typeof value['requestId'] !== 'string' || value['protocolVersion'] !== AgentProtocolVersion || typeof value['operation'] !== 'string' || typeof repository !== 'object' || repository === null || Array.isArray(repository)) throw new Error('AI Worker job request is not a valid AgentRequest');
  const repositoryRecord = repository as Record<string, unknown>;
  if (typeof repositoryRecord['url'] !== 'string' || typeof repositoryRecord['branch'] !== 'string' || typeof repositoryRecord['commit'] !== 'string') throw new Error('AI Worker AgentRequest repository is incomplete');
  const constraints = typeof value['constraints'] === 'object' && value['constraints'] !== null && !Array.isArray(value['constraints']) ? value['constraints'] as NonNullable<AgentRequest['constraints']> : undefined;
  return { requestId: value['requestId'], protocolVersion: AgentProtocolVersion, operation: parseAgentOperation(value['operation']), repository: { url: repositoryRecord['url'], branch: repositoryRecord['branch'], commit: repositoryRecord['commit'] }, ...(typeof value['organizationId'] === 'string' ? { organizationId: value['organizationId'] } : {}), ...(typeof value['projectId'] === 'string' ? { projectId: value['projectId'] } : {}), ...(Array.isArray(value['requestArtifacts']) ? { requestArtifacts: value['requestArtifacts'].filter((item): item is string => typeof item === 'string') } : {}), ...(constraints === undefined ? {} : { constraints }) };
}

async function prepareWorkerWorkspace(request: AgentRequest, rootDirectory: string, gitToken?: string): Promise<string> {
  const requestId = request.requestId.replace(/[^a-zA-Z0-9._-]/g, '-');
  if (requestId.length === 0) throw new Error('AI Worker requestId is required for workspace preparation');
  const workspace = join(rootDirectory, requestId);
  await mkdir(rootDirectory, { recursive: true });
  const gitEnv = gitToken === undefined ? undefined : { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: bearer ${gitToken}` };
  await runCommand('git', ['clone', '--no-checkout', '--depth', '1', '--branch', request.repository.branch, request.repository.url, workspace], rootDirectory, 120_000, gitEnv);
  await runCommand('git', ['fetch', '--depth', '1', 'origin', request.repository.commit], workspace, 120_000, gitEnv);
  await runCommand('git', ['checkout', '--detach', request.repository.commit], workspace, 120_000, gitEnv);
  return workspace;
}

export async function runAiWorkerOnce(options: AiWorkerDaemonOptions, api: AiWorkerApiClient = createAiWorkerApiClient(options.baseUrl, options.organizationId, options.fetcher, options.sessionToken)): Promise<boolean> {
  const policy = options.policy ?? defaultWorkerPolicy;
  const worker = options.worker ?? new CodexCodeWorker({ cwd: options.rootDirectory, policy });
  const registration = await api.registerWorker(options.name, policy);
  return await processAiWorkerJob(options, api, registration.id, worker);
}

async function processAiWorkerJob(options: AiWorkerDaemonOptions, api: AiWorkerApiClient, workerId: string, worker: Pick<CliAgentWorker, 'handleInDirectory'>): Promise<boolean> {
  await api.heartbeat(workerId);
  const job = await api.lease(workerId);
  if (job === undefined) return false;
  try {
    const request = parseAgentRequest(job.request);
    const workspace = options.workspace === undefined ? await prepareWorkerWorkspace(request, options.rootDirectory, options.gitToken) : await options.workspace.prepare(request, options.rootDirectory);
    const result = await worker.handleInDirectory(request, workspace);
    await api.complete(job.id, result.status === 'completed' ? 'completed' : 'failed', result as unknown as Record<string, unknown>);
  } catch (error) {
    await api.complete(job.id, 'failed', { error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}

export async function runAiWorkerDaemon(options: AiWorkerDaemonOptions, signal?: AbortSignal): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const policy = options.policy ?? defaultWorkerPolicy;
  const worker = options.worker ?? new CodexCodeWorker({ cwd: options.rootDirectory, policy });
  const api = createAiWorkerApiClient(options.baseUrl, options.organizationId, options.fetcher, options.sessionToken);
  const registration = await api.registerWorker(options.name, policy);
  while (signal?.aborted !== true) {
    await processAiWorkerJob(options, api, registration.id, worker);
    if (signal !== undefined && signal.aborted) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, pollIntervalMs);
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
}

function rejected(request: AgentRequest, error: unknown): AgentResult { return { requestId: request.requestId, protocolVersion: request.protocolVersion, status: 'rejected', findings: [{ type: 'policy', severity: 'error', source: { file: request.repository.url }, message: error instanceof Error ? error.message : String(error) }] }; }

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const cwd = process.env['WORKER_REPOSITORY'] ?? process.cwd();
  if (process.env['OPENTESTPILOT_WORKER_ENABLED'] !== 'true') throw new Error('set OPENTESTPILOT_WORKER_ENABLED=true to start the Claude Code worker');
  if (process.env['OPENTESTPILOT_WORKER_MODE'] === 'daemon') {
    const baseUrl = process.env['OPENTESTPILOT_URL'] ?? 'http://127.0.0.1:3001';
    const organizationId = process.env['OPENTESTPILOT_ORGANIZATION_ID'];
    if (organizationId === undefined || organizationId.trim() === '') throw new Error('OPENTESTPILOT_ORGANIZATION_ID is required for daemon mode');
    const workerName = process.env['OPENTESTPILOT_WORKER_NAME'] ?? 'opentestpilot-ai-worker';
    const policy = process.env['OPENTESTPILOT_WORKER_POLICY_JSON'] === undefined ? defaultWorkerPolicy : JSON.parse(process.env['OPENTESTPILOT_WORKER_POLICY_JSON']) as WorkerPolicy;
    const agent = process.env['OPENTESTPILOT_AGENT'] ?? 'codex';
    const worker = agent === 'claude' ? new ClaudeCodeWorker({ cwd, policy }) : new CodexCodeWorker({ cwd, policy });
    const abortController = new AbortController();
    process.once('SIGTERM', () => abortController.abort());
    process.once('SIGINT', () => abortController.abort());
    const sessionToken = process.env['OPENTESTPILOT_SESSION_TOKEN'];
    const gitToken = process.env['OPENTESTPILOT_GIT_TOKEN'];
    await runAiWorkerDaemon({ baseUrl, organizationId, name: workerName, rootDirectory: cwd, policy, worker, ...(sessionToken === undefined ? {} : { sessionToken }), ...(gitToken === undefined ? {} : { gitToken }), pollIntervalMs: Number(process.env['OPENTESTPILOT_WORKER_POLL_MS'] ?? 5_000) }, abortController.signal);
  } else {
    const worker = new ClaudeCodeWorker({ cwd });
    process.stdin.setEncoding('utf8');
    let buffer = '';
    process.stdin.on('data', async (chunk) => { buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; for (const line of lines.filter(Boolean)) process.stdout.write(`${JSON.stringify(await worker.handle(JSON.parse(line) as AgentRequest))}\n`); });
  }
}
