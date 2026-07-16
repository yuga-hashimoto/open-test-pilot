import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Job } from '@open-test-pilot/runner-protocol';
import type { TestRunResult } from '@open-test-pilot/result-schema';
import type { SerializedJobArtifact } from './job-executor.js';

const execFileAsync = promisify(execFile);

export interface DockerExecutorOptions {
  image: string;
  memoryMb?: number;
  cpus?: number;
  timeoutMs?: number;
  network?: 'none' | 'bridge';
  jobPayloadBase64?: string;
}

export interface ExecutionResult { exitCode: number; stdout: string; stderr: string; result?: TestRunResult; artifacts?: SerializedJobArtifact[]; }

function resolveNetworkMode(job: Job): 'none' | 'bridge' {
  const manifest = job.manifestDocument as { permissions?: { networkAccess?: unknown } } | undefined;
  if (manifest?.permissions?.networkAccess === true) return 'bridge';
  return 'none';
}

/** Builds a deny-by-default Docker invocation whose network mode is derived from the manifest's explicit opt-in. */
export function buildDockerArgs(job: Job, options: DockerExecutorOptions): string[] {
  if (job.executionMode !== undefined && job.executionMode !== 'docker') throw new Error(`shared executor cannot run mode ${job.executionMode}`);
  if (!options.image.includes(':')) throw new Error('container image must use an explicit tag');
  const networkMode = resolveNetworkMode(job);
  if (options.network !== undefined && options.network !== networkMode) throw new Error(`manifest permits only network=${networkMode}`);
  const args = ['run', '--rm', '--read-only', `--network=${networkMode}`, '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--tmpfs=/tmp:rw,noexec,nosuid,size=256m'];
  if (options.memoryMb !== undefined) args.push(`--memory=${options.memoryMb}m`);
  if (options.cpus !== undefined) args.push(`--cpus=${options.cpus}`);
  args.push(options.image, 'testpilot-runner', '--job-id', job.jobId);
  if (options.jobPayloadBase64 !== undefined) args.push('--job-json-base64', options.jobPayloadBase64);
  return args;
}

export async function executeInDocker(job: Job, options: DockerExecutorOptions): Promise<ExecutionResult> {
  const args = buildDockerArgs(job, { ...options, jobPayloadBase64: Buffer.from(JSON.stringify(job)).toString('base64') });
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    const result = await execFileAsync('docker', args, { timeout: options.timeoutMs ?? job.timeout ?? 300_000, maxBuffer: 10 * 1024 * 1024 });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; killed?: boolean };
    exitCode = typeof failure.code === 'number' ? failure.code : failure.killed ? 124 : 1;
    stdout = failure.stdout ?? '';
    stderr = failure.stderr ?? String(error);
  }
  const payload = parseContainerOutput(stdout);
  return { exitCode, stdout, stderr, ...(payload === undefined ? {} : { result: payload.result, artifacts: payload.artifacts }) };
}

function parseContainerOutput(stdout: string): { result: TestRunResult; artifacts: SerializedJobArtifact[] } | undefined {
  const line = stdout.trim().split('\n').filter(Boolean).at(-1);
  if (line === undefined) return undefined;
  try {
    const payload = JSON.parse(line) as { result?: TestRunResult; artifacts?: SerializedJobArtifact[] };
    return payload.result === undefined || !Array.isArray(payload.artifacts) ? undefined : { result: payload.result, artifacts: payload.artifacts };
  } catch {
    return undefined;
  }
}
