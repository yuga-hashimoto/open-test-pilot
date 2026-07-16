import { describe, expect, it } from 'vitest';
import {
  type AgentOperation,
  type AgentRequest,
  type AgentResult,
  AgentProtocolVersion,
  createDefaultAgentAdapterRegistry,
} from './index.js';

describe('Agent Protocol', () => {
  it('exports the agent protocol version', () => {
    expect(AgentProtocolVersion).toBe('1.0.0');
  });

  it('defines all agent operations', () => {
    const operations: AgentOperation[] = [
      'analyze',
      'design',
      'generate',
      'run',
      'analyze-failure',
      'repair',
      'publish',
      'review',
    ];
    expect(operations).toHaveLength(8);
  });

  describe('AgentRequest', () => {
    it('contains requestId, protocolVersion, operation, and repository context', () => {
      const request: AgentRequest = {
        requestId: 'req-001',
        protocolVersion: '1.0.0',
        operation: 'analyze',
        repository: {
          url: 'https://github.com/org/repo',
          branch: 'main',
          commit: 'abc123',
        },
      };
      expect(request.requestId).toBe('req-001');
      expect(request.operation).toBe('analyze');
      expect(request.repository.commit).toBe('abc123');
    });

    it('supports optional organization context', () => {
      const request: AgentRequest = {
        requestId: 'req-002',
        protocolVersion: '1.0.0',
        operation: 'generate',
        repository: {
          url: 'https://github.com/org/repo',
          branch: 'feature/test',
          commit: 'def456',
        },
        organizationId: 'org-001',
        projectId: 'proj-001',
      };
      expect(request.organizationId).toBe('org-001');
      expect(request.projectId).toBe('proj-001');
    });

    it('accepts optional constraints and artifact requests', () => {
      const request: AgentRequest = {
        requestId: 'req-003',
        protocolVersion: '1.0.0',
        operation: 'repair',
        repository: {
          url: 'https://github.com/org/repo',
          branch: 'main',
          commit: 'abc123',
        },
        constraints: {
          maxRetries: 3,
          forbidAppCodeChanges: true,
        },
        requestArtifacts: ['manifest', 'generatedCode', 'sourceMap'],
      };
      expect(request.constraints?.maxRetries).toBe(3);
      expect(request.constraints?.forbidAppCodeChanges).toBe(true);
      expect(request.requestArtifacts).toContain('manifest');
    });
  });

  describe('AgentResult', () => {
    it('contains requestId and protocol version', () => {
      const result: AgentResult = {
        requestId: 'req-001',
        protocolVersion: '1.0.0',
        status: 'completed',
        findings: [],
      };
      expect(result.requestId).toBe('req-001');
      expect(result.status).toBe('completed');
    });

    it('supports async result tracking with jobId', () => {
      const result: AgentResult = {
        requestId: 'req-004',
        protocolVersion: '1.0.0',
        status: 'running',
        jobId: 'job-001',
        findings: [],
      };
      expect(result.jobId).toBe('job-001');
      expect(result.status).toBe('running');
    });

    it('can contain proposed changes', () => {
      const result: AgentResult = {
        requestId: 'req-005',
        protocolVersion: '1.0.0',
        status: 'completed',
        findings: [
          {
            type: 'locator-changed',
            severity: 'warning',
            source: { file: 'manifest.yaml', line: 42 },
            message: 'Button selector might be stale',
          },
        ],
        proposedChanges: {
          manifest: 'name: updated-login-test\n...',
          generatedCode: 'import { test } from ...',
        },
        pullRequestIntent: {
          title: 'fix: update login test locators',
          branch: 'testpilot/fix-login-locators',
        },
      };
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.type).toBe('locator-changed');
      expect(result.proposedChanges?.manifest).toBeTruthy();
      expect(result.pullRequestIntent?.branch).toBe('testpilot/fix-login-locators');
    });
  });

  it('provides interchangeable Claude Code, Codex, and OpenCode adapter contracts', async () => {
    const registry = createDefaultAgentAdapterRegistry({ codex: async (request) => ({ requestId: request.requestId, protocolVersion: AgentProtocolVersion, status: 'completed', findings: [] }) });
    expect(registry.list().map((adapter) => adapter.id)).toEqual(['claude-code', 'codex', 'opencode']);
    expect((await registry.execute('codex', { requestId: 'adapter-1', protocolVersion: AgentProtocolVersion, operation: 'analyze', repository: { url: 'file:///repo', branch: 'main', commit: 'abc' } })).status).toBe('completed');
    expect((await registry.execute('opencode', { requestId: 'adapter-2', protocolVersion: AgentProtocolVersion, operation: 'review', repository: { url: 'file:///repo', branch: 'main', commit: 'abc' } })).status).toBe('rejected');
  });

  it('rejects adapter responses that do not correlate to the request', async () => {
    const registry = createDefaultAgentAdapterRegistry({ 'claude-code': async () => ({ requestId: 'wrong', protocolVersion: AgentProtocolVersion, status: 'completed', findings: [] }) });
    await expect(registry.execute('claude-code', { requestId: 'expected', protocolVersion: AgentProtocolVersion, operation: 'analyze', repository: { url: 'file:///repo', branch: 'main', commit: 'abc' } })).rejects.toThrow('requestId mismatch');
  });
});
