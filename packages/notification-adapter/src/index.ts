import type { GitHubApiClient } from '@open-test-pilot/github-adapter';

export interface Notification { organizationId: string; runId: string; status: 'passed' | 'failed' | 'cancelled'; title: string; url?: string; headSha?: string; issueNumber?: number; }

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

export class GitHubNotificationAdapter implements NotificationAdapter {
  constructor(private readonly client: Pick<GitHubApiClient, 'createCheckRun' | 'createCommitStatus' | 'createIssueComment'>, private readonly owner: string, private readonly repository: string) {}
  async send(notification: Notification): Promise<void> {
    if (notification.headSha === undefined) throw new Error('GitHub notification requires headSha');
    const conclusion = notification.status === 'passed' ? 'success' : notification.status === 'cancelled' ? 'cancelled' : 'failure';
    await this.client.createCheckRun(this.owner, this.repository, { name: 'OpenTestPilot', headSha: notification.headSha, status: 'completed', conclusion, title: notification.title, summary: notification.url === undefined ? notification.title : notification.url });
    await this.client.createCommitStatus(this.owner, this.repository, notification.headSha, conclusion === 'success' ? 'success' : conclusion === 'cancelled' ? 'error' : 'failure', notification.title, notification.url);
    if (notification.issueNumber !== undefined && notification.status === 'failed') await this.client.createIssueComment(this.owner, this.repository, notification.issueNumber, `${notification.title}${notification.url === undefined ? '' : `\n\nReport: ${notification.url}`}`);
  }
}

export function githubCheckPayload(notification: Notification): Record<string, unknown> {
  return { name: 'OpenTestPilot', head_sha: notification.runId, status: 'completed', conclusion: notification.status === 'passed' ? 'success' : notification.status === 'cancelled' ? 'cancelled' : 'failure', output: { title: notification.title, summary: notification.url === undefined ? notification.title : `[Open report](${notification.url})` } };
}
