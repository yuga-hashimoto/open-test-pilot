export type MobilePlatform = 'android' | 'ios';

export interface MobileCapabilities {
  platform: MobilePlatform;
  deviceName: string;
  platformVersion?: string;
  app?: string;
  appPackage?: string;
  appActivity?: string;
  automationName?: 'UiAutomator2' | 'XCUITest';
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

export interface MobileDriver { $(selector: string): Promise<{ click(): Promise<void>; setValue(value: string): Promise<void>; getText(): Promise<string> }>; deleteSession(): Promise<void>; }
export interface MobileExecutionResult { status: 'passed' | 'failed'; error?: string; actions: Array<{ type: string; status: 'passed' | 'failed'; error?: string }>; }

export async function executeMobileActionsWithDriver(driver: MobileDriver, actions: Array<{ type: 'tap' | 'input' | 'assertText'; locator: LocatorCandidate; value?: string }>): Promise<MobileExecutionResult> {
  const results: MobileExecutionResult['actions'] = [];
  try {
    for (const action of actions) {
      const element = await driver.$(webdriverSelector(action.locator));
      if (action.type === 'tap') await element.click();
      if (action.type === 'input') await element.setValue(action.value ?? '');
      if (action.type === 'assertText' && await element.getText() !== (action.value ?? '')) throw new Error(`Expected mobile text ${action.value ?? ''}`);
      results.push({ type: action.type, status: 'passed' });
    }
    return { status: 'passed', actions: results };
  } catch (error) {
    results.push({ type: actions[results.length]?.type ?? 'unknown', status: 'failed', error: error instanceof Error ? error.message : String(error) });
    return { status: 'failed', error: error instanceof Error ? error.message : String(error), actions: results };
  }
}

export async function executeMobileActions(capabilities: MobileCapabilities, actions: Array<{ type: 'tap' | 'input' | 'assertText'; locator: LocatorCandidate; value?: string }>): Promise<MobileExecutionResult> {
  const { remote } = await import('webdriverio');
  const driver = await remote({ capabilities: buildAppiumCapabilities(capabilities) });
  try { return await executeMobileActionsWithDriver(driver as unknown as MobileDriver, actions); } finally { await driver.deleteSession(); }
}

function webdriverSelector(locator: LocatorCandidate): string { if (locator.strategy === 'id') return `id=${locator.value}`; if (locator.strategy === 'accessibility id') return `~${locator.value}`; if (locator.strategy === '-ios predicate string') return `-ios predicate string:${locator.value}`; return locator.value; }
