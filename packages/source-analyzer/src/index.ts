import type { Finding } from '@open-test-pilot/agent-protocol';
import { DefaultManifestSchemaVersion, type Manifest, type ManifestAction } from '@open-test-pilot/manifest-schema';

export type SourcePlatform = 'web' | 'api' | 'android' | 'flutter' | 'ios';
export type SourceFramework = 'javascript' | 'nextjs' | 'react-router' | 'vue' | 'angular' | 'remix' | 'nuxt' | 'openapi' | 'swagger' | 'postman' | 'graphql' | 'android' | 'flutter' | 'ios';
export interface SourceFile { path: string; content: string; platform: SourcePlatform; framework?: SourceFramework; }

export interface SourceAnalyzerPlugin {
  id: SourceFramework;
  platform: SourcePlatform;
  detect(file: SourceFile): Finding[];
}

function finding(type: string, message: string, file: SourceFile, line: number, severity: Finding['severity'] = 'info'): Finding {
  return { type, severity, source: { file: file.path, line }, message };
}

function lineFindings(file: SourceFile, pattern: RegExp, type: string, message: string): Finding[] {
  return file.content.split('\n').flatMap((line, index) => pattern.test(line) ? [finding(type, message, file, index + 1)] : []);
}

const frameworkPlugins: readonly SourceAnalyzerPlugin[] = [
  { id: 'nextjs', platform: 'web', detect: (file) => [...lineFindings(file, /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|DELETE)|NextResponse|useRouter\s*\(|getServerSideProps|getStaticProps|pages\//, 'nextjs-route', 'Next.js App/Pages Router or navigation surface detected')] },
  { id: 'react-router', platform: 'web', detect: (file) => [...lineFindings(file, /createBrowserRouter|createRoutesFromElements|<Route\b|useNavigate\s*\(/, 'react-router-route', 'React Router route or navigation surface detected')] },
  { id: 'vue', platform: 'web', detect: (file) => [...lineFindings(file, /<script\s+setup|defineComponent|useRouter\s*\(|<RouterLink\b/, 'vue-surface', 'Vue component or navigation surface detected')] },
  { id: 'angular', platform: 'web', detect: (file) => [...lineFindings(file, /@Component\s*\(|@angular\/router|routerLink|\*ngFor/, 'angular-surface', 'Angular component, route, or repeated control detected')] },
  { id: 'remix', platform: 'web', detect: (file) => [...lineFindings(file, /export\s+(?:async\s+)?function\s+(?:loader|action)|@remix-run|<Form\b/, 'remix-route', 'Remix loader, action, or form surface detected')] },
  { id: 'nuxt', platform: 'web', detect: (file) => [...lineFindings(file, /defineNuxtConfig|defineEventHandler|useFetch\s*\(|NuxtLink/, 'nuxt-surface', 'Nuxt server, data, or navigation surface detected')] },
  { id: 'openapi', platform: 'api', detect: (file) => [...lineFindings(file, /openapi:\s*['"]|paths:\s*$|operationId:|^\s{2,}\/[^:]+:\s*$/, 'openapi-operation', 'OpenAPI operation can be exercised as an HTTP action')] },
  { id: 'swagger', platform: 'api', detect: (file) => [...lineFindings(file, /swagger:\s*['"]|paths:\s*$|operationId:|^\s{2,}\/[^:]+:\s*$/, 'swagger-operation', 'Swagger operation can be exercised as an HTTP action')] },
  { id: 'postman', platform: 'api', detect: (file) => [...lineFindings(file, /["'](?:request|method|url|item)["']\s*:/, 'postman-request', 'Postman request can be exercised as an HTTP action')] },
  { id: 'graphql', platform: 'api', detect: (file) => [...lineFindings(file, /\b(?:type\s+Query|type\s+Mutation|query\s+\w+|mutation\s+\w+)\b/, 'graphql-operation', 'GraphQL operation can be exercised as an API action')] },
  { id: 'android', platform: 'android', detect: (file) => [...lineFindings(file, /AndroidManifest|<activity\b|<fragment\b|class\s+\w+Activity\b|@Composable|NavHost|NavController|resource-id|contentDescription|testTag|retrofit2|@(?:GET|POST|PUT|DELETE)\b/, 'android-surface', 'Android manifest, activity, navigation, Compose, API, or stable locator surface detected')] },
  { id: 'flutter', platform: 'flutter', detect: (file) => [...lineFindings(file, /MaterialApp\s*\(|GoRoute|@RoutePage|ValueKey|Semantics\s*\(|BlocProvider|Riverpod|dio\.|package:http\//, 'flutter-surface', 'Flutter navigation, widget, state, API, or stable locator surface detected')] },
  { id: 'ios', platform: 'ios', detect: (file) => [...lineFindings(file, /NavigationStack|NavigationView|UIViewController|accessibilityIdentifier|accessibilityLabel|URLSession|Alamofire|URLRequest/, 'ios-surface', 'iOS navigation, view controller, accessibility, or API surface detected')] },
];

export function createSourceAnalyzerRegistry(plugins: readonly SourceAnalyzerPlugin[] = frameworkPlugins): Map<SourceFramework, SourceAnalyzerPlugin> {
  const registry = new Map<SourceFramework, SourceAnalyzerPlugin>();
  for (const plugin of plugins) {
    if (registry.has(plugin.id)) throw new Error(`Source analyzer plugin already registered: ${plugin.id}`);
    registry.set(plugin.id, plugin);
  }
  return registry;
}

export function listSourceAnalyzerPlugins(): SourceAnalyzerPlugin[] { return [...createSourceAnalyzerRegistry().values()]; }

export function analyzeSource(file: SourceFile, registry: ReadonlyMap<SourceFramework, SourceAnalyzerPlugin> = createSourceAnalyzerRegistry()): Finding[] {
  const findings: Finding[] = [];
  const add = (type: string, message: string, line: number, severity: Finding['severity'] = 'info') => findings.push({ type, severity, source: { file: file.path, line }, message });
  const lines = file.content.split('\n');
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (file.platform === 'web' || file.platform === 'api') {
      if (/app\.(get|post|put|delete)\s*\(/.test(line) || /router\.(get|post|put|delete)\s*\(/.test(line)) add('api-route', 'HTTP route can be exercised as an API action', lineNumber);
      if (/\b(?:fetch|axios\.(?:get|post|put|delete|patch)|request\s*\()/.test(line)) add('api-client', 'REST client call can be exercised as an API action', lineNumber);
      if (/\b(?:query|mutation)\s+\w+\s*[({]/.test(line) || /\b(?:type\s+Query|type\s+Mutation)\b/.test(line)) add('graphql-operation', 'GraphQL operation can be exercised as an API action', lineNumber);
      if (/<(form|button|input)\b/i.test(line)) add('form-control', 'Interactive web control is a Manifest candidate', lineNumber);
      if (/getByRole|getByLabel|getByTestId|data-testid|aria-label|placeholder\s*=|<label\b/.test(line)) add('stable-locator', 'Existing accessible/test locator can seed a stable selector', lineNumber);
      if (/required|pattern=|onSubmit|onChange|validate\s*\(/.test(line)) add('form-validation', 'Form validation behavior can seed a negative or boundary test', lineNumber);
    }
    if (file.platform === 'android') {
      if (/android:name="[^"]+Activity|<activity\b|class\s+\w+Activity\b/.test(line)) add('android-activity', 'Android Activity entry point detected', lineNumber);
      if (/compose\.(material|foundation)|@Composable/.test(line)) add('android-compose', 'Jetpack Compose UI surface detected', lineNumber);
      if (/resource-id|contentDescription|testTag/.test(line)) add('android-locator', 'Android stable resource/accessibility locator detected', lineNumber);
      if (/<fragment\b|NavHost|NavController|navigation\.xml/.test(line)) add('android-navigation', 'Android Fragment or Navigation Component surface detected', lineNumber);
      if (/retrofit2|@(?:GET|POST|PUT|DELETE)\b/.test(line)) add('android-api-client', 'Android Retrofit API client surface detected', lineNumber);
    }
    if (file.platform === 'flutter') {
      if (/@RoutePage|GoRoute|MaterialApp\s*\(/.test(line)) add('flutter-route', 'Flutter route/navigation surface detected', lineNumber);
      if (/Key\(|ValueKey|Semantics\s*\(/.test(line)) add('flutter-locator', 'Flutter key or semantics locator detected', lineNumber);
      if (/Widget build\(|class\s+\w+\s+extends\s+(Stateless|Stateful)Widget/.test(line)) add('flutter-widget', 'Flutter widget surface detected', lineNumber);
      if (/BlocProvider|Riverpod|ConsumerWidget|dio\.|package:http\//.test(line)) add('flutter-api-state', 'Flutter Bloc/Riverpod/API client surface detected', lineNumber);
    }
    if (file.platform === 'ios') {
      if (/NavigationStack|NavigationView|UIViewController/.test(line)) add('ios-navigation', 'iOS navigation/view controller surface detected', lineNumber);
      if (/SwiftUI|View\s*\{/.test(line)) add('ios-swiftui', 'SwiftUI surface detected', lineNumber);
      if (/accessibilityIdentifier|accessibilityLabel|accessibilityValue/.test(line)) add('ios-locator', 'iOS accessibility locator detected', lineNumber);
      if (/URLSession|URLRequest|Alamofire/.test(line)) add('ios-api-client', 'iOS URLSession/API client surface detected', lineNumber);
    }
  });
  const plugin = file.framework === undefined ? undefined : registry.get(file.framework);
  if (plugin !== undefined) findings.push(...plugin.detect(file));
  return findings;
}

export interface ManifestGenerationOptions {
  repository?: string;
  baseUrl?: string;
  generatedCodePath?: string;
  id?: string;
  name?: string;
  type?: string;
}

export interface GeneratedManifest {
  manifest: Manifest;
  findings: Finding[];
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'source-test';
}

function sourceRoute(file: SourceFile, line: string, lineNumber = 1): string {
  const match = line.match(/(?:app|router)\.(?:get|post|put|delete)\s*\(\s*["'`]([^"'`]+)["'`]/i);
  if (match?.[1] !== undefined) return match[1];
  const explicitPath = line.match(/["'`](\/[^"'`\s]+)["'`]/)?.[1];
  if (explicitPath !== undefined) return explicitPath;
  const precedingLines = file.content.split('\n').slice(0, lineNumber).reverse();
  const documentPath = precedingLines.find((candidate) => /^\s{2,}\/[^:\s]+\s*:\s*$/.test(candidate))?.match(/(\/[^:\s]+)\s*:/)?.[1];
  if (documentPath !== undefined) return documentPath;
  const followingLines = file.content.split('\n').slice(lineNumber - 1);
  const nextDocumentPath = followingLines.find((candidate) => /^\s{2,}\/[^:\s]+\s*:\s*$/.test(candidate))?.match(/(\/[^:\s]+)\s*:/)?.[1];
  if (nextDocumentPath !== undefined) return nextDocumentPath;
  const nextPath = file.path.replace(/^.*?(?:app|pages)\//, '/').replace(/\.(?:tsx?|jsx?)$/, '').replace(/\/page$/, '') || '/';
  return nextPath.startsWith('/') ? nextPath : `/${nextPath}`;
}

function locatorFromLine(line: string): string {
  const testId = line.match(/data-testid\s*=\s*["']([^"']+)["']/i)?.[1];
  if (testId !== undefined) return `[data-testid="${testId}"]`;
  const aria = line.match(/aria-label\s*=\s*["']([^"']+)["']/i)?.[1];
  if (aria !== undefined) return `[aria-label="${aria}"]`;
  if (/<button\b/i.test(line)) return 'button';
  if (/<input\b/i.test(line)) return 'input';
  return 'form';
}

function actionForFinding(finding: Finding, file: SourceFile, options: Required<Pick<ManifestGenerationOptions, 'baseUrl'>>): ManifestAction {
  const line = file.content.split('\n')[Math.max(0, (finding.source.line ?? 1) - 1)] ?? '';
  const id = `${slug(finding.type)}-${finding.source.line ?? 1}`;
  if (finding.type === 'api-route' || finding.type === 'api-client' || finding.type === 'openapi-operation' || finding.type === 'swagger-operation' || finding.type === 'postman-request' || finding.type === 'graphql-operation' || finding.type === 'nextjs-route' || finding.type === 'react-router-route' || finding.type === 'remix-route') {
    const method = line.match(/\.(get|post|put|delete|patch)\s*\(/i)?.[1]?.toUpperCase() ?? line.match(/\bmethod\s*["']?\s*:\s*["'](GET|POST|PUT|DELETE|PATCH)["']/i)?.[1]?.toUpperCase() ?? 'GET';
    const url = finding.type === 'graphql-operation' ? `${options.baseUrl}/graphql` : `${options.baseUrl}${sourceRoute(file, line, finding.source.line ?? 1)}`;
    return { id, type: 'api.request', method: finding.type === 'graphql-operation' ? 'POST' : method, url, ...(finding.type === 'graphql-operation' ? { body: { query: line.trim() } } : {}), expectedStatus: [200, 201, 204] };
  }
  if (finding.type === 'form-control' || finding.type === 'stable-locator') {
    return { id, type: 'web.expectVisible', selector: locatorFromLine(line) };
  }
  if (finding.type.startsWith('android-') || finding.type.startsWith('flutter-') || finding.type.startsWith('ios-')) {
    return { id, type: 'web.screenshot', name: id };
  }
  return { id, type: 'web.expectVisible', selector: 'body' };
}

export function generateManifestFromSource(file: SourceFile, options: ManifestGenerationOptions = {}): GeneratedManifest {
  const findings = analyzeSource(file);
  const id = options.id ?? slug(file.path);
  const baseUrl = options.baseUrl ?? '${env.BASE_URL}';
  const candidates = findings.filter((item) => item.severity !== 'error');
  const actions = candidates.map((item) => actionForFinding(item, file, { baseUrl }));
  const uniqueActions = actions.filter((action, index) => actions.findIndex((candidate) => candidate.id === action.id) === index);
  const steps = [{ id: 'source-surfaces', title: 'Exercise analyzed source surfaces', actions: uniqueActions.length > 0 ? uniqueActions : [{ id: 'source-screenshot', type: 'web.screenshot', name: 'source-surface' }] }];
  const manifest: Manifest = {
    schemaVersion: DefaultManifestSchemaVersion,
    id,
    name: options.name ?? `Generated ${file.path}`,
    description: `Generated from source analysis of ${file.path}`,
    type: options.type ?? (file.platform === 'web' ? 'web' : file.platform),
    tags: ['generated', 'source-first'],
    priority: 'normal',
    preconditions: [],
    variables: [],
    secrets: [],
    setup: file.platform === 'web' ? [{ id: 'open-base-url', actions: [{ id: 'goto-base-url', type: 'web.goto', url: baseUrl }] }] : [],
    steps,
    cleanup: [],
    artifacts: { screenshots: 'after', traces: true },
    runner: { minBrowsers: file.platform === 'web' ? ['chromium'] : [] },
    permissions: { networkAccess: true },
    source: { repository: options.repository ?? 'local', path: file.path },
    generatedCode: { path: options.generatedCodePath ?? `generated/${id}.spec.ts` },
  };
  return { manifest, findings };
}
