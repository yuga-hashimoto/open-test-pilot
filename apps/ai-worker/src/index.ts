import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentRequest, AgentResult } from '@open-test-pilot/agent-protocol';

const execFileAsync = promisify(execFile);

export interface WorkerPolicy { allowedOperations: Array<AgentRequest['operation']>; maxRetries: number; allowPublish: boolean; }
export const defaultWorkerPolicy: WorkerPolicy = { allowedOperations: ['analyze', 'analyze-failure', 'repair', 'review'], maxRetries: 2, allowPublish: false };

export function validateWorkerRequest(request: AgentRequest, policy: WorkerPolicy = defaultWorkerPolicy): void {
  if (!policy.allowedOperations.includes(request.operation)) throw new Error(`operation ${request.operation} is not allowed for this worker`);
  if (request.operation === 'publish' && !policy.allowPublish) throw new Error('publish requires explicit worker policy');
  if ((request.constraints?.maxRetries ?? 0) > policy.maxRetries) throw new Error('request exceeds worker retry policy');
  if (request.operation === 'repair' && request.constraints?.forbidAppCodeChanges !== true) throw new Error('repair requires forbidAppCodeChanges=true');
}

export interface ClaudeCodeWorkerOptions { command?: string; cwd: string; timeoutMs?: number; policy?: WorkerPolicy; }

export class ClaudeCodeWorker {
  private readonly policy: WorkerPolicy;
  constructor(private readonly options: ClaudeCodeWorkerOptions) { this.policy = options.policy ?? defaultWorkerPolicy; }

  async handle(request: AgentRequest): Promise<AgentResult> {
    try { validateWorkerRequest(request, this.policy); } catch (error) { return rejected(request, error); }
    const prompt = JSON.stringify({ operation: request.operation, repository: request.repository, constraints: request.constraints, artifacts: request.requestArtifacts });
    try {
      const result = await execFileAsync(this.options.command ?? 'claude', ['--print', prompt], { cwd: this.options.cwd, timeout: this.options.timeoutMs ?? 300_000, maxBuffer: 4 * 1024 * 1024 });
      return { requestId: request.requestId, protocolVersion: request.protocolVersion, status: 'completed', findings: [{ type: 'worker-output', severity: 'info', source: { file: request.repository.url }, message: result.stdout.trim().slice(0, 20_000) }] };
    } catch (error) {
      return { requestId: request.requestId, protocolVersion: request.protocolVersion, status: 'failed', findings: [{ type: 'worker-error', severity: 'error', source: { file: request.repository.url }, message: error instanceof Error ? error.message : String(error) }] };
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
