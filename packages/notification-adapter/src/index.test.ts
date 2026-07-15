import { describe, expect, it } from 'vitest';
import { githubCheckPayload, MemoryNotificationAdapter } from './index.js';

describe('notification adapters', () => {
  it('stores notifications and maps result status to GitHub Checks', async () => {
    const adapter = new MemoryNotificationAdapter();
    await adapter.send({ organizationId: 'org-1', runId: 'run-1', status: 'failed', title: 'Login failed' });
    expect(adapter.sent).toHaveLength(1);
    expect(githubCheckPayload(adapter.sent[0] ?? { organizationId: '', runId: '', status: 'passed', title: '' })).toMatchObject({ conclusion: 'failure', status: 'completed' });
  });
});
