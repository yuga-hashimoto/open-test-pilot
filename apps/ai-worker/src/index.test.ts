import { describe, expect, it } from 'vitest';
import { CodexCodeWorker, defaultWorkerPolicy, parseStructuredAgentResult, validateWorkerRequest } from './index.js';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentRequest } from '@open-test-pilot/agent-protocol';

const request = (operation: AgentRequest['operation'], constraints?: AgentRequest['constraints']): AgentRequest => ({ requestId: 'request-1', protocolVersion: '1.0.0', operation, repository: { url: 'file:///repo', branch: 'main', commit: 'abc' }, ...(constraints === undefined ? {} : { constraints }) });

describe('AI Worker safety policy', () => {
  it('allows analysis and requires explicit no-app-change repair constraints', () => {
    expect(() => validateWorkerRequest(request('analyze'))).not.toThrow();
    expect(() => validateWorkerRequest(request('repair', { forbidAppCodeChanges: true }))).not.toThrow();
    expect(() => validateWorkerRequest(request('repair'))).toThrow('forbidAppCodeChanges');
  });

  it('rejects publish and excessive retry requests by default', () => {
    expect(() => validateWorkerRequest(request('publish'))).toThrow('not allowed');
    expect(() => validateWorkerRequest(request('repair', { forbidAppCodeChanges: true, maxRetries: defaultWorkerPolicy.maxRetries + 1 }))).toThrow('retry policy');
  });

  it('parses structured AgentResult from direct JSON and Codex JSONL envelopes', () => {
    const req = request('analyze');
    const result = parseStructuredAgentResult(req, JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ requestId: req.requestId, protocolVersion: '1.0.0', status: 'completed', findings: [{ type: 'route', severity: 'info', source: { file: 'app/page.tsx' }, message: 'route found' }] }) } }));
    expect(result.findings[0]?.type).toBe('route');
  });

  it('executes a Codex-compatible CLI and requires correlated structured output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'open-test-pilot-codex-worker-'));
    const command = join(directory, 'agent.mjs');
    await writeFile(command, '#!/usr/bin/env node\nconst prompt = process.argv.at(-1);\nconst requestId = JSON.parse(prompt.split("\\n").at(-1)).requestId;\nconsole.log(JSON.stringify({ requestId, protocolVersion: "1.0.0", status: "completed", findings: [{ type: "codex-analysis", severity: "info", source: { file: "app/page.tsx" }, message: "verified" }] }));\n', 'utf8');
    await chmod(command, 0o755);
    const worker = new CodexCodeWorker({ cwd: directory, command, args: [] });
    const result = await worker.handle(request('analyze'));
    expect(result.status).toBe('completed');
    expect(result.findings[0]?.type).toBe('codex-analysis');
  });
});
