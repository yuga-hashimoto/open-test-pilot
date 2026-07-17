import type { Capabilities, Job } from '@open-test-pilot/runner-protocol';
import { executeInDocker, type DockerExecutorOptions, type ExecutionResult } from './executor.js';
import { executeJobPayload } from './job-executor.js';

export interface RunnerClient {
  register(name: string, capabilities: Capabilities): Promise<{ runnerId: string }>;
  heartbeat(runnerId: string): Promise<void>;
  lease(runnerId: string): Promise<Job | undefined>;
  complete(jobId: string, status: 'passed' | 'failed' | 'cancelled', result?: Record<string, unknown>): Promise<void>;
  uploadArtifact(runId: string, input: { key: string; contentType: string; body: Uint8Array }): Promise<{ artifactId: string }>;
}

export function createRunnerClient(baseUrl: string, organizationId: string): RunnerClient {
  const headers = { accept: 'application/json', 'x-organization-id': organizationId };
  const jsonHeaders = { ...headers, 'content-type': 'application/json' };
  return {
    async register(name, capabilities) {
      const response = await fetch(`${baseUrl}/v1/organizations/${organizationId}/runners`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name, capabilities }) });
      if (!response.ok) throw new Error(`runner registration failed with ${response.status}`);
      return await response.json() as { runnerId: string };
    },
    async heartbeat(runnerId) {
      const response = await fetch(`${baseUrl}/v1/runners/${runnerId}/heartbeat`, { method: 'POST', headers });
      if (!response.ok) throw new Error(`runner heartbeat failed with ${response.status}`);
    },
    async lease(runnerId) {
      const response = await fetch(`${baseUrl}/v1/runners/${runnerId}/lease`, { method: 'POST', headers });
      if (!response.ok) throw new Error(`runner lease failed with ${response.status}`);
      const body = await response.json() as { job: Job | null };
      return body.job ?? undefined;
    },
    async complete(jobId, status, result) {
      const response = await fetch(`${baseUrl}/v1/jobs/${jobId}/complete`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ status, ...(result === undefined ? {} : { result }) }) });
      if (!response.ok) throw new Error(`job completion failed with ${response.status}`);
    },
    async uploadArtifact(runId, input) {
      const response = await fetch(`${baseUrl}/v1/runs/${runId}/artifacts`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ key: input.key, contentType: input.contentType, bodyBase64: Buffer.from(input.body).toString('base64') }) });
      if (!response.ok) throw new Error(`artifact upload failed with ${response.status}`);
      const artifact = await response.json() as { id: string };
      return { artifactId: artifact.id };
    },
  };
}

export interface RunnerLoopOptions {
  name: string;
  capabilities: Capabilities;
  pollIntervalMs?: number;
  docker: DockerExecutorOptions;
  heartbeatIntervalMs?: number;
  once?: boolean;
}

export async function runJobWithHeartbeat(client: RunnerClient, runnerId: string, job: Job, heartbeatIntervalMs: number, execute: (job: Job) => Promise<ExecutionResult>): Promise<ExecutionResult> {
  void client.heartbeat(runnerId).catch(() => undefined);
  const timer = setInterval(() => { void client.heartbeat(runnerId).catch(() => undefined); }, Math.max(1, heartbeatIntervalMs));
  try {
    return await execute(job);
  } finally {
    clearInterval(timer);
  }
}

export async function runRunnerLoop(client: RunnerClient, options: RunnerLoopOptions): Promise<void> {
  const registration = await client.register(options.name, options.capabilities);
  do {
    await client.heartbeat(registration.runnerId);
    const job = await client.lease(registration.runnerId);
    if (job !== undefined) {
      const result = await runJobWithHeartbeat(client, registration.runnerId, job, options.heartbeatIntervalMs ?? 10_000, (leasedJob) => executeInDocker(leasedJob, options.docker));
      await client.uploadArtifact(job.runId, { key: 'runner/stdout.log', contentType: 'text/plain', body: Buffer.from(result.stdout) });
      await client.uploadArtifact(job.runId, { key: 'runner/stderr.log', contentType: 'text/plain', body: Buffer.from(result.stderr) });
      for (const artifact of result.artifacts ?? []) await client.uploadArtifact(job.runId, { key: artifact.key, contentType: artifact.contentType, body: Buffer.from(artifact.bodyBase64, 'base64') });
      const completionResult = result.result === undefined ? undefined : { ...result.result, failures: result.result.steps.flatMap((step) => step.actions.filter((action) => action.status === 'failed').map((action) => ({ stepId: step.stepId, actionId: action.actionId, message: action.error?.message ?? 'action failed', category: action.error?.category ?? 'UNKNOWN' }))) };
      await client.complete(job.jobId, result.exitCode === 0 ? 'passed' : 'failed', completionResult);
    }
    if (options.once === true) return;
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? 2_000));
  } while (true);
}

async function main(): Promise<void> {
  const jobJsonIndex = process.argv.indexOf('--job-json-base64');
  if (jobJsonIndex >= 0) {
    const encoded = process.argv[jobJsonIndex + 1];
    if (encoded === undefined) throw new Error('--job-json-base64 requires a value');
    const job = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Job;
    try {
      const output = await executeJobPayload(job);
      process.stdout.write(`${JSON.stringify(output)}\n`);
      process.exitCode = output.result.status === 'passed' ? 0 : 1;
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
      process.exitCode = 1;
    }
    return;
  }
  const baseUrl = process.env['OPENTESTPILOT_URL'] ?? 'http://127.0.0.1:3001';
  const organizationId = process.env['OPENTESTPILOT_ORGANIZATION_ID'];
  if (organizationId === undefined) throw new Error('OPENTESTPILOT_ORGANIZATION_ID is required');
  await runRunnerLoop(createRunnerClient(baseUrl, organizationId), { name: process.env['RUNNER_NAME'] ?? 'self-hosted-runner', capabilities: { browsers: ['chromium'], maxConcurrency: 1, labels: (process.env['RUNNER_LABELS'] ?? 'linux').split(',') }, docker: { image: process.env['RUNNER_IMAGE'] ?? 'ghcr.io/open-test-pilot/runner:latest', memoryMb: 1024, cpus: 1 } });
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
