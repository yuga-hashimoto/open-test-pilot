import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { executeMobileManifest, type MobileDriver } from '@open-test-pilot/appium-adapter';
import { generateMobileAppium, generatePlaywright } from '@open-test-pilot/generator';
import type { Manifest } from '@open-test-pilot/manifest-schema';
import { executeManifest, type CustomActionExecutor, type SecretValueProvider } from '@open-test-pilot/playwright-adapter';
import { renderReport } from '@open-test-pilot/report';
import type { TestRunResult } from '@open-test-pilot/result-schema';

export interface RunLocalOptions {
  rootDir?: string;
  screenshotMode?: 'none' | 'failure-only' | 'after' | 'before-and-after';
  timeoutMs?: number;
  customActions?: Record<string, CustomActionExecutor>;
  secretProviders?: Record<string, SecretValueProvider>;
  customActionModule?: string;
  mobileDriver?: MobileDriver;
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
  const isMobile = [...manifest.setup, ...manifest.steps, ...manifest.cleanup].some((step) => step.actions.some((action) => action.type.startsWith('mobile.')));
  const generatedCustomActionModule = options.customActionModule === undefined ? undefined : relative(dirname(join(generatedDir, `${manifest.id}.spec.ts`)), resolve(options.customActionModule));
  const generated = isMobile
    ? generateMobileAppium(manifest)
    : generatePlaywright(manifest, generatedCustomActionModule === undefined ? {} : { customActionModule: generatedCustomActionModule.startsWith('.') ? generatedCustomActionModule : `./${generatedCustomActionModule}` });
  const generatedCodePath = join(generatedDir, `${manifest.id}.spec.ts`);
  const sourceMapPath = join(generatedDir, `${manifest.id}.map.json`);
  await writeFile(generatedCodePath, generated.code, 'utf8');
  await writeFile(sourceMapPath, JSON.stringify(generated.sourceMap, null, 2), 'utf8');

  const executionOptions = {
    outputDir: runDir,
    runId,
    ...(options.screenshotMode === undefined ? {} : { screenshotMode: options.screenshotMode }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.customActions === undefined ? {} : { customActions: options.customActions }),
    ...(options.secretProviders === undefined ? {} : { secretProviders: options.secretProviders }),
  };
  const result: TestRunResult = isMobile
    ? await runMobileManifest(manifest, runId, runDir, options.mobileDriver, (options.screenshotMode ?? manifest.artifacts.screenshots) as NonNullable<RunLocalOptions['screenshotMode']>)
    : await executeManifest(manifest, executionOptions);
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

async function runMobileManifest(manifest: Manifest, runId: string, runDir: string, mobileDriver: MobileDriver | undefined, screenshotMode: RunLocalOptions['screenshotMode']): Promise<TestRunResult> {
  const launch = [...manifest.setup, ...manifest.steps, ...manifest.cleanup].flatMap((step) => step.actions).find((action) => action.type === 'mobile.launch');
  if (launch?.capabilities === undefined) throw new Error('Mobile Manifest requires a mobile.launch action with capabilities');
  const startedAt = new Date().toISOString();
  const mobileResult = await executeMobileManifest(launch.capabilities, { id: manifest.id, steps: [...manifest.setup, ...manifest.steps, ...manifest.cleanup].map((step) => ({ id: step.id, actions: step.actions.filter((action) => action.type.startsWith('mobile.')).map((action) => ({ id: action.id, type: action.type as 'mobile.launch' | 'mobile.tap' | 'mobile.fill' | 'mobile.expectVisible' | 'mobile.expectText' | 'mobile.screenshot' | 'mobile.back', ...(action.selector === undefined ? {} : { selector: action.selector }), ...(action.value === undefined ? {} : { value: action.value }), ...(action.expectedText === undefined ? {} : { expectedText: action.expectedText }), ...(action.name === undefined ? {} : { name: action.name }) })) })) }, {
    evidenceDir: join(runDir, 'artifacts'),
    screenshotMode: screenshotMode as NonNullable<RunLocalOptions['screenshotMode']>,
    ...(mobileDriver === undefined ? {} : { driverFactory: async () => mobileDriver }),
  });
  const artifactRecords = mobileResult.artifacts.map((artifact, index) => ({ id: `mobile-artifact-${index + 1}`, type: artifact.type, path: artifact.path, createdAt: new Date().toISOString(), ...(artifact.mimeType === undefined ? {} : { mimeType: artifact.mimeType }) }));
  const artifactIdByPath = new Map(artifactRecords.map((artifact) => [artifact.path, artifact.id]));
  return {
    runId,
    testId: manifest.id,
    manifestId: manifest.id,
    status: mobileResult.status,
    startedAt,
    endedAt: new Date().toISOString(),
    metadata: { browser: 'appium', browserVersion: 'unknown', viewport: { width: 0, height: 0 }, environment: 'mobile' },
    steps: mobileResult.steps.map((step) => ({
      stepId: step.stepId,
      status: step.status,
      startedAt,
      endedAt: new Date().toISOString(),
      actions: step.actions.map((action) => ({
        actionId: action.actionId,
        type: action.type,
        status: action.status,
        startedAt,
        endedAt: new Date().toISOString(),
        ...(action.error === undefined ? {} : { error: { message: action.error, category: 'UNKNOWN' as const } }),
        ...(action.artifacts === undefined ? {} : { artifacts: action.artifacts.flatMap((artifact) => {
          const artifactId = artifactIdByPath.get(artifact.path);
          return artifactId === undefined ? [] : [artifactId];
        }) }),
      })),
    })),
    artifacts: artifactRecords,
  };
}
