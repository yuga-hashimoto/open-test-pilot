import { LineCounter, parseDocument } from 'yaml';
import {
  createManifestValidator,
  type Manifest,
} from '@open-test-pilot/manifest-schema';

export type DiagnosticSeverity = 'error' | 'warning';

export interface ManifestDiagnostic {
  code: string;
  message: string;
  severity: DiagnosticSeverity;
  path: string;
  line: number;
  column: number;
}

export interface ParseManifestResult {
  manifest: Manifest;
  sourcePath?: string;
  diagnostics: ManifestDiagnostic[];
}

const interpolationPattern = /\$\{([^}]+)\}/g;
const allowedInterpolation = /^(?:env\.[A-Za-z_][A-Za-z0-9_]*|var\.[A-Za-z_][A-Za-z0-9_]*|secret:[A-Za-z_][A-Za-z0-9_]*|steps\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)$/;

function locationForOffset(lineCounter: LineCounter, offset: number): Pick<ManifestDiagnostic, 'line' | 'column'> {
  const position = lineCounter.linePos(Math.max(0, offset));
  return { line: position.line, column: position.col };
}

function walk(value: unknown, path: string, visit: (value: unknown, path: string) => void): void {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}/${index}`, visit));
    return;
  }
  if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => walk(item, `${path}/${key}`, visit));
  }
}

function stringDiagnostics(value: string, path: string, diagnostics: ManifestDiagnostic[], lineCounter: LineCounter, source: string): void {
  for (const match of value.matchAll(interpolationPattern)) {
    const expression = match[1] ?? '';
    if (!allowedInterpolation.test(expression)) {
      diagnostics.push({
        code: 'INVALID_INTERPOLATION',
        message: `Unsupported interpolation expression: ${expression}`,
        severity: 'error',
        path,
        ...locationForOffset(lineCounter, source.indexOf(match[0])),
      });
    }
  }
}

function semanticDiagnostics(manifest: unknown, diagnostics: ManifestDiagnostic[], lineCounter: LineCounter, source: string): void {
  const seen = new Map<string, string>();
  walk(manifest, '', (value, path) => {
    if (typeof value === 'string') {
      stringDiagnostics(value, path, diagnostics, lineCounter, source);
    }
    if (path.endsWith('/id') && path !== '/id' && typeof value === 'string') {
      const namespace = path.includes('/actions/') ? 'action' : 'step';
      const key = `${namespace}:${value}`;
      const previous = seen.get(key);
      if (previous !== undefined) {
        diagnostics.push({
          code: 'DUPLICATE_ID',
          message: `ID '${value}' is already used at ${previous}`,
          severity: 'error',
          path,
          ...locationForOffset(lineCounter, source.indexOf(value)),
        });
      } else {
        seen.set(key, path);
      }
    }
    if (path.startsWith('/secrets/') && path.endsWith('/reference') && typeof value === 'string' && !/^\$\{secret:[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)) {
      diagnostics.push({
        code: 'SECRET_LITERAL',
        message: 'Secret references must use ${secret:NAME} and must not contain a literal secret value',
        severity: 'error',
        path,
        ...locationForOffset(lineCounter, source.indexOf(value)),
      });
    }
  });
}

export function parseManifest(source: string, sourcePath?: string): ParseManifestResult {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter });
  const diagnostics: ManifestDiagnostic[] = document.errors.map((error) => ({
    code: 'YAML_PARSE_ERROR',
    message: error.message,
    severity: 'error',
    path: '',
    ...locationForOffset(lineCounter, error.pos?.[0] ?? 0),
  }));
  const manifest = document.toJS() as Manifest;

  if (document.errors.length === 0) {
    semanticDiagnostics(manifest, diagnostics, lineCounter, source);
    const validation = createManifestValidator()(manifest);
    if (!validation.valid) {
      for (const error of validation.errors ?? []) {
        diagnostics.push({
          code: 'SCHEMA_INVALID',
          message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
          severity: 'error',
          path: error.instancePath,
          line: 1,
          column: 1,
        });
      }
    }
  }

  return { manifest, ...(sourcePath === undefined ? {} : { sourcePath }), diagnostics };
}
