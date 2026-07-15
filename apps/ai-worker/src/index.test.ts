import { describe, expect, it } from 'vitest';
import { defaultWorkerPolicy, validateWorkerRequest } from './index.js';
import type { AgentRequest } from '@open-test-pilot/agent-protocol';

const request = (operation: AgentRequest['operation'], constraints?: AgentRequest['constraints']): AgentRequest => ({ requestId: 'request-1', protocolVersion: '1.0.0', operation, repository: { url: 'file:///repo', branch: 'main', commit: 'abc' }, ...(constraints === undefined ? {} : { constraints }) });

describe('AI Worker safety policy', () => {
  it('allows analysis and requires explicit no-app-change repair constraints', () => {
    expect(() => validateWorkerRequest(request('analyze'))).not.toThrow();
    expect(() => validateWorkerRequest(request('repair', { forbidAppCodeChanges: true }))).not.toThrow();
    expect(() => validateWorkerRequest(request('repair'))).toThrow('forbidAppCodeChanges');
  });

  it('rejects publish and excessive retry requests by default', () => {
    expect(() => validateWorkerRequest(request('publish'))).toThrow('not allowed');
    expect(() => validateWorkerRequest(request('repair', { forbidAppCodeChanges: true, maxRetries: defaultWorkerPolicy.maxRetries + 1 }))).toThrow('retry policy');
  });
});
