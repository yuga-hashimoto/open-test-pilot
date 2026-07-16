import type { Capabilities, Job } from '@open-test-pilot/runner-protocol';
import { executeInDocker, type DockerExecutorOptions } from './executor.js';

export interface RunnerClient {
  register(name: string, capabilities: Capabilities): Promise<{ runnerId: string }>;
  heartbeat(runnerId: string): Promise<void>;
  lease(runnerId: string): Promise<Job | undefined>;
  complete(jobId: string, status: 'passed' | 'failed' | 'cancelled'): Promise<void>;
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
    async complete(jobId, status) {
      const response = await fetch(`${baseUrl}/v1/jobs/${jobId}/complete`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ status }) });
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
  once?: boolean;
}

export async function runRunnerLoop(client: RunnerClient, options: RunnerLoopOptions): Promise<void> {
  const registration = await client.register(options.name, options.capabilities);
  do {
    await client.heartbeat(registration.runnerId);
    const job = await client.lease(registration.runnerId);
    if (job !== undefined) {
      const result = await executeInDocker(job, options.docker);
      await client.uploadArtifact(job.runId, { key: 'runner/stdout.log', contentType: 'text/plain', body: Buffer.from(result.stdout) });
      await client.uploadArtifact(job.runId, { key: 'runner/stderr.log', contentType: 'text/plain', body: Buffer.from(result.stderr) });
      await client.complete(job.jobId, result.exitCode === 0 ? 'passed' : 'failed');
    }
    if (options.once === true) return;
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? 2_000));
  } while (true);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const baseUrl = process.env['OPENTESTPILOT_URL'] ?? 'http://127.0.0.1:3001';
  const organizationId = process.env['OPENTESTPILOT_ORGANIZATION_ID'];
  if (organizationId === undefined) throw new Error('OPENTESTPILOT_ORGANIZATION_ID is required');
  await runRunnerLoop(createRunnerClient(baseUrl, organizationId), { name: process.env['RUNNER_NAME'] ?? 'self-hosted-runner', capabilities: { browsers: ['chromium'], maxConcurrency: 1, labels: (process.env['RUNNER_LABELS'] ?? 'linux').split(',') }, docker: { image: process.env['RUNNER_IMAGE'] ?? 'ghcr.io/open-test-pilot/runner:latest', memoryMb: 1024, cpus: 1 } });
}
