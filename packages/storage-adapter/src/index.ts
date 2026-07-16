import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface PutArtifactInput {
  organizationId: string;
  key: string;
  body: Uint8Array;
  contentType: string;
}

export interface ArtifactRetentionInput {
  organizationId: string;
  before: Date;
}

export interface StorageAdapter {
  put(input: PutArtifactInput): Promise<void>;
  get(input: Pick<PutArtifactInput, 'organizationId' | 'key'>): Promise<Buffer | undefined>;
  delete(input: Pick<PutArtifactInput, 'organizationId' | 'key'>): Promise<void>;
  purgeExpired(input: ArtifactRetentionInput): Promise<number>;
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

  public async purgeExpired(input: ArtifactRetentionInput): Promise<number> {
    const organizationDir = resolve(this.rootDir, input.organizationId);
    let removed = 0;
    await this.walkFiles(organizationDir, async (path) => {
      const details = await stat(path);
      if (details.mtime < input.before) {
        await unlink(path);
        removed += 1;
      }
    });
    return removed;
  }

  private async walkFiles(directory: string, visit: (path: string) => Promise<void>): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await this.walkFiles(path, visit);
      else if (entry.isFile()) await visit(path);
    }
  }

  private safePath(organizationId: string, key: string): string {
    const base = resolve(this.rootDir, organizationId);
    const path = resolve(base, key);
    if (relative(base, path).startsWith('..')) throw new Error('Storage key escapes organization boundary');
    return path;
  }
}

export interface S3StorageOptions { endpoint?: string; region?: string; bucket: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle?: boolean; }

export class S3StorageAdapter implements StorageAdapter {
  private readonly client: Pick<S3Client, 'send'>;
  private readonly bucket: string;
  constructor(options: S3StorageOptions, client?: Pick<S3Client, 'send'>) {
    this.client = client ?? new S3Client({ region: options.region ?? 'us-east-1', ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }), forcePathStyle: options.forcePathStyle ?? options.endpoint !== undefined, ...(options.accessKeyId === undefined || options.secretAccessKey === undefined ? {} : { credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey } }) });
    this.bucket = options.bucket;
  }
  async put(input: PutArtifactInput): Promise<void> { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: scopedKey(input.organizationId, input.key), Body: input.body, ContentType: input.contentType })); }
  async get(input: Pick<PutArtifactInput, 'organizationId' | 'key'>): Promise<Buffer | undefined> { try { const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: scopedKey(input.organizationId, input.key) })); if (result.Body === undefined) return undefined; return Buffer.from(await result.Body.transformToByteArray()); } catch (error) { if (error instanceof Error && 'name' in error && error.name === 'NoSuchKey') return undefined; throw error; } }
  async delete(input: Pick<PutArtifactInput, 'organizationId' | 'key'>): Promise<void> { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: scopedKey(input.organizationId, input.key) })); }
  async purgeExpired(input: ArtifactRetentionInput): Promise<number> {
    const prefix = `${scopedOrganization(input.organizationId)}/`;
    let continuationToken: string | undefined;
    let removed = 0;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }) }));
      const keys = (page.Contents ?? []).filter((object) => object.Key !== undefined && object.LastModified !== undefined && object.LastModified < input.before).map((object) => ({ Key: object.Key }));
      if (keys.length > 0) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
        removed += keys.length;
      }
      continuationToken = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);
    return removed;
  }
}

function scopedOrganization(organizationId: string): string { if (organizationId.includes('/') || organizationId === '' || organizationId === '.' || organizationId === '..') throw new Error('Storage key escapes organization boundary'); return organizationId; }
function scopedKey(organizationId: string, key: string): string { if (key.startsWith('/') || key.split('/').includes('..')) throw new Error('Storage key escapes organization boundary'); return `${scopedOrganization(organizationId)}/${key}`; }
