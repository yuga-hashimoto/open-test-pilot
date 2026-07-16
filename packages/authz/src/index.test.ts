import { describe, expect, it } from 'vitest';
import { assertCan, can } from './index.js';

describe('tenant authorization', () => {
  it('keeps runner and secret permissions separate', () => {
    expect(can('runner_admin', 'runner.manage')).toBe(true);
    expect(can('runner_admin', 'secret.read')).toBe(false);
    expect(can('test_runner', 'run.start')).toBe(true);
  });
  it('fails closed for forbidden writes', () => { expect(() => assertCan('viewer', 'test.write')).toThrow('cannot test.write'); });
});
