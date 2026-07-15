import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalStorageAdapter, S3StorageAdapter } from './index.js';

describe('LocalStorageAdapter', () => {
  it('isolates keys by organization and round-trips artifact bytes', async () => {
    const adapter = new LocalStorageAdapter(await mkdtemp(join(tmpdir(), 'testpilot-storage-')));
    await adapter.put({ organizationId: 'org-a', key: 'runs/run-1/log.txt', body: Buffer.from('ok'), contentType: 'text/plain' });
    expect((await adapter.get({ organizationId: 'org-a', key: 'runs/run-1/log.txt' }))?.toString()).toBe('ok');
    expect(await adapter.get({ organizationId: 'org-b', key: 'runs/run-1/log.txt' })).toBeUndefined();
  });
});

it('uses organization-scoped S3 keys for MinIO-compatible storage', async () => {
  const commands: Array<{ input: Record<string, unknown> }> = [];
  const adapter = new S3StorageAdapter({ bucket: 'artifacts', endpoint: 'http://minio.test' }, { async send(command) { commands.push(command as unknown as { input: Record<string, unknown> }); return { Body: undefined }; } });
  await adapter.put({ organizationId: 'org-1', key: 'runs/run-1/log.txt', body: new TextEncoder().encode('log'), contentType: 'text/plain' });
  await adapter.delete({ organizationId: 'org-1', key: 'runs/run-1/log.txt' });
  expect(commands[0]?.input).toMatchObject({ Bucket: 'artifacts', Key: 'org-1/runs/run-1/log.txt' });
  expect(commands[1]?.input).toMatchObject({ Bucket: 'artifacts', Key: 'org-1/runs/run-1/log.txt' });
});
