import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type MobilePlatform = 'android' | 'ios';

export interface MobileCapabilities {
  platform: MobilePlatform;
  deviceName: string;
  platformVersion?: string;
  app?: string;
  appPackage?: string;
  appActivity?: string;
  automationName?: 'UiAutomator2' | 'XCUITest';
  serverUrl?: string;
}

export interface MobileNode { id?: string | undefined; text?: string | undefined; label?: string | undefined; resourceId?: string | undefined; className?: string | undefined; bounds?: string | undefined; enabled?: boolean | undefined; clickable?: boolean | undefined; }

export interface LocatorCandidate { strategy: 'accessibility id' | 'id' | '-ios predicate string' | 'xpath'; value: string; confidence: number; source: string; }

export function buildAppiumCapabilities(input: MobileCapabilities): Record<string, string> {
  if (input.deviceName.trim().length === 0) throw new Error('deviceName is required');
  const defaults = input.platform === 'android' ? { automationName: 'UiAutomator2' } : { automationName: 'XCUITest' };
  return { platformName: input.platform, 'appium:deviceName': input.deviceName, ...(input.platformVersion === undefined ? {} : { 'appium:platformVersion': input.platformVersion }), ...(input.app === undefined ? {} : { 'appium:app': input.app }), ...(input.appPackage === undefined ? {} : { 'appium:appPackage': input.appPackage }), ...(input.appActivity === undefined ? {} : { 'appium:appActivity': input.appActivity }), 'appium:automationName': input.automationName ?? defaults.automationName };
}

export function parseAndroidUiDump(xml: string): MobileNode[] {
  const nodes: MobileNode[] = [];
  for (const match of xml.matchAll(/<node\s+([^>]+?)\s*\/?>(?:<\/node>)?/g)) {
    const attrs: Record<string, string> = {};
    for (const attribute of match[1]?.matchAll(/([\w-]+)="([^"]*)"/g) ?? []) attrs[attribute[1] ?? ''] = attribute[2] ?? '';
    nodes.push({ id: attrs['resource-id'], text: attrs['text'], className: attrs['class'], bounds: attrs['bounds'], enabled: attrs['enabled'] === 'true', clickable: attrs['clickable'] === 'true' });
  }
  return nodes;
}

export function parseIosAccessibilityJson(value: unknown): MobileNode[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object').map((item) => ({ id: typeof item['identifier'] === 'string' ? item['identifier'] : undefined, label: typeof item['label'] === 'string' ? item['label'] : undefined, text: typeof item['value'] === 'string' ? item['value'] : undefined, className: typeof item['type'] === 'string' ? item['type'] : undefined }));
}

export function locatorCandidates(node: MobileNode, platform: MobilePlatform): LocatorCandidate[] {
  const candidates: LocatorCandidate[] = [];
  if (node.id !== undefined && node.id.length > 0) candidates.push({ strategy: platform === 'android' ? 'id' : 'accessibility id', value: node.id, confidence: 0.98, source: 'stable identifier' });
  if (platform === 'ios' && node.label !== undefined && node.label.length > 0) candidates.push({ strategy: '-ios predicate string', value: `label == "${node.label.replaceAll('"', '\\"')}"`, confidence: 0.9, source: 'accessibility label' });
  if (node.text !== undefined && node.text.length > 0) candidates.push({ strategy: 'xpath', value: `//*[@text="${node.text.replaceAll('"', '\\"')}"]`, confidence: 0.55, source: 'visible text fallback' });
  return candidates;
}

export function generateWebdriverIoTest(capabilities: MobileCapabilities, actions: Array<{ type: 'tap' | 'input' | 'assertText'; locator: LocatorCandidate; value?: string }>): string {
  const lines = [`import { remote } from 'webdriverio';`, '', `const browser = await remote(${JSON.stringify(buildAppiumCapabilities(capabilities), null, 2)});`, 'try {'];
  for (const action of actions) {
    const locator = JSON.stringify(action.locator.value);
    if (action.type === 'tap') lines.push(`  await (await browser.$(${locator})).click();`);
    if (action.type === 'input') lines.push(`  await (await browser.$(${locator})).setValue(${JSON.stringify(action.value ?? '')});`);
    if (action.type === 'assertText') lines.push(`  await expect(await browser.$(${locator})).toHaveText(${JSON.stringify(action.value ?? '')});`);
  }
  lines.push('} finally {', '  await browser.deleteSession();', '}');
  return `${lines.join('\n')}\n`;
}

export interface MobileArtifact { type: string; path: string; mimeType?: string; unavailableReason?: string; }
export interface MobileExecutionOptions { evidenceDir?: string; }
export interface MobileManifestExecutionOptions extends MobileExecutionOptions {
  driverFactory?: (capabilities: MobileCapabilities) => Promise<MobileDriver>;
}
export interface MobileDriver {
  $(selector: string): Promise<{ click(): Promise<void>; setValue(value: string): Promise<void>; getText(): Promise<string>; waitForDisplayed?(): Promise<void> }>;
  deleteSession(): Promise<void>;
  back?(): Promise<void>;
  saveScreenshot?(path: string): Promise<string | Buffer | undefined>;
  getPageSource?(): Promise<string>;
  getCurrentActivity?(): Promise<string>;
  getLogs?(type?: string): Promise<unknown>;
}
export interface MobileExecutionResult { status: 'passed' | 'failed'; error?: string; actions: Array<{ type: string; status: 'passed' | 'failed'; error?: string; locator?: LocatorCandidate }>; artifacts?: MobileArtifact[]; }

export interface MobileManifestAction {
  id: string;
  type: 'mobile.launch' | 'mobile.tap' | 'mobile.fill' | 'mobile.expectVisible' | 'mobile.expectText' | 'mobile.screenshot' | 'mobile.back';
  selector?: string;
  value?: string;
  expectedText?: string;
  name?: string;
  capabilities?: MobileCapabilities;
}

export interface MobileManifestResult {
  status: 'passed' | 'failed';
  error?: string;
  steps: Array<{ stepId: string; status: 'passed' | 'failed'; actions: Array<{ actionId: string; type: string; status: 'passed' | 'failed'; error?: string; artifacts?: MobileArtifact[] }> }>;
  artifacts: MobileArtifact[];
}

async function captureMobileEvidence(driver: MobileDriver, options: MobileExecutionOptions): Promise<MobileArtifact[]> {
  const artifacts: MobileArtifact[] = [];
  const evidenceDir = options.evidenceDir;
  if (evidenceDir !== undefined) await mkdir(evidenceDir, { recursive: true });
  const capture = async (type: string, filename: string, read: () => Promise<unknown>, mimeType: string): Promise<void> => {
    const relativePath = `mobile-failure/${filename}`;
    if (evidenceDir === undefined) {
      artifacts.push({ type, path: relativePath, mimeType, unavailableReason: 'evidenceDir was not configured' });
      return;
    }
    try {
      const value = await read();
      const path = join(evidenceDir, filename);
      if (!existsSync(path)) {
        if (Buffer.isBuffer(value)) await writeFile(path, value);
        else if (typeof value === 'string' && mimeType === 'image/png' && /^[A-Za-z0-9+/=]+$/.test(value)) await writeFile(path, Buffer.from(value, 'base64'));
        else if (typeof value === 'string') await writeFile(path, value, 'utf8');
        else await writeFile(path, JSON.stringify(value ?? null, null, 2), 'utf8');
      }
      artifacts.push({ type, path: relativePath, mimeType });
    } catch (error) {
      artifacts.push({ type, path: relativePath, mimeType, unavailableReason: error instanceof Error ? error.message : String(error) });
    }
  };
  if (driver.saveScreenshot === undefined) artifacts.push({ type: 'mobile-screenshot', path: 'mobile-failure/screenshot.png', mimeType: 'image/png', unavailableReason: 'driver does not expose saveScreenshot' });
  else await capture('mobile-screenshot', 'screenshot.png', async () => driver.saveScreenshot?.(join(evidenceDir ?? '', 'screenshot.png')), 'image/png');
  if (driver.getPageSource === undefined) artifacts.push({ type: 'appium-page-source', path: 'mobile-failure/page-source.xml', mimeType: 'application/xml', unavailableReason: 'driver does not expose getPageSource' });
  else await capture('appium-page-source', 'page-source.xml', async () => driver.getPageSource?.(), 'application/xml');
  if (driver.getCurrentActivity === undefined) artifacts.push({ type: 'mobile-activity', path: 'mobile-failure/activity.txt', mimeType: 'text/plain', unavailableReason: 'driver does not expose getCurrentActivity' });
  else await capture('mobile-activity', 'activity.txt', async () => driver.getCurrentActivity?.(), 'text/plain');
  if (driver.getLogs === undefined) artifacts.push({ type: 'appium-log', path: 'mobile-failure/appium-log.json', mimeType: 'application/json', unavailableReason: 'driver does not expose getLogs' });
  else await capture('appium-log', 'appium-log.json', async () => driver.getLogs?.('logcat'), 'application/json');
  return artifacts;
}

export async function executeMobileActionsWithDriver(driver: MobileDriver, actions: Array<{ type: 'tap' | 'input' | 'assertText'; locator: LocatorCandidate; value?: string }>, options: MobileExecutionOptions = {}): Promise<MobileExecutionResult> {
  const results: MobileExecutionResult['actions'] = [];
  try {
    for (const action of actions) {
      const element = await driver.$(webdriverSelector(action.locator));
      if (action.type === 'tap') await element.click();
      if (action.type === 'input') await element.setValue(action.value ?? '');
      if (action.type === 'assertText' && await element.getText() !== (action.value ?? '')) throw new Error(`Expected mobile text ${action.value ?? ''}`);
    results.push({ type: action.type, status: 'passed', locator: action.locator });
    }
    return { status: 'passed', actions: results };
  } catch (error) {
    const failedAction = actions[results.length];
    results.push({ type: failedAction?.type ?? 'unknown', status: 'failed', error: error instanceof Error ? error.message : String(error), ...(failedAction === undefined ? {} : { locator: failedAction.locator }) });
    return { status: 'failed', error: error instanceof Error ? error.message : String(error), actions: results, artifacts: await captureMobileEvidence(driver, options) };
  }
}

export async function executeMobileManifestWithDriver(
  driver: MobileDriver,
  manifest: { id: string; steps: Array<{ id: string; actions: MobileManifestAction[] }> },
  options: MobileExecutionOptions = {},
): Promise<MobileManifestResult> {
  if (options.evidenceDir !== undefined) await mkdir(options.evidenceDir, { recursive: true });
  const result: MobileManifestResult = { status: 'passed', steps: [], artifacts: [] };
  for (const step of manifest.steps) {
    const stepResult: MobileManifestResult['steps'][number] = { stepId: step.id, status: 'passed', actions: [] };
    for (const action of step.actions) {
      try {
        if (action.type === 'mobile.launch') {
          // The driver boundary owns session creation; keeping the action in the result preserves the Manifest trace.
        } else if (action.type === 'mobile.back') {
          if (driver.back === undefined) throw new Error('Mobile driver does not support back');
          await driver.back();
        } else if (action.type === 'mobile.screenshot') {
          if (driver.saveScreenshot === undefined) throw new Error('Mobile driver does not support screenshots');
          const filename = `${action.name ?? action.id}.png`;
          const captured = await driver.saveScreenshot(join(options.evidenceDir ?? '', filename));
          const artifact: MobileArtifact = { type: 'mobile-screenshot', path: `screenshot/${filename}`, mimeType: 'image/png', ...(captured === undefined ? { unavailableReason: 'driver returned no screenshot path or bytes' } : {}) };
          result.artifacts.push(artifact);
        } else {
          const element = await driver.$(webdriverSelector({ strategy: 'xpath', value: action.selector ?? '', confidence: 1, source: 'Manifest selector' }));
          if (action.type === 'mobile.tap') await element.click();
          if (action.type === 'mobile.fill') await element.setValue(action.value ?? '');
          if (action.type === 'mobile.expectVisible') {
            if (element.waitForDisplayed === undefined) throw new Error('Mobile driver does not support visibility assertions');
            await element.waitForDisplayed();
          }
          if (action.type === 'mobile.expectText' && await element.getText() !== (action.expectedText ?? '')) throw new Error(`Expected mobile text ${action.expectedText ?? ''}`);
        }
        stepResult.actions.push({ actionId: action.id, type: action.type, status: 'passed' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const evidence = await captureMobileEvidence(driver, options);
        result.artifacts.push(...evidence);
        stepResult.actions.push({ actionId: action.id, type: action.type, status: 'failed', error: message, artifacts: evidence });
        stepResult.status = 'failed';
        result.status = 'failed';
        result.error = message;
        result.steps.push(stepResult);
        return result;
      }
    }
    result.steps.push(stepResult);
  }
  return result;
}

export async function executeMobileManifest(
  capabilities: MobileCapabilities,
  manifest: { id: string; steps: Array<{ id: string; actions: MobileManifestAction[] }> },
  options: MobileManifestExecutionOptions = {},
): Promise<MobileManifestResult> {
  let driver: MobileDriver;
  try {
    if (options.driverFactory !== undefined) {
      driver = await options.driverFactory(capabilities);
    } else {
      const { remote } = await import('webdriverio');
      const serverUrl = new URL(capabilities.serverUrl ?? 'http://127.0.0.1:4723');
      driver = await remote({ protocol: serverUrl.protocol.replace(':', '') as 'http' | 'https', hostname: serverUrl.hostname, port: Number(serverUrl.port || (serverUrl.protocol === 'https:' ? 443 : 80)), path: serverUrl.pathname === '' ? '/' : serverUrl.pathname, capabilities: buildAppiumCapabilities(capabilities) }) as unknown as MobileDriver;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'failed', error: message, steps: [], artifacts: [{ type: 'appium-session', path: 'mobile-failure/session.json', mimeType: 'application/json', unavailableReason: message }] };
  }
  try {
    return await executeMobileManifestWithDriver(driver, manifest, options);
  } finally {
    await driver.deleteSession();
  }
}

export async function executeMobileActions(capabilities: MobileCapabilities, actions: Array<{ type: 'tap' | 'input' | 'assertText'; locator: LocatorCandidate; value?: string }>): Promise<MobileExecutionResult> {
  const { remote } = await import('webdriverio');
  const serverUrl = new URL(capabilities.serverUrl ?? 'http://127.0.0.1:4723');
  const driver = await remote({ protocol: serverUrl.protocol.replace(':', '') as 'http' | 'https', hostname: serverUrl.hostname, port: Number(serverUrl.port || (serverUrl.protocol === 'https:' ? 443 : 80)), path: serverUrl.pathname === '' ? '/' : serverUrl.pathname, capabilities: buildAppiumCapabilities(capabilities) });
  try { return await executeMobileActionsWithDriver(driver as unknown as MobileDriver, actions); } finally { await driver.deleteSession(); }
}

function webdriverSelector(locator: LocatorCandidate): string { if (locator.strategy === 'id') return `id=${locator.value}`; if (locator.strategy === 'accessibility id') return `~${locator.value}`; if (locator.strategy === '-ios predicate string') return `-ios predicate string:${locator.value}`; return locator.value; }

export function resolveAndroidSdkPath(env: Record<string, string | undefined> = process.env, options: { home: string; exists: (path: string) => boolean } = { home: homedir(), exists: existsSync }): string | undefined {
  const homeVar = typeof env['ANDROID_HOME'] === 'string' ? env['ANDROID_HOME'].trim() : '';
  if (homeVar.length > 0) return homeVar;
  const rootVar = typeof env['ANDROID_SDK_ROOT'] === 'string' ? env['ANDROID_SDK_ROOT'].trim() : '';
  if (rootVar.length > 0) return rootVar;
  const candidates = [join(options.home, 'Library', 'Android', 'sdk'), join(options.home, 'Android', 'Sdk')];
  return candidates.find((candidate) => options.exists(candidate));
}

export function ensureAndroidSdkEnv(options: { env?: Record<string, string | undefined>; home?: string; exists?: (path: string) => boolean } = {}): string | undefined {
  const env = options.env ?? process.env;
  const resolved = resolveAndroidSdkPath(env, { home: options.home ?? homedir(), exists: options.exists ?? existsSync });
  if (resolved === undefined) return undefined;
  if (typeof process.env['ANDROID_HOME'] !== 'string' || process.env['ANDROID_HOME'].trim().length === 0) process.env['ANDROID_HOME'] = resolved;
  if (typeof process.env['ANDROID_SDK_ROOT'] !== 'string' || process.env['ANDROID_SDK_ROOT'].trim().length === 0) process.env['ANDROID_SDK_ROOT'] = resolved;
  return resolved;
}
