import { describe, expect, it, vi } from 'vitest';
import { createRunnerClient } from './index.js';

describe('createRunnerClient', () => {
  it('does not send an empty JSON body for heartbeat', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ runnerId: 'runner-1', heartbeatAt: new Date().toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await createRunnerClient('http://runner.test', 'org-1').heartbeat('runner-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://runner.test/v1/runners/runner-1/heartbeat',
      expect.objectContaining({ method: 'POST', headers: { accept: 'application/json', 'x-organization-id': 'org-1' } }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');
  });
});
