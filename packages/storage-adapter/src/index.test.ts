import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalStorageAdapter } from './index.js';

describe('LocalStorageAdapter', () => {
  it('isolates keys by organization and round-trips artifact bytes', async () => {
    const adapter = new LocalStorageAdapter(await mkdtemp(join(tmpdir(), 'testpilot-storage-')));
    await adapter.put({ organizationId: 'org-a', key: 'runs/run-1/log.txt', body: Buffer.from('ok'), contentType: 'text/plain' });
    expect((await adapter.get({ organizationId: 'org-a', key: 'runs/run-1/log.txt' }))?.toString()).toBe('ok');
    expect(await adapter.get({ organizationId: 'org-b', key: 'runs/run-1/log.txt' })).toBeUndefined();
  });
});
