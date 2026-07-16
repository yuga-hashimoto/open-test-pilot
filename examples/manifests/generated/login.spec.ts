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

test('ログインできる', async ({ page, request }) => {
  const callFunction = async (_name: string, _args: Record<string, unknown>): Promise<void> => { throw new Error(`Unknown Manifest function: ${_name}`); };
  // testpilot:step login
  // testpilot:action open-login
  await page.goto(process.env['BASE_URL'] ? process.env['BASE_URL'] + '/login' : 'http://127.0.0.1:4173/login');
  // testpilot:action fill-email
  await page.getByLabel('メールアドレス').fill('test@example.com');
  // testpilot:action submit-login
  await page.getByRole('button', { name: 'ログイン' }).click();
  // testpilot:action assert-dashboard
  await expect(page.locator('[data-testid=dashboard]')).toBeVisible();
  stepOutputs['login'] = { ...Object.fromEntries(["open-login","fill-email","submit-login","assert-dashboard"].flatMap((id) => { const output = stepOutputs[id]; return output !== null && typeof output === 'object' ? Object.entries(output as Record<string, unknown>) : []; })), ...resolveAny({}) as Record<string, unknown> };
});
