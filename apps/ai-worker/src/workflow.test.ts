import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentRequest, AgentResult } from '@open-test-pilot/agent-protocol';
import type { RepairPublisher } from './repair.js';
import { executeRepairWorkflow, type WorkspaceManager, type WorkerInvoker } from './workflow.js';

const request: AgentRequest = { requestId: 'repair-1', protocolVersion: '1.0.0', operation: 'repair', repository: { url: 'https://github.com/org/repo', branch: 'main', commit: 'base-sha' }, constraints: { forbidAppCodeChanges: true }, requestArtifacts: ['tests/login.yaml'] };
const agentResult: AgentResult = { requestId: request.requestId, protocolVersion: request.protocolVersion, status: 'completed', findings: [], proposedChanges: { manifest: 'name: Repaired\n' }, pullRequestIntent: { title: 'Repair login', branch: 'ignored' } };
const workspace: WorkspaceManager = { async prepare() { return '/tmp/testpilot-ai/repair-1'; } };
const worker: WorkerInvoker = { async handleInDirectory() { return agentResult; } };

function publisher(calls: string[]): RepairPublisher {
  return { async createBranch(_owner, _repo, branch) { calls.push(`branch:${branch}`); }, async commitFile(_owner, _repo, input) { calls.push(`commit:${input.path}`); return { commitSha: 'new-sha' }; }, async createPullRequest(_owner, _repo, input) { calls.push(`pr:${input.head}`); return { number: 1, htmlUrl: 'https://github.com/org/repo/pull/1', head: input.head, base: input.base }; } };
}

describe('AI repair workflow', () => {
  it('prepares, validates, runs, and publishes only when explicitly allowed', async () => {
    const calls: string[] = [];
    const result = await executeRepairWorkflow(request, { rootDirectory: await mkdtemp(join(tmpdir(), 'testpilot-ai-')), workspace, worker, validate: async () => ({ passed: true }), run: async () => ({ passed: true }), policy: { allowedOperations: ['repair'], maxRetries: 2, allowPublish: true }, publisher: publisher(calls) });
    expect(result.published?.pullRequest.number).toBe(1);
    expect(calls).toHaveLength(3);
  });

  it('does not publish when validation fails', async () => {
    const result = await executeRepairWorkflow(request, { rootDirectory: '/tmp/testpilot-ai', workspace, worker, validate: async () => ({ passed: false, message: 'invalid manifest' }), run: async () => ({ passed: true }), policy: { allowedOperations: ['repair'], maxRetries: 2, allowPublish: true }, publisher: publisher([]) });
    expect(result.validation?.passed).toBe(false);
    expect(result.published).toBeUndefined();
  });

  it('does not publish by default even after a successful run', async () => {
    const result = await executeRepairWorkflow(request, { rootDirectory: '/tmp/testpilot-ai', workspace, worker, validate: async () => ({ passed: true }), run: async () => ({ passed: true }), publisher: publisher([]) });
    expect(result.execution?.passed).toBe(true);
    expect(result.published).toBeUndefined();
  });

  it('rejects repair requests without the app-code safety constraint', async () => {
    const unsafeRequest: AgentRequest = { requestId: request.requestId, protocolVersion: request.protocolVersion, operation: request.operation, repository: request.repository, ...(request.requestArtifacts === undefined ? {} : { requestArtifacts: request.requestArtifacts }) };
    await expect(executeRepairWorkflow(unsafeRequest, { rootDirectory: '/tmp/testpilot-ai', workspace, worker, validate: async () => ({ passed: true }), run: async () => ({ passed: true }) })).rejects.toThrow('forbidAppCodeChanges');
  });
});
