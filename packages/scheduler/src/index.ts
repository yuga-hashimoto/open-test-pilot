import type { Capabilities, Job } from '@open-test-pilot/runner-protocol';

interface Lease {
  job: Job;
  runnerId: string;
  expiresAt: number;
}

export interface SchedulerOptions {
  leaseDurationMs?: number;
}

export interface RunnerCapabilities extends Capabilities {
  runnerId: string;
  labels?: string[];
}

export class Scheduler {
  private readonly queued = new Map<string, Job>();
  private readonly leases = new Map<string, Lease>();
  private readonly leaseDurationMs: number;

  public constructor(options: SchedulerOptions = {}) {
    this.leaseDurationMs = options.leaseDurationMs ?? 60_000;
  }

  public get size(): number { return this.queued.size; }

  public enqueue(job: Job): boolean {
    if (this.queued.has(job.jobId) || this.leases.has(job.jobId)) return false;
    this.queued.set(job.jobId, { ...job, status: 'queued' });
    return true;
  }

  public leaseNext(runner: RunnerCapabilities, now = Date.now()): Job | undefined {
    const compatible = [...this.queued.values()]
      .filter((job) => this.isCompatible(job, runner))
      .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.createdAt.localeCompare(right.createdAt));
    const job = compatible[0];
    if (job === undefined) return undefined;
    this.queued.delete(job.jobId);
    const leased = { ...job, status: 'leased' as const };
    this.leases.set(job.jobId, { job: leased, runnerId: runner.runnerId, expiresAt: now + this.leaseDurationMs });
    return leased;
  }

  public complete(jobId: string, status: Extract<Job['status'], 'passed' | 'failed' | 'cancelled'>): Job | undefined {
    const lease = this.leases.get(jobId);
    if (lease === undefined) return undefined;
    this.leases.delete(jobId);
    return { ...lease.job, status };
  }

  public getLeasedJob(jobId: string): Job | undefined {
    return this.leases.get(jobId)?.job;
  }

  public expireLeases(now = Date.now()): string[] {
    const expired: string[] = [];
    for (const [jobId, lease] of this.leases) {
      if (lease.expiresAt <= now) {
        this.leases.delete(jobId);
        this.queued.set(jobId, { ...lease.job, status: 'queued' });
        expired.push(jobId);
      }
    }
    return expired;
  }

  private isCompatible(job: Job, runner: RunnerCapabilities): boolean {
    const requestedBrowsers = job.requestedCapabilities.browsers;
    if (requestedBrowsers.some((browser) => !runner.browsers.includes(browser))) return false;
    const requiredLabels = job.requiredLabels ?? [];
    return requiredLabels.every((label) => runner.labels?.includes(label) === true);
  }
}
