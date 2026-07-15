import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

export interface PutArtifactInput {
  organizationId: string;
  key: string;
  body: Uint8Array;
  contentType: string;
}

export interface StorageAdapter {
  put(input: PutArtifactInput): Promise<void>;
  get(input: Pick<PutArtifactInput, 'organizationId' | 'key'>): Promise<Buffer | undefined>;
  delete(input: Pick<PutArtifactInput, 'organizationId' | 'key'>): Promise<void>;
}

export class LocalStorageAdapter implements StorageAdapter {
  public constructor(private readonly rootDir: string) {}

  public async put(input: PutArtifactInput): Promise<void> {
    const path = this.safePath(input.organizationId, input.key);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, input.body);
  }

  public async get(input: Pick<PutArtifactInput, 'organizationId' | 'key'>): Promise<Buffer | undefined> {
    try {
      return await readFile(this.safePath(input.organizationId, input.key));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  public async delete(input: Pick<PutArtifactInput, 'organizationId' | 'key'>): Promise<void> {
    const path = this.safePath(input.organizationId, input.key);
    try {
      await unlink(path);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
  }

  private safePath(organizationId: string, key: string): string {
    const base = resolve(this.rootDir, organizationId);
    const path = resolve(base, key);
    if (relative(base, path).startsWith('..')) throw new Error('Storage key escapes organization boundary');
    return path;
  }
}
