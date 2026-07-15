export const AgentProtocolVersion = '1.0.0' as const;

export type AgentOperation =
  | 'analyze'
  | 'design'
  | 'generate'
  | 'run'
  | 'analyze-failure'
  | 'repair'
  | 'publish'
  | 'review';

export interface RepositoryContext {
  url: string;
  branch: string;
  commit: string;
}

export interface AgentConstraints {
  maxRetries?: number;
  forbidAppCodeChanges?: boolean;
}

export interface AgentRequest {
  requestId: string;
  protocolVersion: typeof AgentProtocolVersion;
  operation: AgentOperation;
  repository: RepositoryContext;
  organizationId?: string;
  projectId?: string;
  constraints?: AgentConstraints;
  requestArtifacts?: string[];
}

export type AgentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'rejected';

export interface Finding {
  type: string;
  severity: 'info' | 'warning' | 'error';
  source: { file: string; line?: number; column?: number };
  message: string;
}

export interface ProposedChanges {
  manifest?: string;
  generatedCode?: string;
  sourceMap?: string;
}

export interface PullRequestIntent {
  title: string;
  branch: string;
  description?: string;
}

export interface AgentResult {
  requestId: string;
  protocolVersion: typeof AgentProtocolVersion;
  status: AgentStatus;
  jobId?: string;
  findings: Finding[];
  proposedChanges?: ProposedChanges;
  pullRequestIntent?: PullRequestIntent;
}
