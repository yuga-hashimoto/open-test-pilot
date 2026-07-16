import { mkdtemp, utimes } from 'node:fs/promises';
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

  it('purges only expired artifacts within one organization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'testpilot-storage-'));
    const adapter = new LocalStorageAdapter(root);
    await adapter.put({ organizationId: 'org-a', key: 'old.log', body: Buffer.from('old'), contentType: 'text/plain' });
    await adapter.put({ organizationId: 'org-a', key: 'new.log', body: Buffer.from('new'), contentType: 'text/plain' });
    await adapter.put({ organizationId: 'org-b', key: 'old.log', body: Buffer.from('other'), contentType: 'text/plain' });
    const old = new Date(Date.now() - 60_000);
    await utimes(join(root, 'org-a', 'old.log'), old, old);
    await utimes(join(root, 'org-b', 'old.log'), old, old);
    expect(await adapter.purgeExpired({ organizationId: 'org-a', before: new Date(Date.now() - 30_000) })).toBe(1);
    expect(await adapter.get({ organizationId: 'org-a', key: 'old.log' })).toBeUndefined();
    expect((await adapter.get({ organizationId: 'org-a', key: 'new.log' }))?.toString()).toBe('new');
    expect((await adapter.get({ organizationId: 'org-b', key: 'old.log' }))?.toString()).toBe('other');
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

it('lists and deletes expired S3 objects under one organization prefix', async () => {
  const commands: Array<{ input: Record<string, unknown> }> = [];
  const adapter = new S3StorageAdapter({ bucket: 'artifacts' }, { async send(command) {
    commands.push(command as unknown as { input: Record<string, unknown> });
    if (commands.length === 1) return { Contents: [{ Key: 'org-1/old.log', LastModified: new Date(0) }, { Key: 'org-1/new.log', LastModified: new Date() }], IsTruncated: false };
    return {};
  } });
  expect(await adapter.purgeExpired({ organizationId: 'org-1', before: new Date(1_000) })).toBe(1);
  expect(commands[0]?.input).toMatchObject({ Bucket: 'artifacts', Prefix: 'org-1/' });
  expect(commands[1]?.input).toMatchObject({ Bucket: 'artifacts', Delete: { Objects: [{ Key: 'org-1/old.log' }] } });
});
