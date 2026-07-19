import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, request as playwrightRequest, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { executeApiAction, type ApiAction, type ApiTransport } from '@open-test-pilot/api-adapter';
import type { Manifest, ManifestAction } from '@open-test-pilot/manifest-schema';
import { redactSecrets, type ActionResult, type Artifact, type FailureCategory, type StepResult, type TestRunResult } from '@open-test-pilot/result-schema';

export interface ExecuteManifestOptions {
  outputDir: string;
  runId?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  screenshotMode?: 'none' | 'failure-only' | 'after' | 'before-and-after';
  timeoutMs?: number;
  customActions?: Record<string, CustomActionExecutor>;
  secretProviders?: Record<string, SecretValueProvider>;
  apiTransport?: ApiTransport;
}

export interface CustomActionPermissions { network?: string[]; filesystem?: { read?: string[]; write?: string[] }; secrets?: string[]; }
export interface CustomActionContext { runId: string; getSecret(name: string): Promise<string | undefined>; writeArtifact(name: string, body: Uint8Array, contentType: string): Promise<string>; }
export interface CustomActionExecutor { permissions?: CustomActionPermissions; execute(context: CustomActionContext, input: Record<string, unknown>): Promise<unknown>; }
export interface SecretValueProvider { get(name: string): Promise<string | undefined>; }

function now(): string {
  return new Date().toISOString();
}

interface ExecutionContext {
  variables: Record<string, unknown>;
  stepOutputs: Record<string, unknown>;
  secrets: Record<string, string>;
  writeArtifact(name: string, body: Uint8Array, contentType: string): Promise<string>;
  recordArtifact(type: string, relativePath: string): string;
}

class ControlSignal extends Error {
  public constructor(public readonly kind: 'break' | 'continue' | 'return') { super(kind); }
}

function resolveValue(value: string, manifest: Manifest, context: ExecutionContext): string {
  return value.replace(/\$\{(env|var|secret|steps):?\.?([A-Za-z_][A-Za-z0-9_.-]*)\}/g, (_token, namespace: string, name: string) => {
    if (namespace === 'env' || namespace === 'secret') {
      return namespace === 'secret' ? context.secrets[name] ?? process.env[name] ?? '' : process.env[name] ?? '';
    }
    if (namespace === 'steps') {
      const valueFromStep = name.split('.').reduce<unknown>((current, part) => current !== null && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined, context.stepOutputs);
      return valueFromStep === undefined || valueFromStep === null ? '' : String(valueFromStep);
    }
    const variable = context.variables[name] ?? manifest.variables.find((candidate) => candidate.name === name)?.defaultValue ?? process.env[name];
    return variable === undefined || variable === null ? '' : String(variable);
  });
}

function resolveAny(value: unknown, manifest: Manifest, context: ExecutionContext): unknown {
  if (typeof value === 'string') {
    const exact = /^\$\{(env|var|secret|steps):?\.?([A-Za-z_][A-Za-z0-9_.-]*)\}$/.exec(value);
    if (exact !== null && exact[1] === 'steps') return exact[2]?.split('.').reduce<unknown>((current, part) => current !== null && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined, context.stepOutputs);
    if (exact !== null && exact[1] === 'var') return context.variables[exact[2] ?? ''] ?? manifest.variables.find((candidate) => candidate.name === exact[2])?.defaultValue ?? process.env[exact[2] ?? ''];
    return resolveValue(value, manifest, context);
  }
  if (Array.isArray(value)) return value.map((item) => resolveAny(item, manifest, context));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveAny(item, manifest, context)]));
  return value;
}

function conditionValue(condition: string, manifest: Manifest, context: ExecutionContext): boolean {
  const expression = condition.trim();
  const orParts = expression.split('||');
  if (orParts.length > 1) return orParts.some((part) => conditionValue(part, manifest, context));
  const andParts = expression.split('&&');
  if (andParts.length > 1) return andParts.every((part) => conditionValue(part, manifest, context));
  if (expression.startsWith('!')) return !conditionValue(expression.slice(1), manifest, context);
  const comparison = /^(.*?)\s*(===|==|!==|!=)\s*(.*?)$/.exec(expression);
  if (comparison !== null) {
    const left = resolveValue(comparison[1] ?? '', manifest, context).trim();
    const right = resolveValue((comparison[3] ?? '').replace(/^['"]|['"]$/g, ''), manifest, context).trim();
    return comparison[2] === '!=' || comparison[2] === '!==' ? left !== right : left === right;
  }
  const resolved = resolveValue(expression, manifest, context).trim();
  return resolved.length > 0 && resolved !== 'false' && resolved !== '0' && resolved !== 'null' && resolved !== 'undefined';
}

function collectionValue(value: string | unknown[] | undefined, manifest: Manifest, context: ExecutionContext): unknown[] {
  const resolved = resolveAny(value ?? [], manifest, context);
  if (Array.isArray(resolved)) return resolved;
  if (typeof resolved !== 'string') return [];
  try { const parsed: unknown = JSON.parse(resolved); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
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
  if (/timeout|timed out|waitUntil/i.test(message)) {
    return 'WAIT_CONDITION_ERROR';
  }
  if (/assert|expect/i.test(message)) {
    return 'PRODUCT_DEFECT';
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

async function addBinaryArtifact(artifacts: Artifact[], outputDir: string, type: string, relativePath: string, content: Uint8Array, contentType: string): Promise<string> {
  const absolutePath = join(outputDir, relativePath);
  await mkdir(join(absolutePath, '..'), { recursive: true });
  await writeFile(absolutePath, content);
  const id = `artifact-${artifacts.length + 1}`;
  artifacts.push({ id, type, path: relativePath, createdAt: now(), size: content.byteLength, mimeType: contentType });
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

async function captureFailureMetadata(artifacts: Artifact[], page: Page | undefined, browserContext: BrowserContext | undefined, outputDir: string, name: string): Promise<string[]> {
  const url = page?.url() ?? '';
  const cookies = browserContext === undefined ? [] : await browserContext.cookies();
  let localStorageKeys: string[] = [];
  let visibleElements: Array<{ tag: string; text: string; role: string | null }> = [];
  if (page !== undefined) {
    try { localStorageKeys = await page.evaluate(() => Object.keys(localStorage)); } catch { /* page may have no document after a launch failure */ }
    try { visibleElements = await page.locator(':visible').evaluateAll((elements) => elements.slice(0, 100).map((element) => ({ tag: element.tagName.toLowerCase(), text: (element.textContent ?? '').trim().slice(0, 200), role: element.getAttribute('role') }))); } catch { /* evidence collection must not hide the original failure */ }
  }
  return [
    await addArtifact(artifacts, outputDir, 'url', `failure/${name}.url.txt`, url),
    await addArtifact(artifacts, outputDir, 'cookies', `failure/${name}.cookies.json`, JSON.stringify(cookies, null, 2)),
    await addArtifact(artifacts, outputDir, 'local-storage', `failure/${name}.local-storage.json`, JSON.stringify(localStorageKeys, null, 2)),
    await addArtifact(artifacts, outputDir, 'visible-elements', `failure/${name}.visible-elements.json`, JSON.stringify(visibleElements, null, 2)),
  ];
}

async function executeAction(action: ManifestAction, manifest: Manifest, page: Page | undefined, request: APIRequestContext | undefined, timeoutMs: number, context: ExecutionContext, options: ExecuteManifestOptions): Promise<void> {
  const locator = (selector: string, target = action.target): Locator => {
    if (page === undefined) throw new Error(`Web action '${action.type}' requires a browser page`);
    if (target?.role !== undefined) return page.getByRole(target.role as Parameters<Page['getByRole']>[0], target.name === undefined ? {} : { name: target.name });
    if (target?.label !== undefined) return page.getByLabel(target.label);
    if (target?.text !== undefined) return page.getByText(target.text);
    if (target?.testId !== undefined) return page.getByTestId(target.testId);
    if (target?.css !== undefined) return page.locator(target.css);
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
      if (page === undefined) throw new Error(`Web action '${action.type}' requires a browser page`);
      await page.goto(resolveValue(action.url ?? '', manifest, context), { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
      // domcontentloaded fires before client-side hydration finishes, which lets a fast
      // fill/click race ahead of the framework attaching its event handlers. Waiting for
      // networkidle closes that race for typical SPA/SSR hydration without hard-failing
      // the step if the app keeps a long-lived connection open (polling, websockets).
      await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
      return;
    case 'web.fill':
      if (page === undefined) throw new Error(`Web action '${action.type}' requires a browser page`);
      await locator(action.selector ?? '').fill(resolveValue(action.value ?? '', manifest, context), { timeout: timeoutMs });
      return;
    case 'web.click':
      if (page === undefined) throw new Error(`Web action '${action.type}' requires a browser page`);
      await locator(action.selector ?? '').click({ timeout: timeoutMs });
      return;
    case 'web.expectVisible':
      if (page === undefined) throw new Error(`Web action '${action.type}' requires a browser page`);
      await locator(action.selector ?? '').waitFor({ state: 'visible', timeout: timeoutMs });
      return;
    case 'web.expectText':
      if (page === undefined) throw new Error(`Web action '${action.type}' requires a browser page`);
      await locator(action.selector ?? '').waitFor({ state: 'visible', timeout: timeoutMs });
      if ((await locator(action.selector ?? '').innerText()) !== resolveValue(action.expectedText ?? '', manifest, context)) {
        throw new Error(`Expected text ${action.expectedText ?? ''} in ${action.selector ?? ''}`);
      }
      return;
    case 'web.screenshot':
      {
        if (page === undefined) throw new Error(`Web action '${action.type}' requires a browser page`);
        const relativePath = `screenshot/${resolveValue(action.name ?? action.id, manifest, context).replace(/^\/+/, '')}`;
        const screenshotPath = join(options.outputDir, relativePath.endsWith('.png') ? relativePath : `${relativePath}.png`);
        await mkdir(join(screenshotPath, '..'), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: true });
        context.recordArtifact('screenshot', relativePath.endsWith('.png') ? relativePath : `${relativePath}.png`);
      }
      return;
    case 'api.request': {
      const resolvedAction = {
        ...action,
        method: action.method ?? 'GET',
        url: resolveValue(action.url ?? '', manifest, context),
        headers: action.headers === undefined ? undefined : resolveAny(action.headers, manifest, context) as Record<string, string>,
        body: resolveAny(action.body, manifest, context),
      } as ApiAction;
      const transport = options.apiTransport ?? (request === undefined ? undefined : createPlaywrightApiTransport(request));
      if (transport === undefined) throw new Error('API request requires an HTTP transport');
      const result = await executeApiAction(resolvedAction, { transport });
      if (action.outputs !== undefined) {
        const output = Object.fromEntries(Object.entries(action.outputs).map(([key, path]) => [key, readObjectPath(result.body, path)]));
        context.stepOutputs[action.id] = { response: { status: result.status, headers: result.headers, body: result.body }, ...output };
      } else {
        context.stepOutputs[action.id] = { response: { status: result.status, headers: result.headers, body: result.body } };
      }
      return;
    }
    case 'control.if':
      await executeActions(conditionValue(action.condition ?? '', manifest, context) ? action.children ?? [] : action.elseChildren ?? [], manifest, page, request, timeoutMs, context, options);
      return;
    case 'control.forEach': {
      const name = action.variable ?? 'item';
      const previous = context.variables[name];
      const hadPrevious = Object.prototype.hasOwnProperty.call(context.variables, name);
      try {
        for (const item of collectionValue(action.items, manifest, context)) {
          context.variables[name] = item;
          try { await executeActions(action.children ?? [], manifest, page, request, timeoutMs, context, options); } catch (error) {
            if (error instanceof ControlSignal && error.kind === 'continue') continue;
            if (error instanceof ControlSignal && error.kind === 'break') break;
            throw error;
          }
        }
      } finally {
        if (hadPrevious) context.variables[name] = previous; else delete context.variables[name];
      }
      return;
    }
    case 'control.switch': {
      const selected = resolveValue(action.value ?? '', manifest, context);
      await executeActions(action.cases?.[selected] ?? action.defaultChildren ?? [], manifest, page, request, timeoutMs, context, options);
      return;
    }
    case 'control.for': {
      const name = action.variable ?? 'index';
      const previous = context.variables[name];
      const hadPrevious = Object.prototype.hasOwnProperty.call(context.variables, name);
      try {
        for (let index = action.from ?? 0; index < (action.to ?? 0); index += action.step ?? 1) {
          context.variables[name] = index;
          try { await executeActions(action.children ?? [], manifest, page, request, timeoutMs, context, options); } catch (error) {
            if (error instanceof ControlSignal && error.kind === 'continue') continue;
            if (error instanceof ControlSignal && error.kind === 'break') break;
            throw error;
          }
        }
      } finally {
        if (hadPrevious) context.variables[name] = previous; else delete context.variables[name];
      }
      return;
    }
    case 'control.while': {
      let attempts = 0;
      while (attempts < (action.maxAttempts ?? 30) && conditionValue(action.condition ?? '', manifest, context)) {
        attempts += 1;
        try { await executeActions(action.children ?? [], manifest, page, request, timeoutMs, context, options); } catch (error) {
          if (error instanceof ControlSignal && error.kind === 'continue') continue;
          if (error instanceof ControlSignal && error.kind === 'break') break;
          throw error;
        }
      }
      return;
    }
    case 'control.retry': {
      let lastError: unknown;
      for (let attempt = 1; attempt <= (action.maxAttempts ?? 3); attempt += 1) {
        try { await executeActions(action.children ?? [], manifest, page, request, timeoutMs, context, options); return; } catch (error) { lastError = error; if (error instanceof ControlSignal) throw error; if (attempt < (action.maxAttempts ?? 3) && (action.backoffMs ?? 0) > 0) await new Promise((resolve) => setTimeout(resolve, action.backoffMs)); }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    case 'control.try':
      try { await executeActions(action.children ?? [], manifest, page, request, timeoutMs, context, options); } catch (error) { if ((action.catch ?? []).length === 0) throw error; await executeActions(action.catch ?? [], manifest, page, request, timeoutMs, context, options); } finally { await executeActions(action.finally ?? [], manifest, page, request, timeoutMs, context, options); }
      return;
    case 'control.timeout':
      await Promise.race([
        executeActions(action.children ?? [], manifest, page, request, timeoutMs, context, options),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`Manifest timeout exceeded: ${action.timeoutMs ?? timeoutMs}ms`)), action.timeoutMs ?? timeoutMs)),
      ]);
      return;
    case 'control.parallel':
      await Promise.all((action.branches ?? []).map((branch) => executeActions(branch, manifest, page, request, timeoutMs, context, options)));
      return;
    case 'control.race':
      await Promise.race((action.branches ?? []).map((branch) => executeActions(branch, manifest, page, request, timeoutMs, context, options)));
      return;
    case 'control.waitUntil':
      for (let attempt = 1; attempt <= (action.maxAttempts ?? 30); attempt += 1) {
        if (conditionValue(action.condition ?? '', manifest, context)) return;
        await executeActions(action.children ?? [], manifest, page, request, timeoutMs, context, options);
        if (conditionValue(action.condition ?? '', manifest, context)) return;
        await new Promise((resolve) => setTimeout(resolve, action.pollMs ?? 250));
      }
      throw new Error(`waitUntil condition was not met: ${action.condition ?? ''}`);
    case 'control.break': throw new ControlSignal('break');
    case 'control.continue': throw new ControlSignal('continue');
    case 'control.return': throw new ControlSignal('return');
    case 'control.set': context.variables[action.variable ?? action.name ?? action.id] = resolveAny(action.value, manifest, context); return;
    case 'control.call': {
      const functionDefinition = manifest.functions?.find((candidate) => candidate.id === (action.functionName ?? action.name));
      if (functionDefinition === undefined) throw new Error(`Unknown Manifest function: ${action.functionName ?? action.name ?? action.id}`);
      const previous = { ...context.variables };
      Object.assign(context.variables, resolveAny(action.arguments ?? {}, manifest, context));
      try { await executeActions(functionDefinition.actions, manifest, page, request, timeoutMs, context, options); } finally { context.variables = previous; }
      return;
    }
    case 'custom.action': {
      const actionName = action.actionType ?? action.name ?? action.id;
      const executor = options.customActions?.[actionName];
      if (executor === undefined) throw new Error(`Custom Action is not registered: ${action.actionType ?? action.name ?? action.id}`);
      const permissions = executor.permissions;
      if ((permissions?.network?.length ?? 0) > 0 && manifest.permissions.networkAccess !== true) throw new Error(`Custom Action '${actionName}' requires network permission but the Manifest denies network access`);
      if (permissions?.filesystem !== undefined && manifest.permissions.fileSystem !== true) throw new Error(`Custom Action '${actionName}' requires filesystem permission but the Manifest denies filesystem access`);
      const customContext: CustomActionContext = {
        runId: options.runId ?? 'local-run',
        getSecret: async (name) => {
          if (!permissions?.secrets?.includes(name)) throw new Error(`Custom Action '${actionName}' is not allowed to read secret '${name}'`);
          return context.secrets[name] ?? process.env[name];
        },
        writeArtifact: async (name, body, contentType) => {
          if (!permissions?.filesystem?.write?.includes(name)) throw new Error(`Custom Action '${actionName}' is not allowed to write artifact '${name}'`);
          return context.writeArtifact(name, body, contentType);
        },
      };
      context.stepOutputs[action.id] = await executor.execute(customContext, (resolveAny(action.input ?? {}, manifest, context) as Record<string, unknown>));
      return;
    }
    case 'mobile.launch':
    case 'mobile.tap':
    case 'mobile.fill':
    case 'mobile.expectVisible':
    case 'mobile.expectText':
    case 'mobile.screenshot':
    case 'mobile.back':
      throw new Error(`Mobile action '${action.type}' requires the Appium execution path. Use runLocal with a mobile manifest or call executeMobileManifest from @open-test-pilot/appium-adapter.`);
    default:
      throw new Error(`Unsupported action type: ${action.type}`);
  }
}

async function executeActions(actions: ManifestAction[], manifest: Manifest, page: Page | undefined, request: APIRequestContext | undefined, timeoutMs: number, context: ExecutionContext, options: ExecuteManifestOptions): Promise<void> {
  for (const action of actions) await executeAction(action, manifest, page, request, timeoutMs, context, options);
}

function createPlaywrightApiTransport(request: APIRequestContext): ApiTransport {
  return {
    async request(input) {
      const started = Date.now();
      const response = await request.fetch(input.url, {
        method: input.method,
        ...(input.timeoutMs === undefined ? {} : { timeout: input.timeoutMs }),
        ...(input.headers === undefined ? {} : { headers: input.headers }),
        ...(input.body === undefined ? {} : { data: input.body }),
      });
      const text = await response.text();
      let body: unknown = text;
      try { body = JSON.parse(text) as unknown; } catch { /* preserve text responses */ }
      return { status: response.status(), headers: response.headers(), body, durationMs: Date.now() - started };
    },
  };
}

function readObjectPath(value: unknown, path: string): unknown { return path.replace(/^\$\.?/, '').split('.').filter(Boolean).reduce<unknown>((current, part) => current !== null && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined, value); }

export async function executeManifest(manifest: Manifest, options: ExecuteManifestOptions): Promise<TestRunResult> {
  const runId = options.runId ?? `run-${Date.now()}`;
  const startedAt = now();
  const artifacts: Artifact[] = [];
  const steps: StepResult[] = [];
  const screenshotMode = options.screenshotMode ?? manifest.artifacts.screenshots as ExecuteManifestOptions['screenshotMode'];
  let browser: Browser | undefined;
  let browserContext: BrowserContext | undefined;
  let page: Page | undefined;
  let request: APIRequestContext | undefined;
  let traceActive = false;
  const consoleLog: string[] = [];
  const networkLog: string[] = [];
  const browserName = options.browser ?? 'chromium';
  const allActions = [...manifest.setup, ...manifest.steps, ...manifest.cleanup].flatMap((step) => step.actions);
  const requiresBrowser = allActions.some((action) => action.type.startsWith('web.'));
  const metadata = { browser: requiresBrowser ? (browserName === 'chromium' ? 'Chromium' : browserName === 'firefox' ? 'Firefox' : 'WebKit') : 'none', browserVersion: 'unknown', viewport: { width: 1280, height: 720 } };
  const executionContext: ExecutionContext = {
    variables: {},
    stepOutputs: {},
    secrets: await resolveManifestSecrets(manifest, options.secretProviders),
    writeArtifact: async (name, body, contentType) => {
      const relativePath = name.replaceAll('\\', '/').replace(/^\/+/, '');
      if (relativePath.split('/').includes('..')) throw new Error('custom artifact path must stay within the run directory');
      return addBinaryArtifact(artifacts, options.outputDir, 'custom', relativePath, body, contentType);
    },
    recordArtifact: (type, relativePath) => {
      const id = `artifact-${artifacts.length + 1}`;
      artifacts.push({ id, type, path: relativePath, createdAt: now() });
      return id;
    },
  };

  try {
    await mkdir(options.outputDir, { recursive: true });
    if (requiresBrowser) {
      const browserType = browserName === 'chromium' ? chromium : (await import('playwright'))[browserName];
      browser = await browserType.launch({
        ...(process.env['PLAYWRIGHT_EXECUTABLE_PATH'] === undefined ? {} : { executablePath: process.env['PLAYWRIGHT_EXECUTABLE_PATH'] }),
        ...(process.env['PLAYWRIGHT_NO_SANDBOX'] === 'true' ? { args: ['--no-sandbox', '--disable-crashpad', '--disable-crash-reporter', '--disable-breakpad', '--noerrdialogs'] } : {}),
      });
      browserContext = await browser.newContext({ viewport: metadata.viewport });
      if (manifest.artifacts.traces === true) {
        await browserContext.tracing.start({ screenshots: true, snapshots: true, sources: false });
        traceActive = true;
      }
      page = await browserContext.newPage();
      request = browserContext.request;
      page.on('console', (message) => consoleLog.push(JSON.stringify({ type: message.type(), text: message.text() })));
      page.on('request', (requestEvent) => networkLog.push(JSON.stringify({ type: 'request', method: requestEvent.method(), url: requestEvent.url() })));
      page.on('response', (responseEvent) => networkLog.push(JSON.stringify({ type: 'response', status: responseEvent.status(), url: responseEvent.url() })));
    } else if (options.apiTransport === undefined) {
      request = await playwrightRequest.newContext();
    }
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
          await executeAction(action, manifest, page, request, options.timeoutMs ?? 15_000, executionContext, options);
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
          actionArtifacts.push(...await captureFailureMetadata(artifacts, page, browserContext, options.outputDir, `${step.id}-${action.id}`));
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
      if (!stepFailed) {
        const stepOutput = Object.fromEntries(Object.entries(step.output ?? {}).map(([key, value]) => [key, resolveAny(value, manifest, executionContext)]));
        const actionOutputs = Object.fromEntries(step.actions.flatMap((action) => {
          const output = executionContext.stepOutputs[action.id];
          return output !== null && typeof output === 'object' ? Object.entries(output as Record<string, unknown>) : [];
        }));
        executionContext.stepOutputs[step.id] = { ...actionOutputs, ...stepOutput };
      }
      steps.push({ stepId: step.id, status: stepFailed ? 'failed' : 'passed', startedAt: stepStartedAt, endedAt: now(), actions: actionResults });
      if (stepFailed) {
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const artifactId = await addArtifact(artifacts, options.outputDir, 'runner-log', 'logs/runner-error.log', redactText(message, executionContext.secrets));
    const stepId = manifest.steps[0]?.id ?? 'runner';
    steps.push({ stepId, status: 'failed', startedAt, endedAt: now(), actions: [{ actionId: 'runner-start', type: 'runner.start', status: 'failed', startedAt, endedAt: now(), error: { message, category: classifyError(error) }, artifacts: [artifactId] }] });
  } finally {
    if (browserContext !== undefined && traceActive) {
      const relativePath = 'trace/trace.zip';
      const absolutePath = join(options.outputDir, relativePath);
      await mkdir(join(absolutePath, '..'), { recursive: true });
      await browserContext.tracing.stop({ path: absolutePath });
      artifacts.push({ id: `artifact-${artifacts.length + 1}`, type: 'trace', path: relativePath, createdAt: now() });
    }
    if (consoleLog.length > 0) await addArtifact(artifacts, options.outputDir, 'console', 'logs/console.log', redactText(consoleLog.join('\n'), executionContext.secrets));
    if (networkLog.length > 0) await addArtifact(artifacts, options.outputDir, 'network', 'logs/network.log', redactText(networkLog.join('\n'), executionContext.secrets));
    if (browser === undefined && options.apiTransport === undefined) await request?.dispose();
    await browser?.close();
  }

  const result: TestRunResult = {
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
  return redactSecrets(result, Object.values(executionContext.secrets));
}

function redactText(value: string, secrets: Record<string, string>): string {
  return Object.values(secrets).filter((secret) => secret.length > 0).reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value);
}

async function resolveManifestSecrets(manifest: Manifest, providers: Record<string, SecretValueProvider> | undefined): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const secret of manifest.secrets) {
    const provider = providers?.[secret.provider];
    const value = provider === undefined ? process.env[secret.name] ?? process.env[secret.reference] : await provider.get(secret.reference);
    if (value !== undefined) values[secret.name] = value;
  }
  return values;
}
