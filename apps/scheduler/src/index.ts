import { cronMatches } from '@open-test-pilot/trigger-adapter';

export interface ScheduledItem { id: string; cron: string; enabled: boolean; }
export interface ScheduleDaemonOptions {
  baseUrl: string;
  organizationIds: readonly string[];
  sessionToken?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  onTrigger?: (scheduleId: string, runId: string) => void;
}

export class ScheduleDaemon {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly triggered = new Map<string, string>();
  private readonly baseUrl: string;

  constructor(private readonly options: ScheduleDaemonOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  async pollOnce(): Promise<Array<{ organizationId: string; scheduleId: string; runId: string }>> {
    const current = this.now();
    const minuteKey = `${current.getFullYear()}-${current.getMonth()}-${current.getDate()}-${current.getHours()}-${current.getMinutes()}`;
    const triggered: Array<{ organizationId: string; scheduleId: string; runId: string }> = [];
    for (const organizationId of this.options.organizationIds) {
      const schedules = await this.request<{ schedules: ScheduledItem[] }>(`/v1/organizations/${encodeURIComponent(organizationId)}/schedules`, organizationId);
      for (const schedule of schedules.schedules) {
        const key = `${organizationId}:${schedule.id}`;
        if (!schedule.enabled || this.triggered.get(key) === minuteKey || !cronMatches(current, schedule.cron)) continue;
        const result = await this.request<{ scheduleId: string; runId: string; status: string; trigger: 'schedule' }>(`/v1/schedules/${encodeURIComponent(schedule.id)}/trigger`, organizationId, { method: 'POST' });
        this.triggered.set(key, minuteKey);
        const event = { organizationId, scheduleId: result.scheduleId, runId: result.runId };
        triggered.push(event);
        this.options.onTrigger?.(event.scheduleId, event.runId);
      }
    }
    return triggered;
  }

  private async request<T>(path: string, organizationId: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers: { accept: 'application/json', 'x-organization-id': organizationId, ...(this.options.sessionToken === undefined ? {} : { authorization: `Bearer ${this.options.sessionToken}` }), ...(init.headers ?? {}) } });
    const text = await response.text();
    if (!response.ok) throw new Error(`schedule daemon request failed ${response.status}: ${text}`);
    return JSON.parse(text) as T;
  }
}

export async function runScheduleDaemon(options: ScheduleDaemonOptions & { intervalMs?: number }): Promise<never> {
  const daemon = new ScheduleDaemon(options);
  const intervalMs = options.intervalMs ?? 60_000;
  const poll = async () => { try { const events = await daemon.pollOnce(); for (const event of events) console.log(JSON.stringify({ event: 'schedule.triggered', ...event })); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); } };
  await poll();
  setInterval(() => { void poll(); }, intervalMs);
  return await new Promise<never>(() => undefined);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const baseUrl = process.env['OPENTESTPILOT_URL'];
  const organizationIds = process.env['OPENTESTPILOT_ORGANIZATION_IDS']?.split(',').map((value) => value.trim()).filter(Boolean);
  if (baseUrl === undefined || organizationIds === undefined || organizationIds.length === 0) throw new Error('set OPENTESTPILOT_URL and OPENTESTPILOT_ORGANIZATION_IDS');
  await runScheduleDaemon({ baseUrl, organizationIds, ...(process.env['OPENTESTPILOT_SESSION_TOKEN'] === undefined ? {} : { sessionToken: process.env['OPENTESTPILOT_SESSION_TOKEN'] }), intervalMs: Number(process.env['OPENTESTPILOT_SCHEDULE_INTERVAL_MS'] ?? 60_000) });
}
