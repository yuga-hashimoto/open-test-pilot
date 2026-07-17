import { describe, expect, it } from 'vitest';
import { analyzeSource, createSourceAnalyzerRegistry, generateManifestFromSource, listSourceAnalyzerPlugins } from './index.js';

describe('source analyzer', () => {
  it('normalizes web route, form, and locator findings with source lines', () => {
    const findings = analyzeSource({ path: 'src/routes.tsx', platform: 'web', content: 'router.get("/login", handler);\n<form><button aria-label="Sign in" /></form>' });
    expect(findings.map((finding) => finding.type)).toEqual(['api-route', 'form-control', 'stable-locator']);
    expect(findings[0]?.source.line).toBe(1);
  });
  it('detects Android, Flutter, and iOS framework surfaces', () => {
    expect(analyzeSource({ path: 'MainActivity.kt', platform: 'android', content: 'class MainActivity : Activity { @Composable fun Screen() {} }' }).map((finding) => finding.type)).toEqual(['android-activity', 'android-compose']);
    expect(analyzeSource({ path: 'login.dart', platform: 'flutter', content: 'class Login extends StatelessWidget { Widget build() => Semantics(); }' }).map((finding) => finding.type)).toEqual(['flutter-locator', 'flutter-widget']);
    expect(analyzeSource({ path: 'LoginView.swift', platform: 'ios', content: 'struct LoginView: SwiftUI.View { var body: some View { Text("Login").accessibilityIdentifier("login") } }' }).map((finding) => finding.type)).toEqual(['ios-swiftui', 'ios-locator']);
  });
  it('exposes framework plugins for source-first analysis and accepts custom plugins', () => {
    expect(listSourceAnalyzerPlugins().map((plugin) => plugin.id)).toEqual(expect.arrayContaining(['nextjs', 'react-router', 'vue', 'angular', 'remix', 'nuxt', 'openapi', 'android', 'flutter', 'ios']));
    const registry = createSourceAnalyzerRegistry([{ id: 'javascript', platform: 'web', detect: () => [{ type: 'custom', severity: 'info', source: { file: 'x' }, message: 'custom' }] }]);
    expect(registry.has('javascript')).toBe(true);
    expect(() => createSourceAnalyzerRegistry([{ id: 'javascript', platform: 'web', detect: () => [] }, { id: 'javascript', platform: 'web', detect: () => [] }])).toThrow(/already registered/);
    expect(analyzeSource({ path: 'app/page.tsx', platform: 'web', framework: 'javascript', content: 'const route = true;' }, registry).some((item) => item.type === 'custom')).toBe(true);
    expect(analyzeSource({ path: 'app/page.tsx', platform: 'web', framework: 'nextjs', content: 'export async function GET() {}' }).some((item) => item.type === 'nextjs-route')).toBe(true);
  });
  it('generates a schema-valid executable Manifest from analyzed source', async () => {
    const file = { path: 'app/login/page.tsx', platform: 'web' as const, framework: 'nextjs' as const, content: 'export async function GET() { return Response.json({ ok: true }); }\n<form><button aria-label="Sign in" /></form>' };
    const generated = generateManifestFromSource(file, { baseUrl: 'http://127.0.0.1:4173', repository: 'https://github.com/example/app' });
    expect(generated.findings.map((item) => item.type)).toEqual(expect.arrayContaining(['nextjs-route', 'form-control']));
    const { createManifestValidator } = await import('@open-test-pilot/manifest-schema');
    expect(createManifestValidator()(generated.manifest).valid).toBe(true);
    expect(generated.manifest.setup[0]?.actions[0]?.type).toBe('web.goto');
    expect(generated.manifest.steps[0]?.actions.some((action) => action.type === 'api.request')).toBe(true);
  });
});
