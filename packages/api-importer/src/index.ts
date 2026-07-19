import { parse as parseYaml } from 'yaml';
import type { Manifest, ManifestAction, ManifestSecretRef, ManifestStep } from '@open-test-pilot/manifest-schema';

export interface ApiImportOptions {
  baseUrl?: string;
  id?: string;
  name?: string;
  repository?: string;
  generatedCodePath?: string;
}

export interface ImportedOperation { id: string; method: string; path: string; source: 'openapi' | 'postman'; }
export interface ApiImportResult { manifest: Manifest; operations: ImportedOperation[]; warnings: string[]; }
type AnyRecord = any;

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

export function importOpenApi(source: string | unknown, options: ApiImportOptions = {}): ApiImportResult {
  const document = asDocument(source);
  if (typeof document.openapi !== 'string' || !document.openapi.startsWith('3.')) throw new Error('OpenAPI 3.0 or 3.1 document is required');
  rejectRemoteRefs(document);
  const baseUrl = options.baseUrl ?? String(document.servers?.[0]?.url ?? 'http://localhost');
  const secrets: ManifestSecretRef[] = [];
  const globalSecurity = document.security;
  const steps: ManifestStep[] = [];
  const operations: ImportedOperation[] = [];
  for (const [path, pathItem] of Object.entries<AnyRecord>(document.paths ?? {})) {
    const pathParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    for (const [method, operation] of Object.entries<AnyRecord>(pathItem)) {
      if (!HTTP_METHODS.has(method) || operation === null || typeof operation !== 'object') continue;
      const op = resolveRef(operation, document);
      const id = String(op.operationId ?? `${method}-${path.replace(/[^A-Za-z0-9]+/g, '-')}`);
      const parameters = [...pathParameters, ...(Array.isArray(op.parameters) ? op.parameters : [])].map((value) => resolveRef(value, document));
      const pathParams: Record<string, string | number | boolean> = {};
      const query: Record<string, string | number | boolean> = {};
      for (const parameter of parameters) {
        if (!parameter?.name || !parameter.in) continue;
        const value = parameter.example ?? parameter.examples?.default?.value ?? parameter.schema?.example ?? parameter.schema?.default ?? sampleFromSchema(resolveRef(parameter.schema, document));
        if (value === undefined) continue;
        if (parameter.in === 'path') pathParams[parameter.name] = value;
        if (parameter.in === 'query') query[parameter.name] = value;
      }
      const responseStatus = firstSuccessStatus(resolveRef(op.responses ?? {}, document));
      const response = resolveRef((op.responses ?? {})[responseStatus] ?? {}, document);
      const responseSchema = schemaFromContent(response, document);
      const action: ManifestAction = {
        id,
        type: 'api.request',
        method: method.toUpperCase(),
        url: joinUrl(baseUrl, path),
        ...(Object.keys(pathParams).length === 0 ? {} : { pathParams }),
        ...(Object.keys(query).length === 0 ? {} : { query }),
        ...(Object.keys(pathParams).length === 0 && Object.keys(query).length === 0 ? {} : {}),
        expectedStatus: Number(responseStatus),
        ...(responseSchema === undefined ? {} : { responseSchema }),
        allowedHosts: hostAllowlist(joinUrl(baseUrl, path)),
      };
      addRequestBody(action, op.requestBody, document);
      applySecurity(action, op.security ?? globalSecurity, document, secrets);
      steps.push({ id: `step-${id}`, title: op.summary ?? id, actions: [action] });
      operations.push({ id, method: method.toUpperCase(), path, source: 'openapi' });
    }
  }
  return buildResult(steps, operations, secrets, options, 'openapi', document.info?.title ?? 'OpenAPI API tests');
}

export function importPostmanCollection(source: string | unknown, options: ApiImportOptions = {}): ApiImportResult {
  const collection = asDocument(source);
  const variables = Object.fromEntries((collection.variable ?? []).map((item: AnyRecord) => [String(item.key), item.value]));
  const secrets: ManifestSecretRef[] = [];
  const steps: ManifestStep[] = [];
  const operations: ImportedOperation[] = [];
  const requests: AnyRecord[] = [];
  collectPostmanRequests(collection.item ?? [], requests);
  for (const [index, entry] of requests.entries()) {
    const request = entry.request ?? {};
    const method = String(request.method ?? 'GET').toUpperCase();
    const rawUrl = typeof request.url === 'string' ? request.url : String(request.url?.raw ?? buildPostmanUrl(request.url));
    const resolvedUrl = replacePostmanVariables(rawUrl, variables, secrets);
    const action: ManifestAction = { id: slug(String(entry.name ?? `request-${index + 1}`)), type: 'api.request', method, url: resolvedUrl, allowedHosts: hostAllowlist(resolvedUrl) };
    if (request.header) action.headers = Object.fromEntries(request.header.filter((header: AnyRecord) => header.disabled !== true && header.key).map((header: AnyRecord) => [String(header.key), replacePostmanVariables(String(header.value ?? ''), variables, secrets)]));
    if (request.body?.mode === 'raw' && request.body.raw !== undefined) {
      const raw = replacePostmanVariables(String(request.body.raw), variables, secrets);
      try { action.body = JSON.parse(raw); action.contentType = 'application/json'; } catch { action.body = raw; action.contentType = 'text/plain'; }
    }
    applyPostmanAuth(action, request.auth, variables, secrets);
    steps.push({ id: `step-${action.id}`, title: String(entry.name ?? action.id), actions: [action] });
    operations.push({ id: action.id, method, path: resolvedUrl, source: 'postman' });
  }
  return buildResult(steps, operations, secrets, options, 'postman', collection.info?.name ?? 'Postman API tests');
}

function buildResult(steps: ManifestStep[], operations: ImportedOperation[], secrets: ManifestSecretRef[], options: ApiImportOptions, source: 'openapi' | 'postman', fallbackName: string): ApiImportResult {
  const id = options.id ?? `${source}-import`;
  return {
    manifest: {
      schemaVersion: '1.0.0', id, name: options.name ?? fallbackName, description: `Imported ${source} API operations`, type: 'api', tags: ['api', 'imported', source], priority: 'normal', preconditions: [], variables: [], secrets, setup: [], steps, cleanup: [], artifacts: { screenshots: 'none', traces: false }, runner: { minBrowsers: [] }, permissions: { networkAccess: true }, source: { repository: options.repository ?? 'local', path: `${source}-import` }, generatedCode: { path: options.generatedCodePath ?? `generated/${id}.spec.ts` },
    }, operations, warnings: [],
  };
}

function asDocument(source: string | unknown): AnyRecord { return typeof source === 'string' ? (parseYaml(source) as AnyRecord) : source as AnyRecord; }
function joinUrl(base: string, path: string): string { return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`; }
function hostAllowlist(url: string): string[] { try { return [new URL(url).hostname]; } catch { return []; } }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'api-request'; }
function firstSuccessStatus(responses: AnyRecord): string { return Object.keys(responses).find((key) => /^2\d\d$/.test(key)) ?? '200'; }

function resolveRef(value: any, root: AnyRecord): any {
  if (!value || typeof value !== 'object' || typeof value.$ref !== 'string') return value;
  if (!value.$ref.startsWith('#/')) throw new Error(`External or remote $ref is not allowed: ${value.$ref}`);
  return value.$ref.slice(2).split('/').reduce((current: any, part: string) => current?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], root);
}

function rejectRemoteRefs(value: unknown): void {
  if (value && typeof value === 'object') for (const child of Object.values(value as AnyRecord)) {
    const candidate = child as any;
    if (candidate && typeof candidate === 'object' && typeof candidate.$ref === 'string' && !candidate.$ref.startsWith('#/')) throw new Error(`External or remote $ref is not allowed: ${candidate.$ref}`);
    rejectRemoteRefs(child);
  }
}

function sampleFromSchema(schema: AnyRecord | undefined): any {
  if (!schema) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.[0] !== undefined) return schema.enum[0];
  if (schema.type === 'integer' || schema.type === 'number') return 1;
  if (schema.type === 'boolean') return true;
  if (schema.type === 'array') return [sampleFromSchema(schema.items)];
  if (schema.type === 'object' || schema.properties) return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [key, sampleFromSchema(value as AnyRecord)]).filter(([, value]) => value !== undefined));
  return 'example';
}

function schemaFromContent(response: AnyRecord, root: AnyRecord): AnyRecord | undefined {
  const content = response?.content;
  const media = content?.['application/json'] ?? Object.values(content ?? {})[0];
  if (!media?.schema) return undefined;
  return resolveSchema(media.schema, root);
}
function resolveSchema(value: any, root: AnyRecord): any { if (!value || typeof value !== 'object') return value; const resolved = resolveRef(value, root); if (resolved !== value) return resolveSchema(resolved, root); if (Array.isArray(value)) return value.map((item) => resolveSchema(item, root)); return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveSchema(child, root)])); }
function addRequestBody(action: ManifestAction, requestBody: AnyRecord | undefined, root: AnyRecord): void { if (!requestBody) return; const resolved = resolveRef(requestBody, root); const content = resolved.content ?? {}; const mediaType = content['application/json'] ? 'application/json' : Object.keys(content)[0]; if (!mediaType) return; const media = content[mediaType]; if (media.example !== undefined) action.body = media.example; else if (media.examples?.default?.value !== undefined) action.body = media.examples.default.value; else if (media.schema) action.body = sampleFromSchema(resolveSchema(media.schema, root)); action.contentType = mediaType; }
function applySecurity(action: ManifestAction, security: AnyRecord[] | undefined, root: AnyRecord, secrets: ManifestSecretRef[]): void { const schemeName = security?.[0] && Object.keys(security[0])[0]; if (!schemeName) return; const scheme = resolveRef(root.components?.securitySchemes?.[schemeName], root); if (!scheme) return; const secretName = secretSlug(schemeName); const ref = `\${secret:${secretName}}`; if (!secrets.some((item) => item.name === secretName)) secrets.push({ name: secretName, provider: 'env', reference: ref }); if (scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer') action.headers = { ...(action.headers ?? {}), authorization: `Bearer ${ref}` }; else if (scheme.type === 'apiKey' && scheme.in === 'header') action.headers = { ...(action.headers ?? {}), [scheme.name]: ref }; else if (scheme.type === 'apiKey' && scheme.in === 'query') action.query = { ...(action.query ?? {}), [scheme.name]: ref }; }

function secretSlug(value: string): string { return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase(); }

function collectPostmanRequests(items: AnyRecord[], out: AnyRecord[]): void { for (const item of items) { if (item.request) out.push(item); if (Array.isArray(item.item)) collectPostmanRequests(item.item, out); } }
function buildPostmanUrl(url: AnyRecord): string { return [url?.protocol ? `${url.protocol}://` : '', ...(Array.isArray(url?.host) ? [url.host.join('.')] : []), ...(Array.isArray(url?.path) ? [`/${url.path.join('/')}`] : [])].join(''); }
function replacePostmanVariables(value: string, variables: AnyRecord, secrets: ManifestSecretRef[]): string { return value.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => { const name = String(key); if (variables[name] !== undefined) return String(variables[name]); const secretName = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'); if (!secrets.some((item) => item.name === secretName)) secrets.push({ name: secretName, provider: 'env', reference: `\${secret:${secretName}}` }); return `\${secret:${secretName}}`; }); }
function applyPostmanAuth(action: ManifestAction, auth: AnyRecord | undefined, variables: AnyRecord, secrets: ManifestSecretRef[]): void { if (!auth) return; if (auth.type === 'bearer') { const value = replacePostmanVariables(String(auth.bearer?.find((item: AnyRecord) => item.key === 'token')?.value ?? ''), variables, secrets); action.headers = { ...(action.headers ?? {}), authorization: `Bearer ${value.replace(/^\$\{secret:/, '${secret:')}` }; } if (auth.type === 'apikey') { const key = String(auth.apikey?.find((item: AnyRecord) => item.key === 'key')?.value ?? 'X-API-Key'); const value = replacePostmanVariables(String(auth.apikey?.find((item: AnyRecord) => item.key === 'value')?.value ?? ''), variables, secrets); action.headers = { ...(action.headers ?? {}), [key]: value }; } }
