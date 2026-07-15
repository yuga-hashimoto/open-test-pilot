export interface Notification { organizationId: string; runId: string; status: 'passed' | 'failed' | 'cancelled'; title: string; url?: string; }

export interface NotificationAdapter { send(notification: Notification): Promise<void>; }

export class MemoryNotificationAdapter implements NotificationAdapter {
  readonly sent: Notification[] = [];
  async send(notification: Notification): Promise<void> { this.sent.push(notification); }
}

export class WebhookNotificationAdapter implements NotificationAdapter {
  constructor(private readonly url: string, private readonly fetcher: typeof fetch = fetch) {}
  async send(notification: Notification): Promise<void> {
    const response = await this.fetcher(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notification) });
    if (!response.ok) throw new Error(`notification webhook failed with ${response.status}`);
  }
}

export function githubCheckPayload(notification: Notification): Record<string, unknown> {
  return { name: 'OpenTestPilot', head_sha: notification.runId, status: 'completed', conclusion: notification.status === 'passed' ? 'success' : notification.status === 'cancelled' ? 'cancelled' : 'failure', output: { title: notification.title, summary: notification.url === undefined ? notification.title : `[Open report](${notification.url})` } };
}
