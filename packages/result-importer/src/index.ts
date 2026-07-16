export type ImportedFramework = 'junit' | 'vitest' | 'unit' | 'component' | 'integration';
export interface ImportedTest { name: string; status: 'passed' | 'failed' | 'skipped'; durationMs?: number; message?: string; suite?: string; file?: string; }
export interface ImportedResult { runId: string; framework: ImportedFramework; status: 'passed' | 'failed'; tests: ImportedTest[]; }

export function importJUnit(xml: string, runId: string, framework: ImportedFramework = 'junit'): ImportedResult {
  const tests: ImportedTest[] = [];
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = attributes(match[1] ?? '');
    const body = match[2] ?? '';
    const failed = /<failure\b|<error\b/.test(body);
    const skipped = /<skipped\b/.test(body);
    tests.push({ name: attrs['name'] ?? 'unnamed', status: failed ? 'failed' : skipped ? 'skipped' : 'passed', ...(attrs['time'] === undefined ? {} : { durationMs: Number(attrs['time']) * 1000 }), ...(failed ? { message: stripTags(body).trim() } : {}) });
  }
  return { runId, framework, status: tests.some((test) => test.status === 'failed') ? 'failed' : 'passed', tests };
}

export function importVitest(value: unknown, runId: string, framework: ImportedFramework = 'vitest'): ImportedResult {
  const files = value !== null && typeof value === 'object' && Array.isArray((value as Record<string, unknown>)['testResults']) ? (value as Record<string, unknown>)['testResults'] as unknown[] : [];
  const tests = files.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object').map((item) => ({ name: typeof item['name'] === 'string' ? item['name'] : 'unnamed', status: item['status'] === 'failed' ? 'failed' as const : item['status'] === 'skipped' ? 'skipped' as const : 'passed' as const, ...(typeof item['duration'] === 'number' ? { durationMs: item['duration'] } : {}), ...(typeof item['message'] === 'string' ? { message: item['message'] } : {}) }));
  return { runId, framework, status: tests.some((test) => test.status === 'failed') ? 'failed' : 'passed', tests };
}

export function importExternalResult(value: string | unknown, runId: string, framework: 'unit' | 'component' | 'integration'): ImportedResult {
  return typeof value === 'string' ? importJUnit(value, runId, framework) : importVitest(value, runId, framework);
}

function attributes(input: string): Record<string, string> { const result: Record<string, string> = {}; for (const match of input.matchAll(/([\w:-]+)="([^"]*)"/g)) if (match[1] !== undefined && match[2] !== undefined) result[match[1]] = match[2]; return result; }
function stripTags(input: string): string { return input.replace(/<[^>]+>/g, ''); }
