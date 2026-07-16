import { describe, expect, it } from 'vitest';
import { analyzeSource } from './index.js';

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
});
