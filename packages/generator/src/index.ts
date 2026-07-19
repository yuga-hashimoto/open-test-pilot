import type { Manifest, ManifestAction, ManifestMobileCapabilities, ManifestStep } from '@open-test-pilot/manifest-schema';

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

export type GeneratedMobileAppium = GeneratedPlaywright;

export interface GeneratePlaywrightOptions {
  /** Module exporting the custom action registry used by the generated test. */
  customActionModule?: string;
}

const generatorVersion = '0.1.0';

function mobileCapabilitiesLiteral(capabilities: ManifestMobileCapabilities): string {
  const entries: string[] = [
    `platformName: ${quote(capabilities.platform)}`,
    `'appium:deviceName': ${quote(capabilities.deviceName)}`,
  ];
  if (capabilities.udid !== undefined) entries.push(`'appium:udid': ${quote(capabilities.udid)}`);
  if (capabilities.platformVersion !== undefined) entries.push(`'appium:platformVersion': ${quote(capabilities.platformVersion)}`);
  if (capabilities.app !== undefined) entries.push(`'appium:app': ${quote(capabilities.app)}`);
  if (capabilities.bundleId !== undefined) entries.push(`'appium:bundleId': ${quote(capabilities.bundleId)}`);
  if (capabilities.appPackage !== undefined) entries.push(`'appium:appPackage': ${quote(capabilities.appPackage)}`);
  if (capabilities.appActivity !== undefined) entries.push(`'appium:appActivity': ${quote(capabilities.appActivity)}`);
  entries.push(`'appium:automationName': ${quote(capabilities.automationName ?? (capabilities.platform === 'android' ? 'UiAutomator2' : 'XCUITest'))}`);
  if (capabilities.wdaLocalPort !== undefined) entries.push(`'appium:wdaLocalPort': ${capabilities.wdaLocalPort}`);
  if (capabilities.useNewWDA !== undefined) entries.push(`'appium:useNewWDA': ${capabilities.useNewWDA}`);
  if (capabilities.wdaLaunchTimeout !== undefined) entries.push(`'appium:wdaLaunchTimeout': ${capabilities.wdaLaunchTimeout}`);
  if (capabilities.wdaConnectionTimeout !== undefined) entries.push(`'appium:wdaConnectionTimeout': ${capabilities.wdaConnectionTimeout}`);
  if (capabilities.showXcodeLog !== undefined) entries.push(`'appium:showXcodeLog': ${capabilities.showXcodeLog}`);
  if (capabilities.noReset !== undefined) entries.push(`'appium:noReset': ${capabilities.noReset}`);
  if (capabilities.simulatorDevicesSetPath !== undefined) entries.push(`'appium:simulatorDevicesSetPath': ${quote(capabilities.simulatorDevicesSetPath)}`);
  return `{ ${entries.join(', ')} }`;
}

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
  const interpolation = /^\$\{(env|var|secret|steps):?\.?([A-Za-z_][A-Za-z0-9_.-]*)\}(.*)$/.exec(value);
  if (interpolation === null) {
    return quote(value);
  }
  const namespace = interpolation[1];
  const name = interpolation[2] ?? '';
  const suffix = interpolation[3] ?? '';
  if (namespace === 'steps' || namespace === 'secret' || (namespace === 'var' && manifest.variables.some((candidate) => candidate.name === name && candidate.defaultValue === undefined))) {
    return `resolveValue(${quote(value)})`;
  }
  if (namespace === 'steps' || (namespace === 'var' && manifest.variables.every((candidate) => candidate.name !== name))) {
    return `resolveValue(${quote(value)})${suffix.length > 0 ? ` + ${quote(suffix)}` : ''}`;
  }
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

function anyExpression(value: unknown, manifest: Manifest): string {
  if (typeof value === 'string' && /^\$\{(?:env|var|secret|steps):?\.?[A-Za-z_][A-Za-z0-9_.-]*\}$/.test(value)) return `resolveAny(${quote(value)})`;
  if (typeof value === 'string') return valueExpression(value, manifest);
  return `resolveAny(${JSON.stringify(value)})`;
}

function locatorExpression(selector: string, target?: ManifestAction['target']): string {
  if (target?.role !== undefined) return `page.getByRole(${quote(target.role)}, ${target.name === undefined ? '{}' : `{ name: ${quote(target.name)} }`})`;
  if (target?.label !== undefined) return `page.getByLabel(${quote(target.label)})`;
  if (target?.text !== undefined) return `page.getByText(${quote(target.text)})`;
  if (target?.testId !== undefined) return `page.getByTestId(${quote(target.testId)})`;
  if (target?.css !== undefined) return `page.locator(${quote(target.css)})`;
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

function indentLines(lines: string[], indent: string): string[] { return lines.map((line) => `${indent}${line}`); }

function actionLines(action: ManifestAction, manifest: Manifest, indent: string): string[] {
  switch (action.type) {
    case 'web.goto':
      return [
        `await page.goto(${valueExpression(action.url ?? '', manifest)}, { waitUntil: 'domcontentloaded' });`,
        `await page.waitForLoadState('networkidle').catch(() => undefined);`,
      ].map((line) => `${indent}${line}`);
    case 'web.fill':
      return [`await ${locatorExpression(action.selector ?? '', action.target)}.fill(${valueExpression(action.value ?? '', manifest)});`].map((line) => `${indent}${line}`);
    case 'web.click':
      return [`await ${locatorExpression(action.selector ?? '', action.target)}.click();`].map((line) => `${indent}${line}`);
    case 'web.expectVisible':
      return [`await expect(${locatorExpression(action.selector ?? '', action.target)}).toBeVisible();`].map((line) => `${indent}${line}`);
    case 'web.expectText':
      return [`await expect(${locatorExpression(action.selector ?? '', action.target)}).toHaveText(${valueExpression(action.expectedText ?? '', manifest)});`].map((line) => `${indent}${line}`);
    case 'web.screenshot':
      return [`await page.screenshot({ path: ${quote(`artifacts/${action.name ?? action.id}.png`)} });`].map((line) => `${indent}${line}`);
    case 'api.request':
      {
        const identifier = action.id.replace(/[^A-Za-z0-9_$]/g, '_');
        const expectedStatuses = Array.isArray(action.expectedStatus) ? action.expectedStatus : [action.expectedStatus ?? 200];
        return [
          `${indent}const response_${identifier} = await request.fetch(${valueExpression(action.url ?? '', manifest)}, { method: ${quote(action.method ?? 'GET')}, headers: ${anyExpression(action.headers ?? {}, manifest)} as Record<string, string>, data: ${anyExpression(action.body, manifest)} });`,
          `${indent}expect([${expectedStatuses.join(', ')}]).toContain(response_${identifier}.status());`,
          `${indent}const body_${identifier} = await response_${identifier}.text().then((text) => { try { return JSON.parse(text) as unknown; } catch { return text; } });`,
          ...Object.entries(action.jsonAssertions ?? {}).map(([path, expected]) => `${indent}expect(readPath(body_${identifier}, ${quote(path)})).toEqual(${JSON.stringify(expected)});`),
          ...(action.outputs === undefined ? [] : [`${indent}stepOutputs[${quote(action.id)}] = { response: { status: response_${identifier}.status(), body: body_${identifier} }, ...Object.fromEntries(Object.entries(${JSON.stringify(action.outputs)}).map(([key, path]) => [key, readPath(body_${identifier}, path as string)])) };`]),
        ];
      }
    case 'control.if':
      return [`${indent}if (resolveCondition(${quote(action.condition ?? '')})) {`];
    case 'control.forEach':
      return [`${indent}for (const ${safeIdentifier(action.variable ?? 'item')} of asArray(${anyExpression(action.items ?? [], manifest)})) {`];
    case 'control.switch':
      return [`${indent}switch (${valueExpression(action.value ?? '', manifest)}) {`];
    case 'control.for':
      return [`${indent}for (let ${safeIdentifier(action.variable ?? 'index')} = ${action.from ?? 0}; ${safeIdentifier(action.variable ?? 'index')} < ${action.to ?? 0}; ${safeIdentifier(action.variable ?? 'index')} += ${action.step ?? 1}) {`];
    case 'control.while':
      return [`${indent}let whileAttempts = 0;`, `${indent}while (whileAttempts < ${action.maxAttempts ?? 30} && resolveCondition(${quote(action.condition ?? '')})) {`];
    case 'control.retry':
      return [`${indent}for (let attempt = 1; attempt <= ${action.maxAttempts ?? 3}; attempt += 1) {`, `${indent}  try {`];
    case 'control.try':
      return [`${indent}try {`];
    case 'control.timeout':
      return [`${indent}await Promise.race([`, `${indent}  (async () => {`];
    case 'control.parallel':
      return [`${indent}await Promise.all([`];
    case 'control.race':
      return [`${indent}await Promise.race([`];
    case 'control.waitUntil':
      return [`${indent}for (let waitAttempt = 1; waitAttempt <= ${action.maxAttempts ?? 30}; waitAttempt += 1) {`, `${indent}  if (resolveCondition(${quote(action.condition ?? '')})) break;`, `${indent}  await new Promise((resolve) => setTimeout(resolve, ${action.pollMs ?? 250}));`, `${indent}}`];
    case 'control.break':
      return [`${indent}break;`];
    case 'control.continue':
      return [`${indent}continue;`];
    case 'control.return':
      return [`${indent}return;`];
    case 'control.set':
      return [`${indent}vars[${quote(action.variable ?? action.name ?? action.id)}] = ${anyExpression(action.value ?? '', manifest)};`];
    case 'control.call':
      return [`${indent}await callFunction(${quote(action.functionName ?? action.name ?? action.id)}, resolveAny(${JSON.stringify(action.arguments ?? {})}) as Record<string, unknown>);`];
    case 'custom.action':
      return [`${indent}stepOutputs[${quote(action.id)}] = await customAction(${quote(action.actionType ?? action.name ?? action.id)}, ${JSON.stringify(action.input ?? {})});`];
    default:
      throw new Error(`Unsupported action type: ${action.type}`);
  }
}

function safeIdentifier(value: string): string { const normalized = value.replace(/[^A-Za-z0-9_$]/g, '_'); return /^[A-Za-z_$]/.test(normalized) ? normalized : `value_${normalized}`; }

function appendAction(lines: string[], sourceMap: SourceMapNode[], action: ManifestAction, manifest: Manifest, indent: string): void {
  const startLine = lines.length + 1;
  lines.push(`${indent}// testpilot:action ${action.id}`);
  if (action.type === 'control.if') {
    lines.push(...actionLines(action, manifest, indent));
    for (const child of action.children ?? []) appendAction(lines, sourceMap, child, manifest, `${indent}  `);
    lines.push(`${indent}} else {`);
    for (const child of action.elseChildren ?? []) appendAction(lines, sourceMap, child, manifest, `${indent}  `);
    lines.push(`${indent}}`);
  } else if (action.type === 'control.forEach') {
    lines.push(...actionLines(action, manifest, indent));
    lines.push(`${indent}  vars[${quote(action.variable ?? 'item')}] = ${safeIdentifier(action.variable ?? 'item')};`);
    for (const child of action.children ?? []) appendAction(lines, sourceMap, child, manifest, `${indent}  `);
    lines.push(`${indent}}`);
  } else if (action.type === 'control.switch') {
    lines.push(...actionLines(action, manifest, indent));
    for (const [caseValue, children] of Object.entries(action.cases ?? {})) {
      lines.push(`${indent}  case ${quote(caseValue)}:`);
      for (const child of children) appendAction(lines, sourceMap, child, manifest, `${indent}    `);
      lines.push(`${indent}    break;`);
    }
    if ((action.defaultChildren ?? []).length > 0) {
      lines.push(`${indent}  default:`);
      for (const child of action.defaultChildren ?? []) appendAction(lines, sourceMap, child, manifest, `${indent}    `);
    }
    lines.push(`${indent}}`);
  } else if (action.type === 'control.for') {
    lines.push(...actionLines(action, manifest, indent));
    lines.push(`${indent}  vars[${quote(action.variable ?? 'index')}] = ${safeIdentifier(action.variable ?? 'index')};`);
    for (const child of action.children ?? []) appendAction(lines, sourceMap, child, manifest, `${indent}  `);
    lines.push(`${indent}}`);
  } else if (action.type === 'control.while') {
    lines.push(...actionLines(action, manifest, indent));
    for (const child of action.children ?? []) appendAction(lines, sourceMap, child, manifest, `${indent}  `);
    lines.push(`${indent}  whileAttempts += 1;`);
    lines.push(`${indent}}`);
  } else if (action.type === 'control.retry') {
    lines.push(...actionLines(action, manifest, indent));
    for (const child of action.children ?? []) appendAction(lines, sourceMap, child, manifest, `${indent}    `);
    lines.push(`${indent}  } catch (error) {`);
    lines.push(`${indent}    if (attempt === ${action.maxAttempts ?? 3}) throw error;`);
    lines.push(`${indent}    await new Promise((resolve) => setTimeout(resolve, ${action.backoffMs ?? 0}));`);
    lines.push(`${indent}  }`);
    lines.push(`${indent}}`);
  } else if (action.type === 'control.try') {
    lines.push(...actionLines(action, manifest, indent));
    for (const child of action.children ?? []) appendAction(lines, sourceMap, child, manifest, `${indent}  `);
    if ((action.catch ?? []).length > 0) {
      lines.push(`${indent}} catch (error) {`);
      for (const child of action.catch ?? []) appendAction(lines, sourceMap, child, manifest, `${indent}  `);
    }
    if ((action.finally ?? []).length > 0) {
      lines.push(`${indent}} finally {`);
      for (const child of action.finally ?? []) appendAction(lines, sourceMap, child, manifest, `${indent}  `);
    }
    lines.push(`${indent}}`);
  } else if (action.type === 'control.timeout') {
    lines.push(...actionLines(action, manifest, indent));
    for (const child of action.children ?? []) appendAction(lines, sourceMap, child, manifest, `${indent}    `);
    lines.push(`${indent}  })(),`);
    lines.push(`${indent}  new Promise((_, reject) => setTimeout(() => reject(new Error('Manifest timeout exceeded')), ${action.timeoutMs ?? 15_000})),`);
    lines.push(`${indent}]);`);
  } else if (action.type === 'control.parallel' || action.type === 'control.race') {
    lines.push(...actionLines(action, manifest, indent));
    for (const branch of action.branches ?? []) {
      lines.push(`${indent}  (async () => {`);
      for (const child of branch) appendAction(lines, sourceMap, child, manifest, `${indent}    `);
      lines.push(`${indent}  })(),`);
    }
    lines.push(`${indent}]);`);
  } else if (action.type === 'control.waitUntil') {
    const waitLines = actionLines(action, manifest, indent);
    lines.push(...waitLines.slice(0, -1));
    for (const child of action.children ?? []) appendAction(lines, sourceMap, child, manifest, `${indent}  `);
    lines.push(waitLines.at(-1) ?? `${indent}}`);
  } else {
    lines.push(...actionLines(action, manifest, indent));
  }
  sourceMap.push({ nodeId: action.id, kind: 'action', startLine, endLine: lines.length });
}

function appendStep(lines: string[], sourceMap: SourceMapNode[], step: ManifestStep, manifest: Manifest): void {
  const startLine = lines.length + 1;
  lines.push(`  // testpilot:step ${step.id}`);
  for (const action of step.actions) {
    appendAction(lines, sourceMap, action, manifest, '  ');
  }
  const endLine = lines.length;
  sourceMap.push({ nodeId: step.id, kind: 'step', startLine, endLine });
}

export function generatePlaywright(manifest: Manifest, options: GeneratePlaywrightOptions = {}): GeneratedPlaywright {
  const lines: string[] = [
    '// GENERATED FILE — do not edit directly.',
    `// Source: ${manifest.source.path}`,
    `// Regenerate with: pnpm testpilot manifest generate ${manifest.source.path}`,
    "import { test, expect } from '@playwright/test';",
    ...(options.customActionModule === undefined ? [] : [`import customActions from ${quote(options.customActionModule)};`]),
    '',
    'const vars: Record<string, unknown> = {};',
    'const stepOutputs: Record<string, unknown> = {};',
    'const readPath = (value: unknown, path: string): unknown => path.replace(/^\\$\\.?/, "").split(".").filter(Boolean).reduce<unknown>((current, part) => current !== null && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined, value);',
    'const resolveValue = (value: string): string => value.replace(/\\$\\{(env|var|secret|steps):?\\.?([A-Za-z_][A-Za-z0-9_.-]*)\\}/g, (_token, namespace: string, name: string) => { const source = namespace === "steps" ? readPath(stepOutputs, name) : namespace === "var" ? vars[name] ?? process.env[name] : process.env[name]; return source === undefined || source === null ? "" : String(source); });',
    'const resolveAny = (value: unknown): unknown => {',
    '  if (typeof value === "string") { const exact = /^\\$\\{(env|var|secret|steps):?\\.?([A-Za-z_][A-Za-z0-9_.-]*)\\}$/.exec(value); if (exact !== null) { const namespace = exact[1]; const name = exact[2] ?? ""; if (namespace === "steps") return readPath(stepOutputs, name); if (namespace === "var") return vars[name] ?? process.env[name]; return process.env[name]; } return resolveValue(value);',
    '  }',
    '  if (Array.isArray(value)) return value.map(resolveAny);',
    '  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveAny(item)]));',
    '  return value;',
    '};',
    ...(options.customActionModule === undefined ? ['const customAction = async (_type: string, _input: unknown): Promise<unknown> => { throw new Error(`Custom Action is not registered: ${_type}`); };'] : ['const customAction = async (type: string, input: Record<string, unknown>): Promise<unknown> => { const executor = customActions[type]; if (executor === undefined) throw new Error(`Custom Action is not registered: ${type}`); return executor.execute({ runId: "generated", getSecret: async (name: string) => process.env[name], writeArtifact: async () => "generated-artifact" }, resolveAny(input) as Record<string, unknown>); };']),
    'const truthy = (value: unknown): boolean => value !== false && value !== null && value !== undefined && value !== "" && value !== "false" && value !== "0";',
    'const parseConditionValue = (value: string): unknown => {',
    '  const trimmed = value.trim();',
    `  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);`,
    '  if (trimmed === "true") return true;',
    '  if (trimmed === "false") return false;',
    '  if (trimmed === "null") return null;',
    '  const number = Number(trimmed);',
    '  if (trimmed !== "" && Number.isFinite(number)) return number;',
    '  try { return JSON.parse(trimmed) as unknown; } catch { return trimmed; }',
    '};',
    'const resolveCondition = (expression: string): boolean => {',
    '  const evaluateAtom = (atom: string): boolean => {',
    '    const source = resolveValue(atom.trim());',
    '    const match = /^(.+?)\\s*(===|!==|==|!=|>=|<=|>|<)\\s*(.+)$/.exec(source);',
    '    if (match === null) return truthy(parseConditionValue(source));',
    '    const left = parseConditionValue(match[1] ?? "");',
    '    const right = parseConditionValue(match[3] ?? "");',
    '    switch (match[2]) {',
    '      case "===": return left === right;',
    '      case "!==": return left !== right;',
    '      case "==": return left == right;',
    '      case "!=": return left != right;',
    '      case ">": return typeof left === "number" && typeof right === "number" && left > right;',
    '      case "<": return typeof left === "number" && typeof right === "number" && left < right;',
    '      case ">=": return typeof left === "number" && typeof right === "number" && left >= right;',
    '      case "<=": return typeof left === "number" && typeof right === "number" && left <= right;',
      '      default: return false;',
    '    }',
    '  };',
    '  return expression.split(/\\s*\\|\\|\\s*/).some((orPart) => orPart.split(/\\s*&&\\s*/).every(evaluateAtom));',
    '};',
    'const asArray = (value: unknown): unknown[] => { if (Array.isArray(value)) return value; if (typeof value !== "string") return []; try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };',
    '',
    `test(${quote(manifest.name)}, async ({ page, request }) => {`,
  ];
  const sourceMap: SourceMapNode[] = [];
  if ((manifest.functions ?? []).length > 0) {
    lines.push('  const callFunction = async (name: string, args: Record<string, unknown>): Promise<void> => {');
    for (const func of manifest.functions ?? []) {
      lines.push(`    if (name === ${quote(func.id)}) {`);
      lines.push('      const previousVars = { ...vars };');
      lines.push('      try {');
      lines.push('        for (const [name, value] of Object.entries(args)) vars[name] = value;');
      for (const action of func.actions) appendAction(lines, sourceMap, action, manifest, '        ');
      lines.push('      } finally {');
      lines.push('        for (const name of Object.keys(vars)) delete vars[name];');
      lines.push('        Object.assign(vars, previousVars);');
      lines.push('      }');
      lines.push('      return;');
      lines.push('    }');
    }
    lines.push('    throw new Error(`Unknown Manifest function: ${name}`);');
    lines.push('  };');
  } else {
    lines.push('  const callFunction = async (_name: string, _args: Record<string, unknown>): Promise<void> => { throw new Error(`Unknown Manifest function: ${_name}`); };');
  }
  for (const step of [...manifest.setup, ...manifest.steps, ...manifest.cleanup]) {
    appendStep(lines, sourceMap, step, manifest);
    lines.push(`  stepOutputs[${quote(step.id)}] = { ...Object.fromEntries(${JSON.stringify(step.actions.map((action) => action.id))}.flatMap((id) => { const output = stepOutputs[id]; return output !== null && typeof output === 'object' ? Object.entries(output as Record<string, unknown>) : []; })), ...resolveAny(${JSON.stringify(step.output ?? {})}) as Record<string, unknown> };`);
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

function mobileActionLines(action: ManifestAction, indent: string): string[] {
  const selector = quote(action.selector ?? '');
  switch (action.type) {
    case 'mobile.launch':
      return [`${indent}// mobile.launch is represented by the WebdriverIO session above`];
    case 'mobile.tap':
      return [`${indent}await (await browser.$(${selector})).click();`];
    case 'mobile.fill':
      return [`${indent}await (await browser.$(${selector})).setValue(${quote(action.value ?? '')});`];
    case 'mobile.expectVisible':
      return [`${indent}await (await browser.$(${selector})).waitForDisplayed();`];
    case 'mobile.expectText':
      return [`${indent}assert.equal(await (await browser.$(${selector})).getText(), ${quote(action.expectedText ?? '')});`];
    case 'mobile.screenshot':
      return [`${indent}await browser.saveScreenshot(${quote(`artifacts/${action.name ?? action.id}.png`)});`];
    case 'mobile.back':
      return [`${indent}await browser.back();`];
    default:
      throw new Error(`Unsupported mobile action type: ${action.type}`);
  }
}

function appendMobileStep(lines: string[], sourceMap: SourceMapNode[], step: ManifestStep): void {
  const startLine = lines.length + 1;
  lines.push(`  // testpilot:step ${step.id}`);
  for (const action of step.actions) {
    const actionStart = lines.length + 1;
    lines.push(`  // testpilot:action ${action.id}`);
    lines.push(...mobileActionLines(action, '  '));
    sourceMap.push({ nodeId: action.id, kind: 'action', startLine: actionStart, endLine: lines.length });
  }
  sourceMap.push({ nodeId: step.id, kind: 'step', startLine, endLine: lines.length });
}

/** Generate an independently runnable WebdriverIO/Appium TypeScript test. */
export function generateMobileAppium(manifest: Manifest): GeneratedMobileAppium {
  const launch = [...manifest.setup, ...manifest.steps, ...manifest.cleanup]
    .flatMap((step) => step.actions)
    .find((action) => action.type === 'mobile.launch');
  if (launch?.capabilities === undefined) throw new Error('Mobile Manifest requires a mobile.launch action with capabilities');
  const serverUrl = launch.capabilities.serverUrl ?? 'http://127.0.0.1:4723';
  const parsed = new URL(serverUrl);
  const lines: string[] = [
    '// GENERATED FILE — do not edit directly.',
    `// Source: ${manifest.source.path}`,
    `// Regenerate with: pnpm testpilot manifest generate ${manifest.source.path}`,
    "import assert from 'node:assert/strict';",
    "import { remote } from 'webdriverio';",
    '',
    `const browser = await remote({ protocol: ${quote(parsed.protocol.replace(':', ''))}, hostname: ${quote(parsed.hostname)}, port: ${Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))}, path: ${quote(parsed.pathname || '/')}, capabilities: ${mobileCapabilitiesLiteral(launch.capabilities)} });`,
    'try {',
  ];
  const sourceMap: SourceMapNode[] = [];
  for (const step of [...manifest.setup, ...manifest.steps, ...manifest.cleanup]) appendMobileStep(lines, sourceMap, step);
  lines.push('} finally {', '  await browser.deleteSession();', '}', '');
  return {
    code: lines.join('\n'),
    sourceMap: { version: 1, manifestId: manifest.id, generatorVersion, nodes: sourceMap },
    fileName: manifest.generatedCode.path,
  };
}
