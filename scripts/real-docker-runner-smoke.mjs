import { readFile } from 'node:fs/promises';
import { parseManifest } from '../packages/manifest-parser/dist/index.js';
import { createRunnerClient, runRunnerLoop } from '../apps/runner/dist/index.js';

const baseUrl = process.env.OPENTESTPILOT_URL ?? 'http://127.0.0.1:3001';
const organizationId = process.env.OPENTESTPILOT_ORGANIZATION_ID;
const projectId = process.env.OPENTESTPILOT_PROJECT_ID;
const fixturePath = process.env.OPENTESTPILOT_FIXTURE_MANIFEST ?? 'examples/manifests/fixture-login.yaml';
const runnerImage = process.env.RUNNER_IMAGE ?? 'opentestpilot-runner:local';

if (organizationId === undefined || projectId === undefined) {
  throw new Error('OPENTESTPILOT_ORGANIZATION_ID and OPENTESTPILOT_PROJECT_ID are required');
}

const headers = { accept: 'application/json', 'x-organization-id': organizationId };
async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text}`);
  return JSON.parse(text);
}

const source = (await readFile(fixturePath, 'utf8')).replaceAll('127.0.0.1', 'host.docker.internal');
const parsed = parseManifest(source, fixturePath);
if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
  throw new Error(parsed.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('; '));
}

const test = await request(`/v1/organizations/${organizationId}/tests`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectId, name: `Docker runner smoke ${new Date().toISOString()}`, manifestId: parsed.manifest.id, manifest: parsed.manifest }),
});
const run = await request(`/v1/organizations/${organizationId}/runs`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectId, testId: test.id }),
});

await new Promise((resolve) => setTimeout(resolve, 100));
await runRunnerLoop(createRunnerClient(baseUrl, organizationId), {
  name: `docker-smoke-${Date.now()}`,
  capabilities: { browsers: ['chromium'], labels: ['docker', 'smoke'], maxConcurrency: 1 },
  once: true,
  docker: { image: runnerImage, memoryMb: 2048, cpus: 2, timeoutMs: 240_000 },
});

const [finalRun, artifacts, failures] = await Promise.all([
  request(`/v1/runs/${run.runId}`),
  request(`/v1/runs/${run.runId}/artifacts`),
  request(`/v1/runs/${run.runId}/failures`),
]);

if (finalRun.status !== 'passed') throw new Error(`Docker runner smoke failed: ${JSON.stringify(finalRun)}`);
if (artifacts.artifacts.length === 0) throw new Error('Docker runner smoke uploaded no artifacts');
if (failures.failures.length !== 0) throw new Error(`Docker runner smoke reported failures: ${JSON.stringify(failures)}`);
console.log(JSON.stringify({ runId: run.runId, status: finalRun.status, artifactCount: artifacts.artifacts.length, artifactKeys: artifacts.artifacts.map((artifact) => artifact.key).sort(), failureCount: failures.failures.length }, null, 2));
