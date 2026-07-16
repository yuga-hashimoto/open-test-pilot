import type { Finding } from '@open-test-pilot/agent-protocol';

export type SourcePlatform = 'web' | 'android' | 'flutter' | 'ios';
export type SourceFramework = 'javascript' | 'nextjs' | 'react-router' | 'vue' | 'angular' | 'remix' | 'nuxt' | 'openapi' | 'android' | 'flutter' | 'ios';
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
  { id: 'nextjs', platform: 'web', detect: (file) => [...lineFindings(file, /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|DELETE)|NextResponse|useRouter\s*\(/, 'nextjs-route', 'Next.js route or navigation surface detected')] },
  { id: 'react-router', platform: 'web', detect: (file) => [...lineFindings(file, /createBrowserRouter|createRoutesFromElements|<Route\b|useNavigate\s*\(/, 'react-router-route', 'React Router route or navigation surface detected')] },
  { id: 'vue', platform: 'web', detect: (file) => [...lineFindings(file, /<script\s+setup|defineComponent|useRouter\s*\(|<RouterLink\b/, 'vue-surface', 'Vue component or navigation surface detected')] },
  { id: 'angular', platform: 'web', detect: (file) => [...lineFindings(file, /@Component\s*\(|@angular\/router|routerLink|\*ngFor/, 'angular-surface', 'Angular component, route, or repeated control detected')] },
  { id: 'remix', platform: 'web', detect: (file) => [...lineFindings(file, /export\s+(?:async\s+)?function\s+(?:loader|action)|@remix-run|<Form\b/, 'remix-route', 'Remix loader, action, or form surface detected')] },
  { id: 'nuxt', platform: 'web', detect: (file) => [...lineFindings(file, /defineNuxtConfig|defineEventHandler|useFetch\s*\(|NuxtLink/, 'nuxt-surface', 'Nuxt server, data, or navigation surface detected')] },
  { id: 'openapi', platform: 'web', detect: (file) => [...lineFindings(file, /openapi:\s*['"]|swagger:\s*['"]|paths:\s*$|operationId:/, 'openapi-operation', 'OpenAPI operation can be exercised as an HTTP action')] },
  { id: 'android', platform: 'android', detect: (file) => [...lineFindings(file, /class\s+\w+Activity\b|@Composable|resource-id|contentDescription|testTag/, 'android-surface', 'Android activity, Compose, or stable locator surface detected')] },
  { id: 'flutter', platform: 'flutter', detect: (file) => [...lineFindings(file, /MaterialApp\s*\(|GoRoute|@RoutePage|ValueKey|Semantics\s*\(/, 'flutter-surface', 'Flutter navigation, widget, or stable locator surface detected')] },
  { id: 'ios', platform: 'ios', detect: (file) => [...lineFindings(file, /NavigationStack|NavigationView|UIViewController|accessibilityIdentifier|accessibilityLabel/, 'ios-surface', 'iOS navigation, view controller, or accessibility surface detected')] },
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
    if (file.platform === 'web') {
      if (/app\.(get|post|put|delete)\s*\(/.test(line) || /router\.(get|post|put|delete)\s*\(/.test(line)) add('api-route', 'HTTP route can be exercised as an API action', lineNumber);
      if (/<(form|button|input)\b/i.test(line)) add('form-control', 'Interactive web control is a Manifest candidate', lineNumber);
      if (/getByRole|getByLabel|getByTestId|data-testid|aria-label/.test(line)) add('stable-locator', 'Existing accessible/test locator can seed a stable selector', lineNumber);
    }
    if (file.platform === 'android') {
      if (/android:name="[^"]+Activity|class\s+\w+Activity\b/.test(line)) add('android-activity', 'Android Activity entry point detected', lineNumber);
      if (/compose\.(material|foundation)|@Composable/.test(line)) add('android-compose', 'Jetpack Compose UI surface detected', lineNumber);
      if (/resource-id|contentDescription|testTag/.test(line)) add('android-locator', 'Android stable resource/accessibility locator detected', lineNumber);
    }
    if (file.platform === 'flutter') {
      if (/@RoutePage|GoRoute|MaterialApp\s*\(/.test(line)) add('flutter-route', 'Flutter route/navigation surface detected', lineNumber);
      if (/Key\(|ValueKey|Semantics\s*\(/.test(line)) add('flutter-locator', 'Flutter key or semantics locator detected', lineNumber);
      if (/Widget build\(|class\s+\w+\s+extends\s+(Stateless|Stateful)Widget/.test(line)) add('flutter-widget', 'Flutter widget surface detected', lineNumber);
    }
    if (file.platform === 'ios') {
      if (/NavigationStack|NavigationView|UIViewController/.test(line)) add('ios-navigation', 'iOS navigation/view controller surface detected', lineNumber);
      if (/SwiftUI|View\s*\{/.test(line)) add('ios-swiftui', 'SwiftUI surface detected', lineNumber);
      if (/accessibilityIdentifier|accessibilityLabel|accessibilityValue/.test(line)) add('ios-locator', 'iOS accessibility locator detected', lineNumber);
    }
  });
  const plugin = file.framework === undefined ? undefined : registry.get(file.framework);
  if (plugin !== undefined) findings.push(...plugin.detect(file));
  return findings;
}
