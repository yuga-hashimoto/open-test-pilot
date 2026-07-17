import type { AgentRequest } from '@open-test-pilot/agent-protocol';
import type { GitHubPullRequest, GitHubApiClient } from '@open-test-pilot/github-adapter';

export interface RepairProposal { request: AgentRequest; manifestPath: string; manifestContent: string; baseBranch: string; baseSha: string; title: string; body: string; }
export interface RepairPublisher { createBranch(owner: string, repository: string, branch: string, baseSha: string): Promise<void>; getFile?(owner: string, repository: string, path: string, ref: string): Promise<{ sha: string } | undefined>; commitFile(owner: string, repository: string, input: { branch: string; path: string; content: string; message: string; sha?: string }): Promise<{ commitSha: string }>; createPullRequest(owner: string, repository: string, input: { title: string; head: string; base: string; body?: string; draft?: boolean }): Promise<GitHubPullRequest>; }

export async function publishRepairProposal(client: RepairPublisher, proposal: RepairProposal): Promise<{ branch: string; commitSha: string; pullRequest: GitHubPullRequest }> {
  if (proposal.request.operation !== 'repair') throw new Error('only repair requests can be published');
  if (proposal.request.constraints?.forbidAppCodeChanges !== true) throw new Error('repair proposal requires forbidAppCodeChanges=true');
  if (!proposal.manifestPath.endsWith('.yaml') && !proposal.manifestPath.endsWith('.yml')) throw new Error('repair proposal must target a YAML manifest');
  const { owner, repository } = parseGitHubRepository(proposal.request.repository.url);
  const branch = `testpilot/repair/${proposal.request.requestId}`;
  await client.createBranch(owner, repository, branch, proposal.baseSha);
  const existing = client.getFile === undefined ? undefined : await client.getFile(owner, repository, proposal.manifestPath, proposal.baseBranch);
  const commit = await client.commitFile(owner, repository, { branch, path: proposal.manifestPath, content: proposal.manifestContent, message: proposal.title, ...(existing === undefined ? {} : { sha: existing.sha }) });
  const pullRequest = await client.createPullRequest(owner, repository, { title: proposal.title, head: branch, base: proposal.baseBranch, body: proposal.body, draft: true });
  return { branch, commitSha: commit.commitSha, pullRequest };
}

export async function publishRepairWithGitHub(client: GitHubApiClient, proposal: RepairProposal): Promise<{ branch: string; commitSha: string; pullRequest: GitHubPullRequest }> { return publishRepairProposal(client, proposal); }

function parseGitHubRepository(value: string): { owner: string; repository: string } { const url = new URL(value); if (url.hostname !== 'github.com') throw new Error('repair repository must be a github.com URL'); const [owner, repository] = url.pathname.split('/').filter(Boolean); if (owner === undefined || repository === undefined) throw new Error('repair repository URL must include owner and repository'); return { owner, repository: repository.replace(/\.git$/, '') }; }
