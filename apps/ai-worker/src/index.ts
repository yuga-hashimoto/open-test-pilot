import { spawn } from 'node:child_process';
import { AgentProtocolVersion, validateAgentResult, type AgentRequest, type AgentResult } from '@open-test-pilot/agent-protocol';

interface CommandOutput { stdout: string; stderr: string; }

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
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

function rejected(request: AgentRequest, error: unknown): AgentResult { return { requestId: request.requestId, protocolVersion: request.protocolVersion, status: 'rejected', findings: [{ type: 'policy', severity: 'error', source: { file: request.repository.url }, message: error instanceof Error ? error.message : String(error) }] }; }

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const cwd = process.env['WORKER_REPOSITORY'] ?? process.cwd();
  if (process.env['OPENTESTPILOT_WORKER_ENABLED'] !== 'true') throw new Error('set OPENTESTPILOT_WORKER_ENABLED=true to start the Claude Code worker');
  const worker = new ClaudeCodeWorker({ cwd });
  process.stdin.setEncoding('utf8');
  let buffer = '';
  process.stdin.on('data', async (chunk) => { buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; for (const line of lines.filter(Boolean)) process.stdout.write(`${JSON.stringify(await worker.handle(JSON.parse(line) as AgentRequest))}\n`); });
}
