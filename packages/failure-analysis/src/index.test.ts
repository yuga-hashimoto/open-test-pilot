import { describe, expect, it } from 'vitest';
import { classifyFailure, decideRepair, validateRepairPaths } from './index.js';

describe('failure analysis', () => {
  it('classifies common failures and stops environment repairs', () => {
    expect(classifyFailure('locator "button" waiting for visible')).toBe('LOCATOR_CHANGED');
    expect(decideRepair({ message: 'ERR_CONNECTION_REFUSED', artifacts: [], attempt: 0 }, { maxAttempts: 2, forbidAppCodeChanges: true })).toMatchObject({ allowed: false, category: 'ENVIRONMENT_ERROR' });
  });
  it('permits only bounded manifest repair paths', () => {
    expect(decideRepair({ message: 'expect text failed', artifacts: ['screenshot'], attempt: 0 }, { maxAttempts: 2, forbidAppCodeChanges: true }).allowed).toBe(true);
    expect(() => validateRepairPaths(['tests/login.yaml', 'src/app.ts'])).toThrow('src/app.ts');
    expect(() => validateRepairPaths(['tests/../app.yaml'])).toThrow('traversal');
  });
});
