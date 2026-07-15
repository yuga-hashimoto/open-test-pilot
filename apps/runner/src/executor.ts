import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Job } from '@open-test-pilot/runner-protocol';

const execFileAsync = promisify(execFile);

export interface DockerExecutorOptions {
  image: string;
  memoryMb?: number;
  cpus?: number;
  timeoutMs?: number;
  network?: 'none' | 'bridge';
}

export interface ExecutionResult { exitCode: number; stdout: string; stderr: string; }

/** Builds a deny-by-default Docker invocation for shared Runner jobs. */
export function buildDockerArgs(job: Job, options: DockerExecutorOptions): string[] {
  if (job.executionMode !== undefined && job.executionMode !== 'docker') throw new Error(`shared executor cannot run mode ${job.executionMode}`);
  if (options.network !== undefined && options.network !== 'none') throw new Error('shared executor permits only network=none');
  if (!options.image.includes(':')) throw new Error('container image must use an explicit tag');
  const args = ['run', '--rm', '--read-only', '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--tmpfs=/tmp:rw,noexec,nosuid,size=256m'];
  if (options.memoryMb !== undefined) args.push(`--memory=${options.memoryMb}m`);
  if (options.cpus !== undefined) args.push(`--cpus=${options.cpus}`);
  args.push(options.image, 'testpilot-runner', '--job-id', job.jobId);
  return args;
}

export async function executeInDocker(job: Job, options: DockerExecutorOptions): Promise<ExecutionResult> {
  const args = buildDockerArgs(job, options);
  try {
    const result = await execFileAsync('docker', args, { timeout: options.timeoutMs ?? job.timeout ?? 300_000, maxBuffer: 10 * 1024 * 1024 });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; killed?: boolean };
    return { exitCode: typeof failure.code === 'number' ? failure.code : failure.killed ? 124 : 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? String(error) };
  }
}
