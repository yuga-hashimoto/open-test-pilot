import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { createManifestValidator, type Manifest } from '@open-test-pilot/manifest-schema';
import { renderReport } from '@open-test-pilot/report';
import type { TestRunResult } from '@open-test-pilot/result-schema';
import type { Job } from '@open-test-pilot/runner-protocol';
import { runLocal } from '@open-test-pilot/local-runner';

export interface SerializedJobArtifact {
  key: string;
  contentType: string;
  bodyBase64: string;
}

export interface ContainerJobOutput {
  result: TestRunResult;
  artifacts: SerializedJobArtifact[];
}

/** Executes the immutable manifest snapshot carried by a leased remote job. */
export async function executeJobPayload(job: Job, rootDir = '/tmp/testpilot/container-runs'): Promise<ContainerJobOutput> {
  if (job.manifestDocument === undefined) throw new Error(`job ${job.jobId} does not contain a manifest snapshot`);
  const validation = createManifestValidator()(job.manifestDocument);
  if (!validation.valid) throw new Error(`job manifest is invalid: ${validation.errors?.map((error) => `${error.instancePath} ${error.message ?? error.keyword}`).join('; ') ?? 'unknown validation error'}`);
  const localResult = await runLocal(job.manifestDocument as Manifest, { rootDir });
  const result: TestRunResult = { ...localResult, runId: job.runId };
  const runDir = dirname(localResult.reportPath);
  await writeFile(localResult.reportPath, JSON.stringify(result, null, 2), 'utf8');
  await writeFile(localResult.htmlReportPath, renderReport(result), 'utf8');
  const files = new Map<string, { path: string; contentType: string }>();
  for (const artifact of result.artifacts) files.set(artifact.path, { path: artifact.path, contentType: artifact.mimeType ?? contentTypeForPath(artifact.path) });
  files.set('report.json', { path: 'report.json', contentType: 'application/json' });
  files.set('index.html', { path: 'index.html', contentType: 'text/html; charset=utf-8' });
  const artifacts: SerializedJobArtifact[] = [];
  for (const [key, file] of files) {
    const absolutePath = resolve(runDir, file.path);
    const relativePath = relative(runDir, absolutePath);
    if (relativePath.startsWith('..') || resolve(runDir, relativePath) !== absolutePath) throw new Error(`artifact path escapes run directory: ${file.path}`);
    artifacts.push({ key: `container/${key}`, contentType: file.contentType, bodyBase64: (await readFile(absolutePath)).toString('base64') });
  }
  return { result, artifacts };
}

function contentTypeForPath(path: string): string {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.json') || path.endsWith('.map.json')) return 'application/json';
  if (path.endsWith('.ts')) return 'text/typescript; charset=utf-8';
  if (path.endsWith('.zip')) return 'application/zip';
  return 'text/plain; charset=utf-8';
}
