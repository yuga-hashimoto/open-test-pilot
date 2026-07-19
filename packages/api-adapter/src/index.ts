import { Ajv } from 'ajv';
import type { ErrorObject, ValidateFunction } from 'ajv';

export type ApiCaptureMode = 'none' | 'on-failure' | 'always';

export interface ApiAction {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus?: number | number[];
  jsonAssertions?: Record<string, unknown>;
  query?: Record<string, string | number | boolean | null | undefined>;
  pathParams?: Record<string, string | number | boolean>;
  contentType?: string;
  assertHeaders?: Record<string, string>;
  responseSchema?: Record<string, unknown>;
  timeoutMs?: number;
  capture?: ApiCaptureMode;
  allowedHosts?: string[];
}

export interface ApiResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
  capture?: ApiCaptureMode;
}

export interface ApiTransportRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ApiTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  durationMs?: number;
}

export interface ApiTransport {
  request(input: ApiTransportRequest): Promise<ApiTransportResponse>;
}

export interface ApiExecutionContext {
  transport?: ApiTransport;
  fetcher?: typeof fetch;
  allowedHosts?: string[];
}

export interface ApiPolicyOptions {
  allowedHosts?: string[];
}

const schemaValidatorCache = new WeakMap<object, ValidateFunction>();
const ajv = new Ajv({ allErrors: true, strict: false });

export function readApiPath(value: unknown, path: string): unknown {
  const normalized = normalizeApiPath(path);
  if (normalized === '') return value;
  return normalized.split('.').reduce<unknown>((current, part) => {
    if (current === null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

export function assertJsonSchema(value: unknown, schema: unknown): void {
  if (schema === null || typeof schema !== 'object') {
    throw new Error('API response schema must be an object');
  }
  const schemaObject = schema as object;
  let validate = schemaValidatorCache.get(schemaObject);
  if (!validate) {
    validate = ajv.compile(schemaObject);
    schemaValidatorCache.set(schemaObject, validate);
  }
  if (!validate(value)) {
    const details = formatAjvErrors(validate.errors);
    throw new Error(`API response schema assertion failed${details}`);
  }
}

export function assertApiPolicy(url: string, options: ApiPolicyOptions = {}): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`API host policy rejected invalid URL: ${url}`);
  }
  const rawHost = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const host = normalizeHostForPolicy(rawHost);
  const allowed = options.allowedHosts?.map((entry) => normalizeHostForPolicy(entry.toLowerCase().replace(/^\[|\]$/g, '')));
  if (allowed && allowed.length > 0 && !hostMatchesAllowlist(host, allowed)) {
    throw new Error(`API host policy rejected host not in allowlist: ${rawHost}`);
  }
  if (isBlockedHost(rawHost) && !(allowed && hostMatchesAllowlist(host, allowed))) {
    throw new Error(`API host policy blocked dangerous host: ${rawHost}`);
  }
}

export async function executeApiAction(
  action: ApiAction,
  fetcherOrContext: typeof fetch | ApiExecutionContext = fetch,
): Promise<ApiResult> {
  const context = normalizeContext(fetcherOrContext);
  const started = Date.now();
  const resolvedUrl = buildRequestUrl(action.url, action.pathParams, action.query);
  const policyHosts = action.allowedHosts ?? context.allowedHosts;
  assertApiPolicy(resolvedUrl, policyHosts === undefined ? {} : { allowedHosts: policyHosts });

  const { headers, body } = buildRequestPayload(action);
  const signal = action.timeoutMs === undefined ? undefined : AbortSignal.timeout(action.timeoutMs);

  let status: number;
  let responseHeaders: Record<string, string>;
  let responseBody: unknown;
  let durationMs: number;

  try {
    if (context.transport) {
      const transportResult = await context.transport.request({
        method: action.method,
        url: resolvedUrl,
        ...(headers === undefined ? {} : { headers }),
        ...(body === undefined ? {} : { body }),
        ...(action.timeoutMs === undefined ? {} : { timeoutMs: action.timeoutMs }),
        ...(signal === undefined ? {} : { signal }),
      });
      status = transportResult.status;
      responseHeaders = normalizeHeaderRecord(transportResult.headers);
      responseBody = transportResult.body;
      durationMs = transportResult.durationMs ?? Date.now() - started;
    } else {
      const fetcher = context.fetcher ?? fetch;
      const response = await fetcher(resolvedUrl, {
        method: action.method,
        ...(headers === undefined ? {} : { headers }),
        ...(body === undefined ? {} : { body }),
        ...(signal === undefined ? {} : { signal }),
      });
      status = response.status;
      responseHeaders = Object.fromEntries(response.headers.entries());
      const contentType = response.headers.get('content-type') ?? '';
      responseBody = contentType.includes('json') ? await response.json() : await response.text();
      durationMs = Date.now() - started;
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`API request timeout after ${action.timeoutMs ?? 0}ms`);
    }
    throw error;
  }

  const expected = action.expectedStatus === undefined
    ? [200]
    : Array.isArray(action.expectedStatus)
      ? action.expectedStatus
      : [action.expectedStatus];
  if (!expected.includes(status)) {
    throw new Error(`API expected status ${expected.join(',')} but received ${status}`);
  }

  for (const [headerName, expectedValue] of Object.entries(action.assertHeaders ?? {})) {
    const actual = findHeaderValue(responseHeaders, headerName);
    if (actual === undefined || !headerValueMatches(headerName, actual, expectedValue)) {
      throw new Error(`API header assertion failed for ${headerName}: expected ${expectedValue} but received ${actual ?? '<missing>'}`);
    }
  }

  if (action.responseSchema !== undefined) {
    assertJsonSchema(responseBody, action.responseSchema);
  }

  for (const [path, expectedValue] of Object.entries(action.jsonAssertions ?? {})) {
    if (readApiPath(responseBody, path) !== expectedValue) {
      throw new Error(`API JSON assertion failed at ${path}`);
    }
  }

  return {
    status,
    headers: responseHeaders,
    body: responseBody,
    durationMs,
    ...(action.capture === undefined ? {} : { capture: action.capture }),
  };
}

function normalizeContext(fetcherOrContext: typeof fetch | ApiExecutionContext): ApiExecutionContext {
  if (typeof fetcherOrContext === 'function') {
    return { fetcher: fetcherOrContext };
  }
  return fetcherOrContext;
}

function buildRequestUrl(
  rawUrl: string,
  pathParams?: Record<string, string | number | boolean>,
  query?: Record<string, string | number | boolean | null | undefined>,
): string {
  let url = rawUrl;
  for (const [key, value] of Object.entries(pathParams ?? {})) {
    url = url.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
  }
  if (query === undefined || Object.keys(query).length === 0) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const queryString = params.toString();
  if (queryString === '') return url;
  return url.includes('?') ? `${url}&${queryString}` : `${url}?${queryString}`;
}

function buildRequestPayload(action: ApiAction): { headers?: Record<string, string>; body?: string } {
  const explicitContentType = action.contentType ?? findHeaderValue(action.headers ?? {}, 'content-type');
  const headers: Record<string, string> = { ...(action.headers ?? {}) };

  if (action.body === undefined) {
    if (action.contentType !== undefined && !hasHeader(headers, 'content-type')) {
      headers['content-type'] = action.contentType;
    }
    return Object.keys(headers).length === 0 ? {} : { headers };
  }

  const effectiveType = (explicitContentType ?? '').toLowerCase();
  let body: string;
  if (effectiveType.includes('application/x-www-form-urlencoded')) {
    body = bodyToUrlSearchParams(action.body).toString();
    if (!hasHeader(headers, 'content-type')) headers['content-type'] = action.contentType ?? 'application/x-www-form-urlencoded';
  } else if (effectiveType.includes('text/')) {
    body = typeof action.body === 'string' ? action.body : String(action.body);
    if (!hasHeader(headers, 'content-type') && action.contentType !== undefined) {
      headers['content-type'] = action.contentType;
    }
  } else if (effectiveType.includes('application/json') || explicitContentType === undefined) {
    // Backward compat: without an explicit contentType, always JSON.stringify (objects and strings).
    body = JSON.stringify(action.body);
    if (!hasHeader(headers, 'content-type')) headers['content-type'] = action.contentType ?? 'application/json';
  } else if (typeof action.body === 'string') {
    body = action.body;
    if (!hasHeader(headers, 'content-type') && action.contentType !== undefined) {
      headers['content-type'] = action.contentType;
    }
  } else {
    body = JSON.stringify(action.body);
    if (!hasHeader(headers, 'content-type')) headers['content-type'] = action.contentType ?? 'application/json';
  }

  return { headers, body };
}

function bodyToUrlSearchParams(body: unknown): URLSearchParams {
  if (body instanceof URLSearchParams) return body;
  if (typeof body === 'string') return new URLSearchParams(body);
  const params = new URLSearchParams();
  if (body !== null && typeof body === 'object') {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }
  }
  return params;
}

function normalizeApiPath(path: string): string {
  if (path.startsWith('$.')) return path.slice(2);
  if (path.startsWith('$')) return path.slice(1);
  return path;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return '';
  return `: ${errors.map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`).join('; ')}`;
}

function isBlockedHost(host: string): boolean {
  const normalized = normalizeHostForPolicy(host);
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (isIpv4(normalized)) {
    const parts = normalized.split('.').map((part) => Number(part));
    const [a = -1, b = -1] = parts;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

function normalizeHostForPolicy(host: string): string {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, '');
  // Node URL normalizes ::ffff:127.0.0.1 → ::ffff:7f00:1 (brackets stripped above).
  const mapped = bare.match(/^(?:(?:0:){0,5}|::)ffff:(.+)$/);
  if (!mapped?.[1]) return bare;
  const suffix = mapped[1];
  if (isIpv4(suffix)) return suffix;
  const hex = suffix.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex?.[1] || !hex[2]) return bare;
  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isIpv4(host: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
}

function hostMatchesAllowlist(host: string, allowedHosts: string[]): boolean {
  return allowedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function findHeaderValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function headerValueMatches(headerName: string, actual: string, expected: string): boolean {
  if (headerName.toLowerCase() === 'content-type') {
    const actualMedia = actual.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    const expectedMedia = expected.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    return actualMedia === expectedMedia;
  }
  return actual.toLowerCase() === expected.toLowerCase();
}

function normalizeHeaderRecord(headers: Record<string, string>): Record<string, string> {
  return { ...headers };
}

function isAbortError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const name = 'name' in error ? String((error as { name?: unknown }).name) : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message) : '';
  return name === 'AbortError' || name === 'TimeoutError' || /abort|timeout/i.test(message);
}
