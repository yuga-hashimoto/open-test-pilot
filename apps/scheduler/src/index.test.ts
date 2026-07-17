import { describe, expect, it } from 'vitest';
import { ScheduleDaemon } from './index.js';

describe('schedule daemon', () => {
  it('triggers a due schedule once per minute and preserves tenant headers', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const daemon = new ScheduleDaemon({
      baseUrl: 'http://server.test',
      organizationIds: ['org-1'],
      now: () => new Date(2026, 6, 17, 9, 30),
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
        const body = String(input).includes('/schedules') && init?.method !== 'POST'
          ? { schedules: [{ id: 'schedule-1', cron: '*/15 * * * *', enabled: true }] }
          : { scheduleId: 'schedule-1', runId: 'run-1', status: 'queued', trigger: 'schedule' };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    expect(await daemon.pollOnce()).toEqual([{ organizationId: 'org-1', scheduleId: 'schedule-1', runId: 'run-1' }]);
    expect(await daemon.pollOnce()).toEqual([]);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.init?.headers).toMatchObject({ 'x-organization-id': 'org-1' });
  });
});
