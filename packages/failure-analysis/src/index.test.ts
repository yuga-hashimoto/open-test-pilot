import { describe, expect, it } from 'vitest';
import { classifyFailure, decideRepair, validateRepairPaths } from './index.js';

describe('failure analysis', () => {
  it('classifies common failures and stops environment repairs', () => {
    expect(classifyFailure('locator "button" waiting for visible')).toBe('LOCATOR_CHANGED');
    expect(decideRepair({ message: 'ERR_CONNECTION_REFUSED', artifacts: [], attempt: 0 }, { maxAttempts: 3, forbidAppCodeChanges: true })).toMatchObject({ allowed: false, category: 'ENVIRONMENT_ERROR' });
  });
  it('classifies wait-condition and test-data failures', () => {
    expect(classifyFailure('Timeout 30000ms exceeded')).toBe('WAIT_CONDITION_ERROR');
    expect(classifyFailure('test data seed failed: fixture user is missing')).toBe('TEST_DATA_ERROR');
  });
  it('does not hide suspected product defects behind test repairs', () => {
    const decision = decideRepair({ message: 'expect text failed', artifacts: ['screenshot'], attempt: 0 }, { maxAttempts: 3, forbidAppCodeChanges: true });
    expect(decision.category).toBe('PRODUCT_DEFECT');
    expect(decision.allowed).toBe(false);
  });
  it('stops early when the same failure cause repeats consecutively', () => {
    const decision = decideRepair(
      { message: 'locator "button" waiting for visible', artifacts: [], attempt: 1, previousCategories: ['LOCATOR_CHANGED'] },
      { maxAttempts: 3, forbidAppCodeChanges: true },
    );
    expect(decision).toMatchObject({ allowed: false, category: 'LOCATOR_CHANGED' });
  });
  it('permits only bounded manifest repair paths', () => {
    expect(decideRepair({ message: 'locator "button" waiting for visible', artifacts: ['screenshot'], attempt: 0 }, { maxAttempts: 3, forbidAppCodeChanges: true }).allowed).toBe(true);
    expect(() => validateRepairPaths(['tests/login.yaml', 'src/app.ts'])).toThrow('src/app.ts');
    expect(() => validateRepairPaths(['tests/../app.yaml'])).toThrow('traversal');
  });
});
