import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type APIRequestContext, type Browser, type Locator, type Page } from 'playwright';
import type { Manifest, ManifestAction } from '@open-test-pilot/manifest-schema';
import type { ActionResult, Artifact, FailureCategory, StepResult, TestRunResult } from '@open-test-pilot/result-schema';

export interface ExecuteManifestOptions {
  outputDir: string;
  runId?: string;
  browser?: 'chromium';
  screenshotMode?: 'none' | 'failure-only' | 'after' | 'before-and-after';
  timeoutMs?: number;
}

function now(): string {
  return new Date().toISOString();
}

function resolveValue(value: string, manifest: Manifest): string {
  return value.replace(/\$\{(env|var|secret):?\.?([A-Za-z_][A-Za-z0-9_]*)\}/g, (_token, namespace: string, name: string) => {
    if (namespace === 'env' || namespace === 'secret') {
      return process.env[name] ?? '';
    }
    return manifest.variables.find((variable) => variable.name === name)?.defaultValue ?? process.env[name] ?? '';
  });
}

function classifyError(error: unknown): FailureCategory {
  const message = error instanceof Error ? error.message : String(error);
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|browserType\.launch|executable doesn't exist/i.test(message)) {
    return 'ENVIRONMENT_ERROR';
  }
  if (/net::|fetch|socket|ECONNRESET|ENOTFOUND/i.test(message)) {
    return 'NETWORK_ERROR';
  }
  if (/locator|waiting for|to be visible|to have text/i.test(message)) {
    return 'LOCATOR_CHANGED';
  }
  return 'UNKNOWN';
}

async function addArtifact(artifacts: Artifact[], outputDir: string, type: string, relativePath: string, content?: string): Promise<string> {
  const absolutePath = join(outputDir, relativePath);
  await mkdir(join(absolutePath, '..'), { recursive: true });
  if (content !== undefined) {
    await writeFile(absolutePath, content, 'utf8');
  }
  const id = `artifact-${artifacts.length + 1}`;
  artifacts.push({ id, type, path: relativePath, createdAt: now(), ...(content === undefined ? {} : { size: Buffer.byteLength(content) }) });
  return id;
}

async function capturePage(artifacts: Artifact[], page: Page | undefined, outputDir: string, type: 'screenshot' | 'dom' | 'accessibility', name: string): Promise<string[]> {
  if (page === undefined) {
    return [];
  }
  const relativePath = `${type}/${name}.${type === 'screenshot' ? 'png' : 'html'}`;
  if (type === 'screenshot') {
    const absolutePath = join(outputDir, relativePath);
    await mkdir(join(absolutePath, '..'), { recursive: true });
    await page.screenshot({ path: absolutePath, fullPage: true });
    const id = `artifact-${artifacts.length + 1}`;
    artifacts.push({ id, type, path: relativePath, createdAt: now() });
    return [id];
  }
  const content = type === 'dom' ? await page.content() : await page.locator('body').ariaSnapshot();
  return [await addArtifact(artifacts, outputDir, type, relativePath, content)];
}

async function executeAction(action: ManifestAction, manifest: Manifest, page: Page, request: APIRequestContext, timeoutMs: number): Promise<void> {
  const locator = (selector: string): Locator => {
    const label = /^label=(.*)$/.exec(selector);
    if (label !== null) {
      return page.getByLabel(label[1] ?? '');
    }
    const role = /^role=([A-Za-z0-9_-]+)\[name=(.*)\]$/.exec(selector);
    if (role !== null) {
      return page.getByRole(role[1] as Parameters<Page['getByRole']>[0], { name: (role[2] ?? '').replace(/^['"]|['"]$/g, '') });
    }
    return page.locator(selector);
  };
  switch (action.type) {
    case 'web.goto':
      await page.goto(resolveValue(action.url ?? '', manifest), { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
      return;
    case 'web.fill':
      await locator(action.selector ?? '').fill(resolveValue(action.value ?? '', manifest), { timeout: timeoutMs });
      return;
    case 'web.click':
      await locator(action.selector ?? '').click({ timeout: timeoutMs });
      return;
    case 'web.expectVisible':
      await locator(action.selector ?? '').waitFor({ state: 'visible', timeout: timeoutMs });
      return;
    case 'web.expectText':
      await locator(action.selector ?? '').waitFor({ state: 'visible', timeout: timeoutMs });
      if ((await locator(action.selector ?? '').innerText()) !== resolveValue(action.expectedText ?? '', manifest)) {
        throw new Error(`Expected text ${action.expectedText ?? ''} in ${action.selector ?? ''}`);
      }
      return;
    case 'web.screenshot':
      await page.screenshot({ path: resolveValue(action.name ?? action.id, manifest) });
      return;
    case 'api.request': {
      const requestOptions = {
        method: action.method ?? 'GET',
        data: action.body,
        timeout: timeoutMs,
        ...(action.headers === undefined ? {} : { headers: action.headers }),
      };
      const response = await request.fetch(resolveValue(action.url ?? '', manifest), requestOptions);
      if (!response.ok()) {
        throw new Error(`API request failed with status ${response.status()}`);
      }
      return;
    }
    default:
      throw new Error(`Unsupported action type: ${action.type}`);
  }
}

export async function executeManifest(manifest: Manifest, options: ExecuteManifestOptions): Promise<TestRunResult> {
  const runId = options.runId ?? `run-${Date.now()}`;
  const startedAt = now();
  const artifacts: Artifact[] = [];
  const steps: StepResult[] = [];
  const screenshotMode = options.screenshotMode ?? manifest.artifacts.screenshots as ExecuteManifestOptions['screenshotMode'];
  let browser: Browser | undefined;
  let page: Page | undefined;
  let request: APIRequestContext | undefined;
  const metadata = { browser: 'Chromium', browserVersion: 'unknown', viewport: { width: 1280, height: 720 } };

  try {
    await mkdir(options.outputDir, { recursive: true });
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: metadata.viewport });
    page = await context.newPage();
    request = context.request;
    for (const step of [...manifest.setup, ...manifest.steps, ...manifest.cleanup]) {
      const stepStartedAt = now();
      const actionResults: ActionResult[] = [];
      let stepFailed = false;
      for (const action of step.actions) {
        const actionStartedAt = now();
        const actionArtifacts: string[] = [];
        try {
          if (screenshotMode === 'before-and-after') {
            actionArtifacts.push(...await capturePage(artifacts, page, options.outputDir, 'screenshot', `${step.id}-${action.id}-before`));
          }
          await executeAction(action, manifest, page, request, options.timeoutMs ?? 15_000);
          if (screenshotMode === 'before-and-after') {
            actionArtifacts.push(...await capturePage(artifacts, page, options.outputDir, 'screenshot', `${step.id}-${action.id}-after`));
          }
          actionResults.push({ actionId: action.id, type: action.type, status: 'passed', startedAt: actionStartedAt, endedAt: now(), ...(actionArtifacts.length > 0 ? { artifacts: actionArtifacts } : {}) });
        } catch (error) {
          stepFailed = true;
          const message = error instanceof Error ? error.message : String(error);
          actionArtifacts.push(...await capturePage(artifacts, page, options.outputDir, 'screenshot', `${step.id}-${action.id}-failure`));
          actionArtifacts.push(...await capturePage(artifacts, page, options.outputDir, 'dom', `${step.id}-${action.id}-failure`));
          actionArtifacts.push(...await capturePage(artifacts, page, options.outputDir, 'accessibility', `${step.id}-${action.id}-failure`));
          actionResults.push({
            actionId: action.id,
            type: action.type,
            status: 'failed',
            startedAt: actionStartedAt,
            endedAt: now(),
            error: { message, category: classifyError(error) },
            ...(actionArtifacts.length > 0 ? { artifacts: actionArtifacts } : {}),
          });
          break;
        }
      }
      if (!stepFailed && (screenshotMode === 'after' || screenshotMode === 'before-and-after')) {
        const stepArtifacts = await capturePage(artifacts, page, options.outputDir, 'screenshot', `${step.id}-after`);
        if (stepArtifacts.length > 0 && actionResults.length > 0) {
          const last = actionResults[actionResults.length - 1];
          if (last !== undefined) {
            last.artifacts = [...(last.artifacts ?? []), ...stepArtifacts];
          }
        }
      }
      steps.push({ stepId: step.id, status: stepFailed ? 'failed' : 'passed', startedAt: stepStartedAt, endedAt: now(), actions: actionResults });
      if (stepFailed) {
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const artifactId = await addArtifact(artifacts, options.outputDir, 'runner-log', 'logs/runner-error.log', message);
    const stepId = manifest.steps[0]?.id ?? 'runner';
    steps.push({ stepId, status: 'failed', startedAt, endedAt: now(), actions: [{ actionId: 'runner-start', type: 'runner.start', status: 'failed', startedAt, endedAt: now(), error: { message, category: classifyError(error) }, artifacts: [artifactId] }] });
  } finally {
    await browser?.close();
  }

  return {
    runId,
    testId: manifest.id,
    manifestId: manifest.id,
    status: steps.some((step) => step.status === 'failed') ? 'failed' : 'passed',
    startedAt,
    endedAt: now(),
    metadata,
    steps,
    artifacts,
  };
}
