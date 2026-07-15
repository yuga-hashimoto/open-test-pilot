import { describe, expect, it } from 'vitest';
import { publishRepairProposal, type RepairPublisher } from './repair.js';

describe('AI repair publisher', () => {
  it('creates a draft PR containing only a YAML manifest proposal', async () => {
    const calls: string[] = [];
    const publisher: RepairPublisher = { async createBranch(owner, repository, branch) { calls.push(`branch:${owner}/${repository}:${branch}`); }, async commitFile(owner, repository, input) { calls.push(`commit:${owner}/${repository}:${input.path}`); return { commitSha: 'commit-1' }; }, async createPullRequest(owner, repository, input) { calls.push(`pr:${owner}/${repository}:${input.head}`); return { number: 4, htmlUrl: 'https://github.com/org/repo/pull/4', head: input.head, base: input.base }; } };
    const result = await publishRepairProposal(publisher, { request: { requestId: 'req-1', protocolVersion: '1.0.0', operation: 'repair', repository: { url: 'https://github.com/org/repo', branch: 'main', commit: 'base-1' }, constraints: { forbidAppCodeChanges: true } }, manifestPath: 'tests/login.yaml', manifestContent: 'name: Login\n', baseBranch: 'main', baseSha: 'base-1', title: 'Repair login', body: 'Generated proposal' });
    expect(result.pullRequest.number).toBe(4);
    expect(calls).toEqual(['branch:org/repo:testpilot/repair/req-1', 'commit:org/repo:tests/login.yaml', 'pr:org/repo:testpilot/repair/req-1']);
  });

  it('rejects product-code targets and unrestricted repairs', async () => {
    const publisher = {} as RepairPublisher;
    const base = { request: { requestId: 'req-1', protocolVersion: '1.0.0' as const, operation: 'repair' as const, repository: { url: 'https://github.com/org/repo', branch: 'main', commit: 'base-1' } }, manifestPath: 'src/app.ts', manifestContent: 'bad', baseBranch: 'main', baseSha: 'base-1', title: 'Repair', body: '' };
    await expect(publishRepairProposal(publisher, base)).rejects.toThrow('forbidAppCodeChanges');
  });
});
