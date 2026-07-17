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
  it('detects mobile navigation, API, state, and manifest surfaces', () => {
    const android = analyzeSource({ path: 'AndroidManifest.xml', platform: 'android', content: '<activity android:name=".MainActivity" />\n<fragment android:name=".LoginFragment" />\nNavHost(navController, startDestination = "login")\ninterface Api { @GET("/users") fun users(): Call<List<User>> }' }).map((finding) => finding.type);
    expect(android).toEqual(expect.arrayContaining(['android-activity', 'android-navigation', 'android-api-client']));

    const flutter = analyzeSource({ path: 'app.dart', platform: 'flutter', content: 'BlocProvider(create: (_) => LoginBloc())\nfinal client = dio.Dio();\nGoRoute(path: "/login")' }).map((finding) => finding.type);
    expect(flutter).toEqual(expect.arrayContaining(['flutter-api-state', 'flutter-route']));

    const ios = analyzeSource({ path: 'APIClient.swift', platform: 'ios', content: 'let request = URLRequest(url: url)\nURLSession.shared.data(for: request)' }).map((finding) => finding.type);
    expect(ios).toContain('ios-api-client');
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

  it('generates API actions for OpenAPI, Swagger, Postman, GraphQL, and client calls', () => {
    const sources = [
      { path: 'openapi.yaml', platform: 'api' as const, framework: 'openapi' as const, content: 'openapi: "3.0.0"\npaths:\n  /users:\n    get:\n      operationId: listUsers' },
      { path: 'swagger.yaml', platform: 'api' as const, framework: 'swagger' as const, content: 'swagger: "2.0"\npaths:\n  /users:\n    get:' },
      { path: 'collection.json', platform: 'api' as const, framework: 'postman' as const, content: '{ "item": [{ "request": { "method": "POST", "url": "/users" } }] }' },
      { path: 'schema.graphql', platform: 'api' as const, framework: 'graphql' as const, content: 'type Query { users: [User!]! }' },
      { path: 'client.ts', platform: 'api' as const, content: 'await fetch("/users"); axios.post("/users", body);' },
    ];
    for (const source of sources) {
      const generated = generateManifestFromSource(source, { baseUrl: 'http://api.test' });
      expect(generated.findings.length, source.path).toBeGreaterThan(0);
      const apiActions = generated.manifest.steps.flatMap((step) => step.actions).filter((action) => action.type === 'api.request');
      expect(apiActions.length, source.path).toBeGreaterThan(0);
      if (source.path === 'openapi.yaml' || source.path === 'swagger.yaml' || source.path === 'collection.json') expect(apiActions.some((action) => action.url?.endsWith('/users')), source.path).toBe(true);
    }
  });
});
