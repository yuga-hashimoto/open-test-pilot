import { describe, expect, it } from 'vitest';
import { githubCheckPayload, GitHubNotificationAdapter, MemoryNotificationAdapter } from './index.js';

describe('notification adapters', () => {
  it('stores notifications and maps result status to GitHub Checks', async () => {
    const adapter = new MemoryNotificationAdapter();
    await adapter.send({ organizationId: 'org-1', runId: 'run-1', status: 'failed', title: 'Login failed' });
    expect(adapter.sent).toHaveLength(1);
    expect(githubCheckPayload(adapter.sent[0] ?? { organizationId: '', runId: '', status: 'passed', title: '' })).toMatchObject({ conclusion: 'failure', status: 'completed' });
  });

  it('publishes failed runs to GitHub Checks, Status, and an issue comment', async () => {
    const calls: string[] = [];
    const adapter = new GitHubNotificationAdapter({ async createCheckRun() { calls.push('check'); return { id: 1 }; }, async createCommitStatus() { calls.push('status'); }, async createIssueComment() { calls.push('comment'); return { id: 2 }; } }, 'org', 'repo');
    await adapter.send({ organizationId: 'org-1', runId: 'run-1', status: 'failed', title: 'Login failed', headSha: 'sha-1', issueNumber: 3 });
    expect(calls).toEqual(['check', 'status', 'comment']);
  });
});
