import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { AgentRequest, AgentResult } from '@open-test-pilot/agent-protocol';
import type { GitHubPullRequest } from '@open-test-pilot/github-adapter';
import { defaultWorkerPolicy, validateWorkerRequest, type WorkerPolicy } from './index.js';
import { publishRepairProposal, type RepairPublisher } from './repair.js';

const execFileAsync = promisify(execFile);

export interface WorkspaceManager {
  prepare(request: AgentRequest, rootDirectory: string): Promise<string>;
}

export interface WorkerInvoker {
  handleInDirectory(request: AgentRequest, cwd: string): Promise<AgentResult>;
}

export interface WorkflowCheck { passed: boolean; message?: string; }

export interface RepairWorkflowDependencies {
  rootDirectory: string;
  workspace: WorkspaceManager;
  worker: WorkerInvoker;
  validate(cwd: string, request: AgentRequest): Promise<WorkflowCheck>;
  run(cwd: string, request: AgentRequest): Promise<WorkflowCheck>;
  policy?: WorkerPolicy;
  publisher?: RepairPublisher;
}

export interface RepairWorkflowResult {
  workspace: string;
  agent: AgentResult;
  validation?: WorkflowCheck;
  execution?: WorkflowCheck;
  published?: { branch: string; commitSha: string; pullRequest: GitHubPullRequest };
}

export class GitWorkspaceManager implements WorkspaceManager {
  public constructor(private readonly gitCommand = 'git') {}

  async prepare(request: AgentRequest, rootDirectory: string): Promise<string> {
    const requestId = request.requestId.replace(/[^a-zA-Z0-9._-]/g, '-');
    if (requestId.length === 0) throw new Error('requestId is required for workspace preparation');
    const workspace = `${rootDirectory.replace(/\/$/, '')}/${requestId}`;
    await mkdir(rootDirectory, { recursive: true });
    await execFileAsync(this.gitCommand, ['clone', '--no-checkout', '--depth', '1', '--branch', request.repository.branch, request.repository.url, workspace], { maxBuffer: 2 * 1024 * 1024 });
    await execFileAsync(this.gitCommand, ['-C', workspace, 'fetch', '--depth', '1', 'origin', request.repository.commit], { maxBuffer: 2 * 1024 * 1024 });
    await execFileAsync(this.gitCommand, ['-C', workspace, 'checkout', '--detach', request.repository.commit], { maxBuffer: 2 * 1024 * 1024 });
    return workspace;
  }
}

export async function executeRepairWorkflow(request: AgentRequest, dependencies: RepairWorkflowDependencies): Promise<RepairWorkflowResult> {
  const policy = dependencies.policy ?? defaultWorkerPolicy;
  validateWorkerRequest(request, policy);
  if (request.operation !== 'repair') throw new Error('repair workflow requires operation=repair');
  const workspace = await dependencies.workspace.prepare(request, dependencies.rootDirectory);
  const agent = await dependencies.worker.handleInDirectory(request, workspace);
  if (agent.status !== 'completed') return { workspace, agent };
  const validation = await dependencies.validate(workspace, request);
  if (!validation.passed) return { workspace, agent, validation };
  const execution = await dependencies.run(workspace, request);
  if (!execution.passed) return { workspace, agent, validation, execution };
  const manifestPath = request.requestArtifacts?.find((path) => path.endsWith('.yaml') || path.endsWith('.yml'));
  const manifest = agent.proposedChanges?.manifest;
  if (!policy.allowPublish || dependencies.publisher === undefined || manifest === undefined || manifestPath === undefined) return { workspace, agent, validation, execution };
  const published = await publishRepairProposal(dependencies.publisher, { request, manifestPath, manifestContent: manifest, baseBranch: request.repository.branch, baseSha: request.repository.commit, title: agent.pullRequestIntent?.title ?? `Repair ${request.requestId}`, body: agent.pullRequestIntent?.description ?? 'Validated OpenTestPilot repair proposal' });
  return { workspace, agent, validation, execution, published };
}
