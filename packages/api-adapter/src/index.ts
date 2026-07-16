export interface ApiAction { method: string; url: string; headers?: Record<string, string>; body?: unknown; expectedStatus?: number | number[]; jsonAssertions?: Record<string, unknown>; }
export interface ApiResult { status: number; headers: Record<string, string>; body: unknown; durationMs: number; }

export async function executeApiAction(action: ApiAction, fetcher: typeof fetch = fetch): Promise<ApiResult> {
  const started = Date.now();
  const response = await fetcher(action.url, { method: action.method, ...(action.headers === undefined ? {} : { headers: action.headers }), ...(action.body === undefined ? {} : { body: JSON.stringify(action.body) }) });
  const contentType = response.headers.get('content-type') ?? '';
  const body: unknown = contentType.includes('json') ? await response.json() : await response.text();
  const expected = action.expectedStatus === undefined ? [200] : Array.isArray(action.expectedStatus) ? action.expectedStatus : [action.expectedStatus];
  if (!expected.includes(response.status)) throw new Error(`API expected status ${expected.join(',')} but received ${response.status}`);
  for (const [path, expectedValue] of Object.entries(action.jsonAssertions ?? {})) if (readPath(body, path) !== expectedValue) throw new Error(`API JSON assertion failed at ${path}`);
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body, durationMs: Date.now() - started };
}

function readPath(value: unknown, path: string): unknown { return path.split('.').reduce<unknown>((current, part) => current !== null && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined, value); }
