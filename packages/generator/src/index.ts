import type { Manifest, ManifestAction, ManifestStep } from '@open-test-pilot/manifest-schema';

export interface SourceMapNode {
  nodeId: string;
  kind: 'step' | 'action';
  startLine: number;
  endLine: number;
}

export interface GeneratedSourceMap {
  version: 1;
  manifestId: string;
  generatorVersion: string;
  nodes: SourceMapNode[];
}

export interface GeneratedPlaywright {
  code: string;
  sourceMap: GeneratedSourceMap;
  fileName: string;
}

const generatorVersion = '0.1.0';

function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`;
}

function environmentKey(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .toUpperCase();
}

function variableExpression(value: string, manifest: Manifest): string {
  const match = /^\$\{(env|var|secret):?\.?(.*)\}$/.exec(value);
  if (match === null) {
    return quote(value);
  }
  const namespace = match[1];
  const name = match[2] ?? '';
  if (namespace === 'env') {
    return `process.env['${environmentKey(name)}']`;
  }
  if (namespace === 'secret') {
    return `process.env['${environmentKey(name)}']`;
  }
  const variable = manifest.variables.find((candidate) => candidate.name === name);
  if (variable?.defaultValue === undefined) {
    return `process.env['${environmentKey(name)}']`;
  }
  return `process.env.${name} ?? ${quote(variable.defaultValue)}`;
}

function valueExpression(value: string, manifest: Manifest): string {
  const interpolation = /^\$\{(env|var|secret):?\.?([A-Za-z_][A-Za-z0-9_]*)\}(.*)$/.exec(value);
  if (interpolation === null) {
    return quote(value);
  }
  const namespace = interpolation[1];
  const name = interpolation[2] ?? '';
  const suffix = interpolation[3] ?? '';
  const variable = namespace === 'var' ? manifest.variables.find((candidate) => candidate.name === name) : undefined;
  const access = `process.env['${environmentKey(name)}']`;
  if (suffix.length === 0) {
    if (variable?.defaultValue !== undefined) {
      return `${access} ?? ${quote(variable.defaultValue)}`;
    }
    return access;
  }
  const fallback = variable?.defaultValue === undefined ? suffix : `${variable.defaultValue}${suffix}`;
  return `${access} ? ${access} + ${quote(suffix)} : ${quote(fallback)}`;
}

function locatorExpression(selector: string): string {
  const label = /^label=(.*)$/.exec(selector);
  if (label !== null) {
    return `page.getByLabel(${quote(label[1] ?? '')})`;
  }
  const role = /^role=([A-Za-z0-9_-]+)\[name=(.*)\]$/.exec(selector);
  if (role !== null) {
    const name = (role[2] ?? '').replace(/^['"]|['"]$/g, '');
    return `page.getByRole(${quote(role[1] ?? '')}, { name: ${quote(name)} })`;
  }
  return `page.locator(${quote(selector)})`;
}

function actionLines(action: ManifestAction, manifest: Manifest): string[] {
  switch (action.type) {
    case 'web.goto':
      return [`    await page.goto(${valueExpression(action.url ?? '', manifest)});`];
    case 'web.fill':
      return [`    await ${locatorExpression(action.selector ?? '')}.fill(${valueExpression(action.value ?? '', manifest)});`];
    case 'web.click':
      return [`    await ${locatorExpression(action.selector ?? '')}.click();`];
    case 'web.expectVisible':
      return [`    await expect(${locatorExpression(action.selector ?? '')}).toBeVisible();`];
    case 'web.expectText':
      return [`    await expect(${locatorExpression(action.selector ?? '')}).toHaveText(${valueExpression(action.expectedText ?? '', manifest)});`];
    case 'web.screenshot':
      return [`    await page.screenshot({ path: ${quote(`artifacts/${action.name ?? action.id}.png`)} });`];
    case 'api.request':
      return [
        `    const response_${action.id.replace(/[^A-Za-z0-9_$]/g, '_')} = await request.${(action.method ?? 'GET').toLowerCase()}(${valueExpression(action.url ?? '', manifest)});`,
        `    expect(response_${action.id.replace(/[^A-Za-z0-9_$]/g, '_')}.ok()).toBeTruthy();`,
      ];
    default:
      throw new Error(`Unsupported action type: ${action.type}`);
  }
}

function appendStep(lines: string[], sourceMap: SourceMapNode[], step: ManifestStep, manifest: Manifest): void {
  const startLine = lines.length + 1;
  lines.push(`  // testpilot:step ${step.id}`);
  for (const action of step.actions) {
    const actionStartLine = lines.length + 1;
    lines.push(`    // testpilot:action ${action.id}`);
    lines.push(...actionLines(action, manifest));
    sourceMap.push({ nodeId: action.id, kind: 'action', startLine: actionStartLine, endLine: lines.length });
  }
  const endLine = lines.length;
  sourceMap.push({ nodeId: step.id, kind: 'step', startLine, endLine });
}

export function generatePlaywright(manifest: Manifest): GeneratedPlaywright {
  const lines: string[] = [
    "import { test, expect } from '@playwright/test';",
    '',
    `test(${quote(manifest.name)}, async ({ page, request }) => {`,
  ];
  const sourceMap: SourceMapNode[] = [];
  for (const step of [...manifest.setup, ...manifest.steps, ...manifest.cleanup]) {
    appendStep(lines, sourceMap, step, manifest);
  }
  lines.push('});', '');
  return {
    code: `${lines.join('\n')}`,
    sourceMap: {
      version: 1,
      manifestId: manifest.id,
      generatorVersion,
      nodes: sourceMap,
    },
    fileName: manifest.generatedCode.path,
  };
}
