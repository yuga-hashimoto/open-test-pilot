import { describe, expect, it } from 'vitest';
import { EnvironmentSecretProvider, redact } from './index.js';

describe('Secret Provider SDK', () => {
  it('reads environment secrets and redacts values from log text', async () => {
    process.env['TESTPILOT_SECRET_TEST'] = 'super-secret';
    const provider = new EnvironmentSecretProvider();
    expect(await provider.get('TESTPILOT_SECRET_TEST')).toBe('super-secret');
    expect(redact('token=super-secret', ['super-secret'])).toBe('token=[REDACTED]');
    delete process.env['TESTPILOT_SECRET_TEST'];
  });
});
