import { describe, expect, it } from 'vitest';
import { TriggerRouter, validateCronExpression } from './index.js';

describe('trigger adapter', () => {
  it('deduplicates webhook delivery IDs and routes by tenant project', () => {
    const router = new TriggerRouter([{ kind: 'github.push', projectId: 'project-1', testId: 'test-1' }]);
    const event = { id: 'delivery-1', kind: 'github.push' as const, organizationId: 'org-1', projectId: 'project-1', testId: 'test-1', receivedAt: new Date().toISOString() };
    expect(router.dispatch(event)).toHaveLength(1);
    expect(router.dispatch(event)).toHaveLength(0);
  });

  it('validates and normalizes cron schedules', () => {
    expect(validateCronExpression('0 9 * * 1')).toBe('0 9 * * 1');
    expect(() => validateCronExpression('every morning')).toThrow('five-field');
  });
});
