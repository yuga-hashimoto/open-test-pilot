import type { Finding } from '@open-test-pilot/agent-protocol';

export type SourcePlatform = 'web' | 'android' | 'flutter' | 'ios';
export interface SourceFile { path: string; content: string; platform: SourcePlatform; }

export function analyzeSource(file: SourceFile): Finding[] {
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
  return findings;
}
