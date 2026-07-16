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

export type AgentAdapterId = 'claude-code' | 'codex' | 'opencode';

export interface AgentAdapter {
  id: AgentAdapterId;
  displayName: string;
  supports: readonly AgentOperation[];
  execute(request: AgentRequest): Promise<AgentResult>;
}

export function validateAgentResult(request: AgentRequest, result: AgentResult): AgentResult {
  if (result.requestId !== request.requestId) throw new Error(`Agent result requestId mismatch: expected ${request.requestId}, received ${result.requestId}`);
  if (result.protocolVersion !== AgentProtocolVersion) throw new Error(`Unsupported agent result protocol version: ${result.protocolVersion}`);
  if (!Array.isArray(result.findings)) throw new Error('Agent result findings must be an array');
  return result;
}

export class AgentAdapterRegistry {
  private readonly adapters = new Map<AgentAdapterId, AgentAdapter>();
  register(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.id)) throw new Error(`Agent adapter already registered: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
  }
  get(id: AgentAdapterId): AgentAdapter | undefined { return this.adapters.get(id); }
  list(): AgentAdapter[] { return [...this.adapters.values()]; }
  async execute(id: AgentAdapterId, request: AgentRequest): Promise<AgentResult> {
    const adapter = this.adapters.get(id);
    if (adapter === undefined) throw new Error(`Agent adapter is not registered: ${id}`);
    if (!adapter.supports.includes(request.operation)) throw new Error(`Agent adapter ${id} does not support ${request.operation}`);
    return validateAgentResult(request, await adapter.execute(request));
  }
}

export function createDefaultAgentAdapterRegistry(executors: Partial<Record<AgentAdapterId, AgentAdapter['execute']>> = {}): AgentAdapterRegistry {
  const registry = new AgentAdapterRegistry();
  const operations: readonly AgentOperation[] = ['analyze', 'design', 'generate', 'run', 'analyze-failure', 'repair', 'publish', 'review'];
  for (const id of ['claude-code', 'codex', 'opencode'] as const) {
    const execute = executors[id] ?? (async (request) => ({ requestId: request.requestId, protocolVersion: AgentProtocolVersion, status: 'rejected' as const, findings: [{ type: 'adapter-not-configured', severity: 'warning' as const, source: { file: request.repository.url }, message: `${id} adapter requires a configured executor` }] }));
    registry.register({ id, displayName: id === 'claude-code' ? 'Claude Code' : id === 'opencode' ? 'OpenCode' : 'Codex', supports: operations, execute });
  }
  return registry;
}
