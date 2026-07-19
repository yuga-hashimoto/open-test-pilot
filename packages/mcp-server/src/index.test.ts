import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { createHttpClient, handleMcpMessage, type PlatformClient } from './index.js';

const client: PlatformClient = {
  async runStart() { return { runId: 'run-1', status: 'queued' }; },
  async runStatus() { return { runId: 'run-1', status: 'passed' }; },
  async testList() { return { tests: [{ id: 'test-1' }] }; },
  async reportUrl() { return { reportUrl: '/v1/runs/run-1/report' }; },
};

const validManifestYaml = `
schemaVersion: "1.0.0"
id: fixture-login
name: Fixture login
description: Executes a real local browser flow against the fixture app
type: e2e
tags:
  - smoke
priority: high
preconditions: []
variables: []
secrets: []
setup: []
steps:
  - id: login
    description: Sign in
    actions:
      - id: open-login
        type: web.goto
        url: http://127.0.0.1:4173/login
cleanup: []
artifacts:
  screenshots: after
runner:
  minBrowsers:
    - chromium
permissions:
  networkAccess: true
source:
  repository: local
  path: examples/manifests/fixture-login.yaml
generatedCode:
  path: generated/fixture-login.spec.ts
`;

const invalidManifestYaml = `
schemaVersion: "1.0.0"
id: fixture-login
name: Fixture login
description: Executes a real local browser flow against the fixture app
type: e2e
tags:
  - smoke
priority: high
preconditions: []
variables: []
secrets: []
setup: []
cleanup: []
artifacts:
  screenshots: after
runner:
  minBrowsers:
    - chromium
permissions:
  networkAccess: true
source:
  repository: local
  path: examples/manifests/fixture-login.yaml
generatedCode:
  path: generated/fixture-login.spec.ts
`;

describe('MCP server', () => {
  afterEach(() => vi.unstubAllGlobals());

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
      expect.objectContaining({ name: 'project_list' }),
      expect.objectContaining({ name: 'run_list' }),
      expect.objectContaining({ name: 'test_create' }),
      expect.objectContaining({ name: 'manifest_validate' }),
      expect.objectContaining({ name: 'change_request_create' }),
    ]) });
  });

  it('dispatches run_start and run_get_status as structured tool calls', async () => {
    const started = await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run_start', arguments: { organizationId: 'org-1', projectId: 'project-1', testId: 'login' } } }, client);
    expect(started.result).toMatchObject({ content: [{ type: 'text', text: '{"runId":"run-1","status":"queued"}' }] });
    const status = await handleMcpMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'run_get_status', arguments: { organizationId: 'org-1', runId: 'run-1' } } }, client);
    expect(status.result).toMatchObject({ content: [{ type: 'text', text: '{"runId":"run-1","status":"passed"}' }] });
    const tests = await handleMcpMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'test_list', arguments: { organizationId: 'org-1' } } }, client);
    expect(tests.result).toMatchObject({ content: [{ type: 'text', text: '{"tests":[{"id":"test-1"}]}' }] });
    const report = await handleMcpMessage({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'report_get_url', arguments: { organizationId: 'org-1', runId: 'run-1' } } }, client);
    expect(report.result).toMatchObject({ content: [{ type: 'text', text: '{"reportUrl":"/v1/runs/run-1/report"}' }] });
  });

  it('adds the configured session token to platform requests', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ runId: 'run-1', status: 'queued' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const clientWithAuth = createHttpClient('http://platform.test', 'org-1', 'session-token');
    await clientWithAuth.runStatus({ organizationId: 'org-1', runId: 'run-1' });
    expect(fetchMock).toHaveBeenCalledWith('http://platform.test/v1/runs/run-1', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer session-token', 'x-organization-id': 'org-1' }) }));
  });

  it('rejects missing required tool arguments before making a platform call', async () => {
    const response = await handleMcpMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'run_get_status', arguments: { organizationId: 'org-1' } } }, client);
    expect(response.error).toMatchObject({ code: -32602 });
    expect(response.error?.message).toContain('runId');
  });

  it('validates a manifest YAML document locally without a platform client', async () => {
    const valid = await handleMcpMessage({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'manifest_validate', arguments: { manifestYaml: validManifestYaml } } }, client);
    const validBody = JSON.parse((valid.result as { content: Array<{ text: string }> }).content[0]?.text ?? '') as { valid: boolean; errors: unknown[] };
    expect(validBody.valid).toBe(true);
    expect(validBody.errors).toEqual([]);

    const invalid = await handleMcpMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'manifest_validate', arguments: { manifestYaml: invalidManifestYaml } } }, client);
    const invalidBody = JSON.parse((invalid.result as { content: Array<{ text: string }> }).content[0]?.text ?? '') as { valid: boolean; errors: unknown[] };
    expect(invalidBody.valid).toBe(false);
    expect(invalidBody.errors.length).toBeGreaterThan(0);
  });

  it('dispatches test_create with the parsed manifestYaml passed through to the client', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const clientWithTestCreate: PlatformClient = { ...client, async testCreate(input) { recorded.push(input); return { testId: 'test-1' }; } };
    const response = await handleMcpMessage({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'test_create', arguments: { organizationId: 'org-1', projectId: 'project-1', name: 'Fixture login', manifestId: 'fixture-login', manifestYaml: validManifestYaml } } }, clientWithTestCreate);
    expect(response.result).toMatchObject({ content: [{ type: 'text', text: '{"testId":"test-1"}' }] });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.['manifestYaml']).toBe(validManifestYaml);
  });

  it('dispatches change_request_create and run_list happy paths', async () => {
    const clientWithExtras: PlatformClient = {
      ...client,
      async changeRequestCreate() { return { changeRequestId: 'cr-1', status: 'pending' }; },
      async runList() { return { runs: [{ id: 'run-1' }] }; },
    };
    const changeRequest = await handleMcpMessage({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'change_request_create', arguments: { organizationId: 'org-1', title: 'Add coverage for checkout' } } }, clientWithExtras);
    expect(changeRequest.result).toMatchObject({ content: [{ type: 'text', text: '{"changeRequestId":"cr-1","status":"pending"}' }] });
    const runs = await handleMcpMessage({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'run_list', arguments: { organizationId: 'org-1' } } }, clientWithExtras);
    expect(runs.result).toMatchObject({ content: [{ type: 'text', text: '{"runs":[{"id":"run-1"}]}' }] });
  });

  it('rejects test_create when manifestId is missing', async () => {
    const response = await handleMcpMessage({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'test_create', arguments: { organizationId: 'org-1', projectId: 'project-1', name: 'Fixture login' } } }, client);
    expect(response.error).toMatchObject({ code: -32602 });
    expect(response.error?.message).toContain('manifestId');
  });

  it('posts the parsed manifest JSON when createHttpClient testCreate receives manifestYaml', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ testId: 'test-1' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const clientWithAuth = createHttpClient('http://platform.test', 'org-1', 'session-token');
    await clientWithAuth.testCreate?.({ organizationId: 'org-1', projectId: 'project-1', name: 'Fixture login', manifestId: 'fixture-login', manifestYaml: validManifestYaml });
    expect(fetchMock).toHaveBeenCalledWith('http://platform.test/v1/organizations/org-1/tests', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ projectId: 'project-1', name: 'Fixture login', manifestId: 'fixture-login', manifest: parseYaml(validManifestYaml) }),
    }));
  });

  it('rejects createHttpClient testCreate with invalid manifestYaml before making a fetch call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const clientWithAuth = createHttpClient('http://platform.test', 'org-1', 'session-token');
    const response = await handleMcpMessage({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'test_create', arguments: { organizationId: 'org-1', projectId: 'project-1', name: 'Fixture login', manifestId: 'fixture-login', manifestYaml: ':\n  - not: [valid' } } }, clientWithAuth);
    expect(response.error).toMatchObject({ code: -32000 });
    expect(response.error?.message).toContain('manifestYaml is not valid YAML');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
