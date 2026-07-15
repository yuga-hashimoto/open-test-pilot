import { describe, expect, it } from 'vitest';
import { defineAction, ActionRegistry } from './index.js';

describe('Custom Action SDK', () => {
  it('registers versioned action metadata and rejects duplicate types', () => {
    const action = defineAction({ type: 'company.createOrder', title: 'Create order', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, permissions: { network: ['api.example.test'] }, execute: async (_context, input) => input });
    const registry = new ActionRegistry();
    registry.register(action);
    expect(registry.get('company.createOrder')?.apiVersion).toBe('1.0.0');
    expect(() => registry.register(action)).toThrow(/already registered/);
  });
});
