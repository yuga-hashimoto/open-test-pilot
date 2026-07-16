import { test, expect } from '@playwright/test';

const vars: Record<string, unknown> = {};
const stepOutputs: Record<string, unknown> = {};
const readPath = (value: unknown, path: string): unknown => path.replace(/^\$\.?/, "").split(".").filter(Boolean).reduce<unknown>((current, part) => current !== null && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined, value);
const resolveValue = (value: string): string => value.replace(/\$\{(env|var|secret|steps):?\.?([A-Za-z_][A-Za-z0-9_.-]*)\}/g, (_token, namespace: string, name: string) => { const source = namespace === "steps" ? readPath(stepOutputs, name) : namespace === "var" ? vars[name] ?? process.env[name] : process.env[name]; return source === undefined || source === null ? "" : String(source); });
const resolveAny = (value: unknown): unknown => {
  if (typeof value === "string") { const exact = /^\$\{(env|var|secret|steps):?\.?([A-Za-z_][A-Za-z0-9_.-]*)\}$/.exec(value); if (exact !== null) { const namespace = exact[1]; const name = exact[2] ?? ""; if (namespace === "steps") return readPath(stepOutputs, name); if (namespace === "var") return vars[name] ?? process.env[name]; return process.env[name]; } return resolveValue(value);
  }
  if (Array.isArray(value)) return value.map(resolveAny);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveAny(item)]));
  return value;
};
const customAction = async (_type: string, _input: unknown): Promise<unknown> => { throw new Error(`Custom Action is not registered: ${_type}`); };
const truthy = (value: unknown): boolean => value !== false && value !== null && value !== undefined && value !== "" && value !== "false" && value !== "0";
const parseConditionValue = (value: string): unknown => {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  const number = Number(trimmed);
  if (trimmed !== "" && Number.isFinite(number)) return number;
  try { return JSON.parse(trimmed) as unknown; } catch { return trimmed; }
};
const resolveCondition = (expression: string): boolean => {
  const evaluateAtom = (atom: string): boolean => {
    const source = resolveValue(atom.trim());
    const match = /^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/.exec(source);
    if (match === null) return truthy(parseConditionValue(source));
    const left = parseConditionValue(match[1] ?? "");
    const right = parseConditionValue(match[3] ?? "");
    switch (match[2]) {
      case "===": return left === right;
      case "!==": return left !== right;
      case "==": return left == right;
      case "!=": return left != right;
      case ">": return typeof left === "number" && typeof right === "number" && left > right;
      case "<": return typeof left === "number" && typeof right === "number" && left < right;
      case ">=": return typeof left === "number" && typeof right === "number" && left >= right;
      case "<=": return typeof left === "number" && typeof right === "number" && left <= right;
      default: return false;
    }
  };
  return expression.split(/\s*\|\|\s*/).some((orPart) => orPart.split(/\s*&&\s*/).every(evaluateAtom));
};
const asArray = (value: unknown): unknown[] => { if (Array.isArray(value)) return value; if (typeof value !== "string") return []; try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };

test('API and Web complex flow', async ({ page, request }) => {
  const callFunction = async (name: string, args: Record<string, unknown>): Promise<void> => {
    if (name === 'verify-dashboard') {
      const previousVars = { ...vars };
      try {
        for (const [name, value] of Object.entries(args)) vars[name] = value;
        // testpilot:action function-dashboard
        await expect(page.locator('[data-testid=dashboard]')).toBeVisible();
      } finally {
        for (const name of Object.keys(vars)) delete vars[name];
        Object.assign(vars, previousVars);
      }
      return;
    }
    throw new Error(`Unknown Manifest function: ${name}`);
  };
  // testpilot:step create-user
  // testpilot:action create-user-request
  const response_create_user_request = await request.fetch('http://127.0.0.1:4173/api/test-user', { method: 'GET', headers: resolveAny({}) as Record<string, string>, data: resolveAny(undefined) });
  expect([200]).toContain(response_create_user_request.status());
  const body_create_user_request = await response_create_user_request.text().then((text) => { try { return JSON.parse(text) as unknown; } catch { return text; } });
  expect(readPath(body_create_user_request, 'email')).toEqual("test@example.com");
  stepOutputs['create-user-request'] = { response: { status: response_create_user_request.status(), body: body_create_user_request }, ...Object.fromEntries(Object.entries({"email":"$.email","password":"$.password"}).map(([key, path]) => [key, readPath(body_create_user_request, path as string)])) };
  stepOutputs['create-user'] = { ...Object.fromEntries(["create-user-request"].flatMap((id) => { const output = stepOutputs[id]; return output !== null && typeof output === 'object' ? Object.entries(output as Record<string, unknown>) : []; })), ...resolveAny({}) as Record<string, unknown> };
  // testpilot:step login
  // testpilot:action open-login
  await page.goto('http://127.0.0.1:4173/login');
  // testpilot:action fill-email
  await page.getByLabel('メールアドレス').fill(resolveValue('${steps.create-user.email}'));
  // testpilot:action submit-login
  await page.getByRole('button', { name: 'ログイン' }).click();
  // testpilot:action assert-dashboard
  await expect(page.locator('[data-testid=dashboard]')).toBeVisible();
  stepOutputs['login'] = { ...Object.fromEntries(["open-login","fill-email","submit-login","assert-dashboard"].flatMap((id) => { const output = stepOutputs[id]; return output !== null && typeof output === 'object' ? Object.entries(output as Record<string, unknown>) : []; })), ...resolveAny({}) as Record<string, unknown> };
  // testpilot:step branch-and-loop
  // testpilot:action logged-in-branch
  if (resolveCondition('${steps.create-user.email} == test@example.com')) {
    // testpilot:action branch-dashboard
    await expect(page.locator('[data-testid=dashboard]')).toBeVisible();
  } else {
    // testpilot:action branch-failure
    await expect(page.locator('#missing')).toBeVisible();
  }
  // testpilot:action list-products
  const response_list_products = await request.fetch('http://127.0.0.1:4173/api/products', { method: 'GET', headers: resolveAny({}) as Record<string, string>, data: resolveAny(undefined) });
  expect([200]).toContain(response_list_products.status());
  const body_list_products = await response_list_products.text().then((text) => { try { return JSON.parse(text) as unknown; } catch { return text; } });
  stepOutputs['list-products'] = { response: { status: response_list_products.status(), body: body_list_products }, ...Object.fromEntries(Object.entries({"items":"$"}).map(([key, path]) => [key, readPath(body_list_products, path as string)])) };
  // testpilot:action record-products
  for (const product of asArray(resolveAny('${steps.list-products.items}'))) {
    vars['product'] = product;
    // testpilot:action record-product
    stepOutputs['record-product'] = await customAction('example.record-product', {"product":"${var.product}"});
  }
  stepOutputs['branch-and-loop'] = { ...Object.fromEntries(["logged-in-branch","list-products","record-products"].flatMap((id) => { const output = stepOutputs[id]; return output !== null && typeof output === 'object' ? Object.entries(output as Record<string, unknown>) : []; })), ...resolveAny({}) as Record<string, unknown> };
  // testpilot:step parallel-checks
  // testpilot:action parallel
  await Promise.all([
    (async () => {
      // testpilot:action health
      const response_health = await request.fetch('http://127.0.0.1:4173/api/health', { method: 'GET', headers: resolveAny({}) as Record<string, string>, data: resolveAny(undefined) });
      expect([200]).toContain(response_health.status());
      const body_health = await response_health.text().then((text) => { try { return JSON.parse(text) as unknown; } catch { return text; } });
      expect(readPath(body_health, 'ok')).toEqual(true);
    })(),
    (async () => {
      // testpilot:action products-again
      const response_products_again = await request.fetch('http://127.0.0.1:4173/api/products', { method: 'GET', headers: resolveAny({}) as Record<string, string>, data: resolveAny(undefined) });
      expect([200]).toContain(response_products_again.status());
      const body_products_again = await response_products_again.text().then((text) => { try { return JSON.parse(text) as unknown; } catch { return text; } });
    })(),
  ]);
  stepOutputs['parallel-checks'] = { ...Object.fromEntries(["parallel"].flatMap((id) => { const output = stepOutputs[id]; return output !== null && typeof output === 'object' ? Object.entries(output as Record<string, unknown>) : []; })), ...resolveAny({}) as Record<string, unknown> };
  // testpilot:step cleanup-flow
  // testpilot:action try-cleanup
  try {
    // testpilot:action cleanup-check
    await expect(page.locator('[data-testid=dashboard]')).toBeVisible();
  } finally {
    // testpilot:action delete-user
    const response_delete_user = await request.fetch('http://127.0.0.1:4173/api/delete-user', { method: 'GET', headers: resolveAny({}) as Record<string, string>, data: resolveAny(undefined) });
    expect([204]).toContain(response_delete_user.status());
    const body_delete_user = await response_delete_user.text().then((text) => { try { return JSON.parse(text) as unknown; } catch { return text; } });
  }
  // testpilot:action call-function
  await callFunction('verify-dashboard', resolveAny({}) as Record<string, unknown>);
  stepOutputs['cleanup-flow'] = { ...Object.fromEntries(["try-cleanup","call-function"].flatMap((id) => { const output = stepOutputs[id]; return output !== null && typeof output === 'object' ? Object.entries(output as Record<string, unknown>) : []; })), ...resolveAny({}) as Record<string, unknown> };
});
