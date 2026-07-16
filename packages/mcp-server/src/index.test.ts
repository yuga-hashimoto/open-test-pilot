import { describe, expect, it } from 'vitest';
import { handleMcpMessage, type PlatformClient } from './index.js';

const client: PlatformClient = {
  async runStart() { return { runId: 'run-1', status: 'queued' }; },
  async runStatus() { return { runId: 'run-1', status: 'passed' }; },
  async testList() { return { tests: [{ id: 'test-1' }] }; },
  async reportUrl() { return { reportUrl: '/v1/runs/run-1/report' }; },
};

describe('MCP server', () => {
  it('answers initialize and lists compact platform tools', async () => {
    const init = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, client);
    expect(init.result).toMatchObject({ protocolVersion: '2024-11-05', serverInfo: { name: 'open-test-pilot' } });
    const list = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, client);
    expect(list.result).toMatchObject({ tools: expect.arrayContaining([
      expect.objectContaining({ name: 'organization_get' }),
      expect.objectContaining({ name: 'test_list' }),
      expect.objectContaining({ name: 'test_get_manifest' }),
      expect.objectContaining({ name: 'run_start' }),
      expect.objectContaining({ name: 'run_get_failures' }),
      expect.objectContaining({ name: 'artifact_get' }),
      expect.objectContaining({ name: 'repair_register' }),
      expect.objectContaining({ name: 'pull_request_register' }),
      expect.objectContaining({ name: 'report_get_url' }),
    ]) });
  });

  it('dispatches run_start and run_get_status as structured tool calls', async () => {
    const started = await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run_start', arguments: { testId: 'login' } } }, client);
    expect(started.result).toMatchObject({ content: [{ type: 'text', text: '{"runId":"run-1","status":"queued"}' }] });
    const status = await handleMcpMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'run_get_status', arguments: { runId: 'run-1' } } }, client);
    expect(status.result).toMatchObject({ content: [{ type: 'text', text: '{"runId":"run-1","status":"passed"}' }] });
    const tests = await handleMcpMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'test_list', arguments: { organizationId: 'org-1' } } }, client);
    expect(tests.result).toMatchObject({ content: [{ type: 'text', text: '{"tests":[{"id":"test-1"}]}' }] });
    const report = await handleMcpMessage({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'report_get_url', arguments: { organizationId: 'org-1', runId: 'run-1' } } }, client);
    expect(report.result).toMatchObject({ content: [{ type: 'text', text: '{"reportUrl":"/v1/runs/run-1/report"}' }] });
  });
});
