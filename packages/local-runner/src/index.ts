import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generatePlaywright } from '@open-test-pilot/generator';
import type { Manifest } from '@open-test-pilot/manifest-schema';
import { executeManifest } from '@open-test-pilot/playwright-adapter';
import { renderReport } from '@open-test-pilot/report';
import type { TestRunResult } from '@open-test-pilot/result-schema';

export interface RunLocalOptions {
  rootDir?: string;
  screenshotMode?: 'none' | 'failure-only' | 'after' | 'before-and-after';
  timeoutMs?: number;
}

export interface LocalRunResult extends TestRunResult {
  reportPath: string;
  htmlReportPath: string;
  generatedCodePath: string;
  sourceMapPath: string;
}

export async function runLocal(manifest: Manifest, options: RunLocalOptions = {}): Promise<LocalRunResult> {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runDir = join(options.rootDir ?? '.testpilot/runs', runId);
  const generatedDir = join(runDir, 'generated-code');
  await mkdir(generatedDir, { recursive: true });
  const generated = generatePlaywright(manifest);
  const generatedCodePath = join(generatedDir, `${manifest.id}.spec.ts`);
  const sourceMapPath = join(generatedDir, `${manifest.id}.map.json`);
  await writeFile(generatedCodePath, generated.code, 'utf8');
  await writeFile(sourceMapPath, JSON.stringify(generated.sourceMap, null, 2), 'utf8');

  const executionOptions = {
    outputDir: runDir,
    runId,
    ...(options.screenshotMode === undefined ? {} : { screenshotMode: options.screenshotMode }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
  const result = await executeManifest(manifest, executionOptions);
  result.generatedCodePath = `generated-code/${manifest.id}.spec.ts`;
  result.sourceMapPath = `generated-code/${manifest.id}.map.json`;
  result.artifacts.push(
    { id: `artifact-${result.artifacts.length + 1}`, type: 'generated-code', path: result.generatedCodePath, createdAt: new Date().toISOString() },
    { id: `artifact-${result.artifacts.length + 2}`, type: 'source-map', path: result.sourceMapPath, createdAt: new Date().toISOString() },
  );
  const reportPath = join(runDir, 'report.json');
  await writeFile(reportPath, JSON.stringify(result, null, 2), 'utf8');
  const htmlReportPath = join(runDir, 'index.html');
  await writeFile(htmlReportPath, renderReport(result), 'utf8');
  return {
    ...result,
    reportPath,
    htmlReportPath,
    generatedCodePath,
    sourceMapPath,
  };
}
