import { describe, expect, it } from 'vitest';
import { importJUnit, importVitest } from './index.js';

describe('result importer', () => {
  it('normalizes JUnit success, failure, and skipped cases', () => {
    const result = importJUnit('<testsuite><testcase name="ok" time="0.2"/><testcase name="bad"><failure>boom</failure></testcase><testcase name="skip"><skipped/></testcase></testsuite>', 'run-1');
    expect(result.status).toBe('failed');
    expect(result.tests.map((test) => test.status)).toEqual(['passed', 'failed', 'skipped']);
  });
  it('normalizes Vitest JSON output with run correlation', () => { expect(importVitest({ testResults: [{ name: 'login', status: 'passed', duration: 10 }] }, 'run-2')).toMatchObject({ runId: 'run-2', framework: 'vitest', status: 'passed' }); });
});
