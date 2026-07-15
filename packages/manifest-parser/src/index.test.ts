import { describe, expect, it } from 'vitest';
import { parseManifest } from './index.js';

const validYaml = `
schemaVersion: "1.0.0"
id: login
name: Login
description: Login flow
type: e2e
tags: [smoke]
priority: high
preconditions: []
variables:
  - name: baseUrl
    defaultValue: http://localhost:3000
secrets:
  - name: password
    provider: env
    reference: "\${secret:TEST_PASSWORD}"
setup: []
steps:
  - id: login
    description: Sign in
    actions:
      - id: open
        type: web.goto
        url: "\${var.baseUrl}/login"
      - id: email
        type: web.fill
        selector: '#email'
        value: user@example.com
cleanup: []
artifacts:
  screenshots: after
runner:
  minBrowsers: [chromium]
permissions:
  networkAccess: true
source:
  repository: example
  path: tests/login.yaml
generatedCode:
  path: generated/login.spec.ts
`;

describe('parseManifest', () => {
  it('parses and normalizes a valid YAML manifest', () => {
    const result = parseManifest(validYaml, 'tests/login.yaml');
    expect(result.manifest.id).toBe('login');
    expect(result.manifest.steps[0]?.actions[0]?.type).toBe('web.goto');
    expect(result.sourcePath).toBe('tests/login.yaml');
    expect(result.diagnostics).toEqual([]);
  });

  it('reports duplicate step and action IDs with source locations', () => {
    const duplicated = validYaml.replace(
      '  - id: login\n    description: Sign in\n',
      '  - id: login\n    actions: []\n  - id: login\n    description: Sign in\n',
    );
    const result = parseManifest(duplicated);
    expect(result.manifest.steps).toHaveLength(2);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'DUPLICATE_ID')).toBe(true);
    expect(result.diagnostics[0]?.line).toBeGreaterThan(0);
  });

  it('rejects secret literals and invalid interpolation syntax', () => {
    const invalid = validYaml
      .replace('reference: "${secret:TEST_PASSWORD}"', 'reference: raw-secret')
      .replace('${var.baseUrl}/login', '${unknown.baseUrl}/login');
    const result = parseManifest(invalid);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['SECRET_LITERAL', 'INVALID_INTERPOLATION']),
    );
  });
});
