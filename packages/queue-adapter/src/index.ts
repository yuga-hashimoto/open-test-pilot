import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import type { Capabilities, Job } from '@open-test-pilot/runner-protocol';
import { Scheduler, type RunnerCapabilities } from '@open-test-pilot/scheduler';

export interface RegisteredRunner { runnerId: string; organizationId: string; name: string; capabilities: RunnerCapabilities; heartbeatAt: string; }
export interface ExecutionQueue {
  registerRunner(organizationId: string, name: string, capabilities: Capabilities): Promise<RegisteredRunner>;
  heartbeat(organizationId: string, runnerId: string): Promise<boolean>;
  enqueue(organizationId: string, job: Job): Promise<boolean>;
  lease(organizationId: string, runnerId: string): Promise<Job | undefined>;
  getJob(jobId: string): Promise<Job | undefined>;
  complete(organizationId: string, jobId: string, status: Extract<Job['status'], 'passed' | 'failed' | 'cancelled'>): Promise<Job | undefined>;
  close?(): Promise<void>;
}

export class MemoryExecutionQueue implements ExecutionQueue {
  private readonly schedulers = new Map<string, Scheduler>();
  private readonly runners = new Map<string, RegisteredRunner>();
  private readonly organizations = new Map<string, string>();
  private readonly jobs = new Map<string, Job>();
  constructor(private readonly leaseDurationMs = 60_000) {}
  async registerRunner(organizationId: string, name: string, capabilities: Capabilities): Promise<RegisteredRunner> {
    const runnerId = `runner-${randomUUID()}`;
    const runner = { runnerId, organizationId, name, capabilities: { ...capabilities, runnerId }, heartbeatAt: new Date().toISOString() };
    this.runners.set(runnerId, runner); this.organizations.set(runnerId, organizationId); return runner;
  }
  async heartbeat(organizationId: string, runnerId: string): Promise<boolean> { const runner = this.runners.get(runnerId); if (runner?.organizationId !== organizationId) return false; runner.heartbeatAt = new Date().toISOString(); return true; }
  private scheduler(organizationId: string): Scheduler { let scheduler = this.schedulers.get(organizationId); if (scheduler === undefined) { scheduler = new Scheduler({ leaseDurationMs: this.leaseDurationMs }); this.schedulers.set(organizationId, scheduler); } return scheduler; }
  async enqueue(organizationId: string, job: Job): Promise<boolean> { const accepted = job.organizationId === organizationId && this.scheduler(organizationId).enqueue(job); if (accepted) this.jobs.set(job.jobId, job); return accepted; }
  async lease(organizationId: string, runnerId: string): Promise<Job | undefined> { const runner = this.runners.get(runnerId); if (runner?.organizationId !== organizationId) return undefined; this.scheduler(organizationId).expireLeases(); return this.scheduler(organizationId).leaseNext(runner.capabilities); }
  async getJob(jobId: string): Promise<Job | undefined> { for (const scheduler of this.schedulers.values()) { const leased = scheduler.getLeasedJob(jobId); if (leased !== undefined) return leased; } return this.jobs.get(jobId); }
  async complete(organizationId: string, jobId: string, status: Extract<Job['status'], 'passed' | 'failed' | 'cancelled'>): Promise<Job | undefined> {
    const scheduler = this.schedulers.get(organizationId);
    if (scheduler === undefined) return undefined;
    const job = scheduler.getLeasedJob(jobId);
    if (job?.organizationId !== organizationId) return undefined;
    const completed = scheduler.complete(jobId, status);
    if (completed !== undefined) this.jobs.set(jobId, completed);
    return completed;
  }
}

type RedisJson = string | Buffer;
type RedisLike = RedisClientType;

export class RedisExecutionQueue implements ExecutionQueue {
  private readonly client: RedisLike;
  private readonly prefix: string;
  private readonly leaseDurationMs: number;
  private connected = false;
  constructor(url: string, options: { prefix?: string; leaseDurationMs?: number } = {}) { this.client = createClient({ url }); this.prefix = options.prefix ?? 'testpilot'; this.leaseDurationMs = options.leaseDurationMs ?? 60_000; }
  private key(kind: string, id: string): string { return `${this.prefix}:${kind}:${id}`; }
  private async ready(): Promise<RedisLike> { if (!this.connected) { await this.client.connect(); this.connected = true; } return this.client; }
  async registerRunner(organizationId: string, name: string, capabilities: Capabilities): Promise<RegisteredRunner> { const client = await this.ready(); const runnerId = `runner-${randomUUID()}`; const runner = { runnerId, organizationId, name, capabilities: { ...capabilities, runnerId }, heartbeatAt: new Date().toISOString() }; await client.set(this.key('runner', runnerId), JSON.stringify(runner)); await client.sAdd(this.key('org-runners', organizationId), runnerId); return runner; }
  async heartbeat(organizationId: string, runnerId: string): Promise<boolean> { const client = await this.ready(); const raw = await client.get(this.key('runner', runnerId)); if (raw === null) return false; const runner = JSON.parse(raw) as RegisteredRunner; if (runner.organizationId !== organizationId) return false; runner.heartbeatAt = new Date().toISOString(); await client.set(this.key('runner', runnerId), JSON.stringify(runner)); return true; }
  async enqueue(organizationId: string, job: Job): Promise<boolean> { if (job.organizationId !== organizationId) return false; const client = await this.ready(); const key = this.key('job', job.jobId); if (await client.exists(key)) return false; await client.set(key, JSON.stringify({ ...job, status: 'queued' })); const score = Date.parse(job.createdAt) - (job.priority ?? 0) * 1_000_000_000_000; await client.zAdd(this.key('queue', organizationId), { score, value: job.jobId }); return true; }
  async lease(organizationId: string, runnerId: string): Promise<Job | undefined> {
    const client = await this.ready();
    const rawRunner = await client.get(this.key('runner', runnerId));
    if (rawRunner === null) return undefined;
    const runner = JSON.parse(rawRunner) as RegisteredRunner;
    if (runner.organizationId !== organizationId) return undefined;
    const lockKey = this.key('lease-lock', organizationId);
    if (await client.set(lockKey, runnerId, { NX: true, PX: 5_000 }) !== 'OK') return undefined;
    try {
      const now = Date.now();
      const expiredIds = await client.zRangeByScore(this.key('leases', organizationId), 0, now);
      for (const expiredId of expiredIds) {
        const raw = await client.get(this.key('job', expiredId));
        await client.zRem(this.key('leases', organizationId), expiredId);
        if (raw === null) continue;
        const job = JSON.parse(raw) as Job & { leaseExpiresAt?: number; leaseRunnerId?: string };
        if (job.status === 'leased' && job.leaseExpiresAt !== undefined && job.leaseExpiresAt <= now) {
          delete job.leaseRunnerId;
          delete job.leaseExpiresAt;
          await client.set(this.key('job', expiredId), JSON.stringify({ ...job, status: 'queued' }));
          const score = Date.parse(job.createdAt) - (job.priority ?? 0) * 1_000_000_000_000;
          await client.zAdd(this.key('queue', organizationId), { score, value: expiredId });
        }
      }
      const ids = await client.zRange(this.key('queue', organizationId), 0, 50);
      for (const jobId of ids) {
        const raw = await client.get(this.key('job', jobId));
        if (raw === null) { await client.zRem(this.key('queue', organizationId), jobId); continue; }
        const job = JSON.parse(raw) as Job & { leaseExpiresAt?: number; leaseRunnerId?: string };
        if (job.status !== 'queued' || !compatible(job, runner.capabilities)) continue;
        await client.zRem(this.key('queue', organizationId), jobId);
        const leased = { ...job, status: 'leased' as const, leaseRunnerId: runnerId, leaseExpiresAt: now + this.leaseDurationMs };
        await client.set(this.key('job', jobId), JSON.stringify(leased));
        await client.zAdd(this.key('leases', organizationId), { score: leased.leaseExpiresAt, value: jobId });
        return leased;
      }
      return undefined;
    } finally {
      await client.del(lockKey);
    }
  }
  async getJob(jobId: string): Promise<Job | undefined> { const client = await this.ready(); const raw = await client.get(this.key('job', jobId)); return raw === null ? undefined : JSON.parse(raw) as Job; }
  async complete(organizationId: string, jobId: string, status: Extract<Job['status'], 'passed' | 'failed' | 'cancelled'>): Promise<Job | undefined> { const client = await this.ready(); const raw = await client.get(this.key('job', jobId)); if (raw === null) return undefined; const job = JSON.parse(raw) as Job & { leaseRunnerId?: string; leaseExpiresAt?: number }; if (job.organizationId !== organizationId || job.status !== 'leased') return undefined; const completed = { ...job, status }; delete completed.leaseRunnerId; delete completed.leaseExpiresAt; await client.zRem(this.key('leases', organizationId), jobId); await client.set(this.key('job', jobId), JSON.stringify(completed)); return completed; }
  async close(): Promise<void> { if (this.connected) await this.client.quit(); this.connected = false; }
}

function compatible(job: Job, runner: RunnerCapabilities): boolean { return job.requestedCapabilities.browsers.every((browser) => runner.browsers.includes(browser)) && (job.requiredLabels ?? []).every((label) => runner.labels?.includes(label) === true); }
