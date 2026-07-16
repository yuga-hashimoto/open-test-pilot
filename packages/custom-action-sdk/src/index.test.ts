import { describe, expect, it } from 'vitest';
import { defineAction, ActionRegistry, validateActionInput } from './index.js';

describe('Custom Action SDK', () => {
  it('registers versioned action metadata and rejects duplicate types', () => {
    const action = defineAction({ type: 'company.createOrder', title: 'Create order', inputSchema: { type: 'object', required: ['sku'], properties: { sku: { type: 'string' } } }, outputSchema: { type: 'object' }, uiSchema: { fields: { sku: { widget: 'text' } } }, permissions: { network: ['api.example.test'] }, execute: async (_context, input) => input });
    const registry = new ActionRegistry();
    registry.register(action);
    expect(registry.get('company.createOrder')?.apiVersion).toBe('1.0.0');
    expect(registry.get('company.createOrder')?.publication).toBe('private');
    expect(validateActionInput(action, {})).toEqual(["$ must have required property 'sku'"]);
    expect(validateActionInput(action, { sku: 42 })).toEqual(['/sku must be string']);
    expect(registry.publish('company.createOrder').publication).toBe('published');
    expect(registry.deprecate('company.createOrder').publication).toBe('deprecated');
    expect(() => registry.register(action)).toThrow(/already registered/);
  });
  it('rejects non-versioned action identifiers', () => {
    expect(() => defineAction({ type: 'bad', title: 'Bad', inputSchema: {}, outputSchema: {}, permissions: {}, execute: async () => undefined })).toThrow(/invalid action type/);
  });
});
