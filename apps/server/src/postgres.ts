import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { AiWorkerJobRecord, AiWorkerRecord, ArtifactMetadata, AuditEventRecord, ChangeRequestRecord, ManifestVersionRecord, Organization, OrganizationMemberRecord, Project, PullRequestRecord, RepairRecord, RepositoryRecord, RunRecord, ScheduleRecord, SecretRecord, ServerRunStatus, StoragePolicyRecord, StoredRunResult, TenantRepository, TestRecord } from './index.js';

type RunPatch = Partial<Pick<RunRecord, 'status' | 'startedAt' | 'endedAt'>>;

/**
 * PostgreSQL implementation used when DATABASE_URL is configured.
 * Every tenant-owned query runs in a transaction with app.organization_id set
 * locally, so the migration's RLS policies remain effective with pooled clients.
 */
export class PostgresTenantRepository implements TenantRepository {
  readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: Number(process.env['DATABASE_POOL_MAX'] ?? 10) });
  }

  private async tenantQuery<T>(organizationId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async upsertGitHubUser(githubUserId: string, login: string): Promise<{ id: string; githubUserId: string; login: string }> {
    const result = await this.pool.query<{ id: string; github_user_id: string; login: string }>(
      'INSERT INTO users (github_user_id, login) VALUES ($1, $2) ON CONFLICT (github_user_id) DO UPDATE SET login = EXCLUDED.login RETURNING id, github_user_id, login',
      [githubUserId, login],
    );
    const row = requiredRow(result.rows[0]);
    return { id: row.id, githubUserId: row.github_user_id, login: row.login };
  }

  async createAuthSession(userId: string, expiresAt: string): Promise<{ token: string; expiresAt: string }> {
    const token = randomUUID();
    await this.pool.query('INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, createHash('sha256').update(token).digest('hex'), expiresAt]);
    return { token, expiresAt };
  }

  async getAuthSession(token: string): Promise<{ userId: string; expiresAt: string } | undefined> {
    const result = await this.pool.query<{ user_id: string; expires_at: Date }>('SELECT user_id, expires_at FROM auth_sessions WHERE token_hash = $1 AND expires_at > now()', [createHash('sha256').update(token).digest('hex')]);
    const row = result.rows[0];
    return row === undefined ? undefined : { userId: row.user_id, expiresAt: dateValue(row.expires_at) };
  }

  async addOrganizationMembership(organizationId: string, userId: string, role: string): Promise<void> {
    await this.pool.query('INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role', [organizationId, userId, role]);
  }

  async isOrganizationMember(organizationId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>('SELECT EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2) AS exists', [organizationId, userId]);
    return result.rows[0]?.exists ?? false;
  }

  async listOrganizationMembers(organizationId: string): Promise<OrganizationMemberRecord[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ organization_id: string; user_id: string; github_user_id: string; login: string; role: string; created_at: Date }>('SELECT om.organization_id, om.user_id, u.github_user_id, u.login, om.role, om.created_at FROM organization_memberships om INNER JOIN users u ON u.id = om.user_id WHERE om.organization_id = $1 ORDER BY om.created_at, om.user_id', [organizationId]);
      return result.rows.map((row) => ({ organizationId: row.organization_id, userId: row.user_id, githubUserId: row.github_user_id, login: row.login, role: row.role, createdAt: dateValue(row.created_at) }));
    });
  }

  async createOrganization(name: string): Promise<Organization> {
    const result = await this.pool.query<{ id: string; name: string; created_at: Date }>('INSERT INTO organizations (name) VALUES ($1) RETURNING id, name, created_at', [name]);
    return organizationFromRow(requiredRow(result.rows[0]));
  }

  async getOrganization(id: string): Promise<Organization | undefined> {
    const result = await this.pool.query<{ id: string; name: string; created_at: Date }>('SELECT id, name, created_at FROM organizations WHERE id = $1', [id]);
    return result.rows[0] === undefined ? undefined : organizationFromRow(result.rows[0]);
  }

  async createProject(organizationId: string, name: string): Promise<Project> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; name: string; created_at: Date }>('INSERT INTO projects (organization_id, name) VALUES ($1, $2) RETURNING id, organization_id, name, created_at', [organizationId, name]);
      return projectFromRow(requiredRow(result.rows[0]));
    });
  }

  async listProjects(organizationId: string): Promise<Project[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; name: string; created_at: Date }>('SELECT id, organization_id, name, created_at FROM projects WHERE organization_id = $1 ORDER BY created_at DESC', [organizationId]);
      return result.rows.map(projectFromRow);
    });
  }

  async getProject(organizationId: string, id: string): Promise<Project | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; name: string; created_at: Date }>('SELECT id, organization_id, name, created_at FROM projects WHERE organization_id = $1 AND id = $2', [organizationId, id]);
      return result.rows[0] === undefined ? undefined : projectFromRow(result.rows[0]);
    });
  }

  async createTest(organizationId: string, projectId: string, name: string, manifestId: string): Promise<TestRecord> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; project_id: string; name: string; manifest_id: string; created_at: Date }>('INSERT INTO tests (organization_id, project_id, name, manifest_id) VALUES ($1, $2, $3, $4) RETURNING id, organization_id, project_id, name, manifest_id, created_at', [organizationId, projectId, name, manifestId]);
      return testFromRow(requiredRow(result.rows[0]));
    });
  }

  async listTests(organizationId: string): Promise<TestRecord[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; project_id: string; name: string; manifest_id: string; created_at: Date }>('SELECT id, organization_id, project_id, name, manifest_id, created_at FROM tests WHERE organization_id = $1 ORDER BY created_at DESC', [organizationId]);
      return result.rows.map(testFromRow);
    });
  }

  async getTest(organizationId: string, id: string): Promise<TestRecord | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; project_id: string; name: string; manifest_id: string; created_at: Date }>('SELECT id, organization_id, project_id, name, manifest_id, created_at FROM tests WHERE organization_id = $1 AND id = $2', [organizationId, id]);
      return result.rows[0] === undefined ? undefined : testFromRow(result.rows[0]);
    });
  }

  async getTestManifest(organizationId: string, id: string): Promise<unknown | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ manifest: unknown }>('SELECT tv.manifest FROM test_versions tv INNER JOIN tests t ON t.id = tv.test_id WHERE tv.organization_id = $1 AND tv.test_id = $2 ORDER BY tv.created_at DESC LIMIT 1', [organizationId, id]);
      return result.rows[0]?.manifest;
    });
  }

  async updateTestManifest(organizationId: string, id: string, manifest: unknown): Promise<boolean> {
    return this.tenantQuery(organizationId, async (client) => {
      const test = await client.query<{ id: string }>('SELECT id FROM tests WHERE organization_id = $1 AND id = $2', [organizationId, id]);
      if (test.rows[0] === undefined) return false;
      await client.query('INSERT INTO test_versions (organization_id, test_id, commit_sha, manifest) VALUES ($1, $2, $3, $4::jsonb)', [organizationId, id, process.env['GIT_COMMIT_SHA'] ?? 'local', JSON.stringify(manifest)]);
      return true;
    });
  }

  async listManifestVersions(organizationId: string, testId: string): Promise<ManifestVersionRecord[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; test_id: string; commit_sha: string; manifest: unknown; created_at: Date }>('SELECT id, organization_id, test_id, commit_sha, manifest, created_at FROM test_versions WHERE organization_id = $1 AND test_id = $2 ORDER BY created_at DESC, id DESC', [organizationId, testId]);
      return result.rows.map((row, index) => ({ id: row.id, organizationId: row.organization_id, testId: row.test_id, version: result.rows.length - index, commitSha: row.commit_sha, manifest: row.manifest, createdAt: dateValue(row.created_at) }));
    });
  }

  async createRun(organizationId: string, projectId: string, testId: string): Promise<RunRecord> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; project_id: string; test_id: string; status: ServerRunStatus; created_at: Date; started_at: Date | null; ended_at: Date | null }>('INSERT INTO runs (organization_id, project_id, test_id, status) VALUES ($1, $2, $3, $4) RETURNING id, organization_id, project_id, test_id, status, created_at, started_at, ended_at', [organizationId, projectId, testId, 'queued']);
      return runFromRow(requiredRow(result.rows[0]));
    });
  }

  async getRun(id: string, organizationId?: string): Promise<RunRecord | undefined> {
    if (organizationId === undefined) return undefined;
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; project_id: string; test_id: string; status: ServerRunStatus; created_at: Date; started_at: Date | null; ended_at: Date | null }>('SELECT id, organization_id, project_id, test_id, status, created_at, started_at, ended_at FROM runs WHERE organization_id = $1 AND id = $2', [organizationId, id]);
      return result.rows[0] === undefined ? undefined : runFromRow(result.rows[0]);
    });
  }

  async listRuns(organizationId: string): Promise<RunRecord[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; project_id: string; test_id: string; status: ServerRunStatus; created_at: Date; started_at: Date | null; ended_at: Date | null }>('SELECT id, organization_id, project_id, test_id, status, created_at, started_at, ended_at FROM runs WHERE organization_id = $1 ORDER BY created_at DESC', [organizationId]);
      return result.rows.map(runFromRow);
    });
  }

  async updateRun(id: string, patch: RunPatch, organizationId?: string): Promise<RunRecord | undefined> {
    if (organizationId === undefined) return undefined;
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; project_id: string; test_id: string; status: ServerRunStatus; created_at: Date; started_at: Date | null; ended_at: Date | null }>('UPDATE runs SET status = COALESCE($2, status), started_at = COALESCE($3, started_at), ended_at = COALESCE($4, ended_at) WHERE id = $1 RETURNING id, organization_id, project_id, test_id, status, created_at, started_at, ended_at', [id, patch.status ?? null, patch.startedAt ?? null, patch.endedAt ?? null]);
      return result.rows[0] === undefined ? undefined : runFromRow(result.rows[0]);
    });
  }

  async saveRunResult(organizationId: string, runId: string, result: StoredRunResult): Promise<void> {
    await this.tenantQuery(organizationId, async (client) => {
      const status = typeof result['status'] === 'string' ? result['status'] : 'unknown';
      const protocolVersion = typeof result['protocolVersion'] === 'string' ? result['protocolVersion'] : '1.0.0';
      await client.query('DELETE FROM test_results WHERE organization_id = $1 AND run_id = $2', [organizationId, runId]);
      await client.query('INSERT INTO test_results (organization_id, run_id, protocol_version, status, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)', [organizationId, runId, protocolVersion, status, JSON.stringify(result)]);
      for (const step of result.steps) {
        if (step === null || typeof step !== 'object') continue;
        const value = step as { stepId?: unknown; status?: unknown; actions?: unknown };
        if (typeof value.stepId !== 'string' || typeof value.status !== 'string') continue;
        await client.query('INSERT INTO step_results (organization_id, run_id, step_id, status, result) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (organization_id, run_id, step_id) DO UPDATE SET status = EXCLUDED.status, result = EXCLUDED.result', [organizationId, runId, value.stepId, value.status, JSON.stringify(step)]);
        if (!Array.isArray(value.actions)) continue;
        for (const action of value.actions) {
          if (action === null || typeof action !== 'object') continue;
          const actionValue = action as { actionId?: unknown; status?: unknown };
          if (typeof actionValue.actionId !== 'string' || typeof actionValue.status !== 'string') continue;
          await client.query('INSERT INTO action_results (organization_id, run_id, step_id, action_id, status, result) VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT (organization_id, run_id, action_id) DO UPDATE SET status = EXCLUDED.status, result = EXCLUDED.result', [organizationId, runId, value.stepId, actionValue.actionId, actionValue.status, JSON.stringify(action)]);
        }
      }
    });
  }

  async getRunResult(organizationId: string, runId: string): Promise<StoredRunResult | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ metadata: unknown }>('SELECT metadata FROM test_results WHERE organization_id = $1 AND run_id = $2', [organizationId, runId]);
      const row = result.rows[0];
      if (row === undefined || row.metadata === null || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) return undefined;
      const steps = await client.query<{ result: unknown }>('SELECT result FROM step_results WHERE organization_id = $1 AND run_id = $2 ORDER BY created_at, step_id', [organizationId, runId]);
      return { ...(row.metadata as Record<string, unknown>), steps: steps.rows.map((step) => step.result) as unknown[], failures: Array.isArray((row.metadata as { failures?: unknown }).failures) ? (row.metadata as { failures: unknown[] }).failures : [] };
    });
  }

  async createArtifact(organizationId: string, input: Omit<ArtifactMetadata, 'id' | 'organizationId' | 'createdAt'>): Promise<ArtifactMetadata> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; run_id: string; storage_key: string; media_type: string; byte_size: string | number; sha256: string; created_at: Date }>('INSERT INTO artifacts (organization_id, run_id, storage_key, media_type, byte_size, sha256) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, organization_id, run_id, storage_key, media_type, byte_size, sha256, created_at', [organizationId, input.runId, input.storageKey, input.contentType, input.size, input.sha256]);
      return artifactFromRow(requiredRow(result.rows[0]), input.key);
    });
  }

  async listArtifacts(organizationId: string, runId: string): Promise<ArtifactMetadata[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; run_id: string; storage_key: string; media_type: string; byte_size: string | number; sha256: string; created_at: Date }>('SELECT id, organization_id, run_id, storage_key, media_type, byte_size, sha256, created_at FROM artifacts WHERE organization_id = $1 AND run_id = $2 ORDER BY created_at, id', [organizationId, runId]);
      return result.rows.map((row) => artifactFromRow(row, row.storage_key.split('/').slice(2).join('/')));
    });
  }

  async listArtifactsBefore(organizationId: string, before: string): Promise<ArtifactMetadata[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; run_id: string; storage_key: string; media_type: string; byte_size: string | number; sha256: string; created_at: Date }>('SELECT id, organization_id, run_id, storage_key, media_type, byte_size, sha256, created_at FROM artifacts WHERE organization_id = $1 AND created_at < $2 ORDER BY created_at, id', [organizationId, before]);
      return result.rows.map((row) => artifactFromRow(row, row.storage_key.split('/').slice(2).join('/')));
    });
  }

  async deleteArtifact(organizationId: string, artifactId: string): Promise<boolean> {
    return this.tenantQuery(organizationId, async (client) => (await client.query('DELETE FROM artifacts WHERE organization_id = $1 AND id = $2', [organizationId, artifactId])).rowCount === 1);
  }

  async recordAuditEvent(organizationId: string, action: string, resourceType: string, resourceId: string | undefined, metadata: Record<string, unknown>): Promise<void> {
    await this.tenantQuery(organizationId, async (client) => {
      await client.query('INSERT INTO audit_logs (organization_id, action, resource_type, resource_id, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)', [organizationId, action, resourceType, resourceId ?? null, JSON.stringify(metadata)]);
    });
  }

  async listAuditEvents(organizationId: string): Promise<AuditEventRecord[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; action: string; resource_type: string; resource_id: string | null; metadata: Record<string, unknown>; created_at: Date }>('SELECT id, organization_id, action, resource_type, resource_id, metadata, created_at FROM audit_logs WHERE organization_id = $1 ORDER BY created_at DESC, id DESC', [organizationId]);
      return result.rows.map((row) => ({ id: row.id, organizationId: row.organization_id, action: row.action, resourceType: row.resource_type, ...(row.resource_id === null ? {} : { resourceId: row.resource_id }), metadata: row.metadata, createdAt: dateValue(row.created_at) }));
    });
  }

  async getStoragePolicy(organizationId: string): Promise<StoragePolicyRecord> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ organization_id: string; success_retention_days: number; failure_retention_days: number; fixed_retention: boolean; generated_code_retention_days: number; capacity_bytes: string | number | null; updated_at: Date }>('SELECT organization_id, success_retention_days, failure_retention_days, fixed_retention, generated_code_retention_days, capacity_bytes, updated_at FROM storage_policies WHERE organization_id = $1', [organizationId]);
      const row = result.rows[0];
      if (row === undefined) {
        const inserted = await client.query<{ organization_id: string; success_retention_days: number; failure_retention_days: number; fixed_retention: boolean; generated_code_retention_days: number; capacity_bytes: string | number | null; updated_at: Date }>('INSERT INTO storage_policies (organization_id) VALUES ($1) RETURNING organization_id, success_retention_days, failure_retention_days, fixed_retention, generated_code_retention_days, capacity_bytes, updated_at', [organizationId]);
        return storagePolicyFromRow(requiredRow(inserted.rows[0]));
      }
      return storagePolicyFromRow(row);
    });
  }

  async updateStoragePolicy(organizationId: string, patch: Partial<Omit<StoragePolicyRecord, 'organizationId' | 'updatedAt'>>): Promise<StoragePolicyRecord> {
    return this.tenantQuery(organizationId, async (client) => {
      const currentResult = await client.query<{ organization_id: string; success_retention_days: number; failure_retention_days: number; fixed_retention: boolean; generated_code_retention_days: number; capacity_bytes: string | number | null; updated_at: Date }>('SELECT organization_id, success_retention_days, failure_retention_days, fixed_retention, generated_code_retention_days, capacity_bytes, updated_at FROM storage_policies WHERE organization_id = $1', [organizationId]);
      const current = currentResult.rows[0] === undefined
        ? storagePolicyFromRow(requiredRow((await client.query<{ organization_id: string; success_retention_days: number; failure_retention_days: number; fixed_retention: boolean; generated_code_retention_days: number; capacity_bytes: string | number | null; updated_at: Date }>('INSERT INTO storage_policies (organization_id) VALUES ($1) RETURNING organization_id, success_retention_days, failure_retention_days, fixed_retention, generated_code_retention_days, capacity_bytes, updated_at', [organizationId])).rows[0]))
        : storagePolicyFromRow(currentResult.rows[0]);
      const next = { ...current, ...patch };
      const result = await client.query<{ organization_id: string; success_retention_days: number; failure_retention_days: number; fixed_retention: boolean; generated_code_retention_days: number; capacity_bytes: string | number | null; updated_at: Date }>('UPDATE storage_policies SET success_retention_days = $2, failure_retention_days = $3, fixed_retention = $4, generated_code_retention_days = $5, capacity_bytes = $6, updated_at = now() WHERE organization_id = $1 RETURNING organization_id, success_retention_days, failure_retention_days, fixed_retention, generated_code_retention_days, capacity_bytes, updated_at', [organizationId, next.successRetentionDays, next.failureRetentionDays, next.fixedRetention, next.generatedCodeRetentionDays, next.capacityBytes ?? null]);
      return storagePolicyFromRow(requiredRow(result.rows[0]));
    });
  }

  async createAiWorker(organizationId: string, name: string, policy: Record<string, unknown>): Promise<AiWorkerRecord> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; name: string; policy: Record<string, unknown>; last_heartbeat_at: Date | null; created_at: Date }>('INSERT INTO ai_workers (organization_id, name, policy) VALUES ($1, $2, $3::jsonb) RETURNING id, organization_id, name, policy, last_heartbeat_at, created_at', [organizationId, name, JSON.stringify(policy)]);
      return aiWorkerFromRow(requiredRow(result.rows[0]));
    });
  }

  async listAiWorkers(organizationId: string): Promise<AiWorkerRecord[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; name: string; policy: Record<string, unknown>; last_heartbeat_at: Date | null; created_at: Date }>('SELECT id, organization_id, name, policy, last_heartbeat_at, created_at FROM ai_workers WHERE organization_id = $1 ORDER BY created_at DESC', [organizationId]);
      return result.rows.map(aiWorkerFromRow);
    });
  }

  async heartbeatAiWorker(organizationId: string, id: string): Promise<AiWorkerRecord | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; name: string; policy: Record<string, unknown>; last_heartbeat_at: Date | null; created_at: Date }>('UPDATE ai_workers SET last_heartbeat_at = now() WHERE organization_id = $1 AND id = $2 RETURNING id, organization_id, name, policy, last_heartbeat_at, created_at', [organizationId, id]);
      return result.rows[0] === undefined ? undefined : aiWorkerFromRow(result.rows[0]);
    });
  }

  async createAiWorkerJob(organizationId: string, workerId: string, operation: string, request: Record<string, unknown>): Promise<AiWorkerJobRecord> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<AiWorkerJobRow>('INSERT INTO ai_worker_jobs (organization_id, worker_id, operation, request, status) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id, organization_id, worker_id, operation, request, result, status, attempt, lease_expires_at, created_at, updated_at', [organizationId, workerId, operation, JSON.stringify(request), 'queued']);
      return aiWorkerJobFromRow(requiredRow(result.rows[0]));
    });
  }

  async listAiWorkerJobs(organizationId: string): Promise<AiWorkerJobRecord[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<AiWorkerJobRow>('SELECT id, organization_id, worker_id, operation, request, result, status, attempt, lease_expires_at, created_at, updated_at FROM ai_worker_jobs WHERE organization_id = $1 ORDER BY created_at DESC, id DESC', [organizationId]);
      return result.rows.map(aiWorkerJobFromRow);
    });
  }

  async leaseAiWorkerJob(workerId: string, organizationId: string): Promise<AiWorkerJobRecord | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      await client.query("UPDATE ai_worker_jobs SET status = 'queued', lease_expires_at = NULL, updated_at = now() WHERE organization_id = $1 AND worker_id = $2 AND status = 'leased' AND lease_expires_at < now()", [organizationId, workerId]);
      const next = await client.query<AiWorkerJobRow>('SELECT id, organization_id, worker_id, operation, request, result, status, attempt, lease_expires_at, created_at, updated_at FROM ai_worker_jobs WHERE organization_id = $1 AND worker_id = $2 AND status = \'queued\' ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED', [organizationId, workerId]);
      const row = next.rows[0];
      if (row === undefined) return undefined;
      const leased = await client.query<AiWorkerJobRow>("UPDATE ai_worker_jobs SET status = 'leased', attempt = attempt + 1, lease_expires_at = now() + interval '5 minutes', updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING id, organization_id, worker_id, operation, request, result, status, attempt, lease_expires_at, created_at, updated_at", [organizationId, row.id]);
      return aiWorkerJobFromRow(requiredRow(leased.rows[0]));
    });
  }

  async completeAiWorkerJob(organizationId: string, jobId: string, status: 'completed' | 'failed' | 'cancelled', result?: Record<string, unknown>): Promise<AiWorkerJobRecord | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      const updated = await client.query<AiWorkerJobRow>('UPDATE ai_worker_jobs SET status = $3, result = COALESCE($4::jsonb, result), lease_expires_at = NULL, updated_at = now() WHERE organization_id = $1 AND id = $2 AND status = \'leased\' RETURNING id, organization_id, worker_id, operation, request, result, status, attempt, lease_expires_at, created_at, updated_at', [organizationId, jobId, status, result === undefined ? null : JSON.stringify(result)]);
      return updated.rows[0] === undefined ? undefined : aiWorkerJobFromRow(updated.rows[0]);
    });
  }

  async createSecret(organizationId: string, input: { name: string; provider: string; projectId?: string; environmentId?: string; externalReference?: string; value?: string }): Promise<SecretRecord> {
    return this.tenantQuery(organizationId, async (client) => {
      const encryptedValue = input.value === undefined ? null : encryptSecretValue(input.value, secretEncryptionKey());
      const result = await client.query<SecretRow>('INSERT INTO secrets (organization_id, project_id, environment_id, name, provider, external_reference, encrypted_value, rotated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 IS NULL THEN NULL ELSE now() END) RETURNING id, organization_id, project_id, environment_id, name, provider, external_reference, encrypted_value, rotated_at, created_at', [organizationId, input.projectId ?? null, input.environmentId ?? null, input.name, input.provider, input.externalReference ?? null, encryptedValue]);
      return secretFromRow(requiredRow(result.rows[0]));
    });
  }

  async listSecrets(organizationId: string): Promise<SecretRecord[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<SecretRow>('SELECT id, organization_id, project_id, environment_id, name, provider, external_reference, encrypted_value, rotated_at, created_at FROM secrets WHERE organization_id = $1 ORDER BY created_at DESC, id DESC', [organizationId]);
      return result.rows.map((row) => secretFromRow(row));
    });
  }

  async rotateSecret(organizationId: string, id: string, value: string): Promise<SecretRecord | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<SecretRow>('UPDATE secrets SET encrypted_value = $3, rotated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING id, organization_id, project_id, environment_id, name, provider, external_reference, encrypted_value, rotated_at, created_at', [organizationId, id, encryptSecretValue(value, secretEncryptionKey())]);
      return result.rows[0] === undefined ? undefined : secretFromRow(result.rows[0], value);
    });
  }

  async getSecretValue(organizationId: string, id: string): Promise<string | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ encrypted_value: string | null }>('SELECT encrypted_value FROM secrets WHERE organization_id = $1 AND id = $2', [organizationId, id]);
      const value = result.rows[0]?.encrypted_value;
      return value === null || value === undefined ? undefined : decryptSecretValue(value, secretEncryptionKey());
    });
  }

  async getArtifact(organizationId: string, artifactId: string): Promise<ArtifactMetadata | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; run_id: string; storage_key: string; media_type: string; byte_size: string | number; sha256: string; created_at: Date }>('SELECT id, organization_id, run_id, storage_key, media_type, byte_size, sha256, created_at FROM artifacts WHERE organization_id = $1 AND id = $2', [organizationId, artifactId]);
      const row = result.rows[0];
      return row === undefined ? undefined : artifactFromRow(row, row.storage_key.split('/').slice(2).join('/'));
    });
  }

  async createRepository(organizationId: string, input: { owner: string; name: string; provider?: string; installationId?: number }): Promise<RepositoryRecord> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<RepositoryRow>(
        "INSERT INTO repositories (organization_id, full_name, \"owner\", name, default_branch, provider, installation_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, organization_id, full_name, \"owner\", name, default_branch, private, provider, github_repository_id, installation_id, created_at",
        [organizationId, `${input.owner}/${input.name}`, input.owner, input.name, 'main', input.provider ?? 'github', input.installationId ?? null],
      );
      return repositoryFromRow(requiredRow(result.rows[0]));
    });
  }

  async getRepository(organizationId: string, id: string): Promise<RepositoryRecord | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<RepositoryRow>(
        "SELECT id, organization_id, full_name, \"owner\", name, default_branch, private, provider, github_repository_id, installation_id, created_at FROM repositories WHERE organization_id = $1 AND id = $2",
        [organizationId, id],
      );
      return result.rows[0] === undefined ? undefined : repositoryFromRow(result.rows[0]);
    });
  }

  async listRepositories(organizationId: string): Promise<RepositoryRecord[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<RepositoryRow>(
        "SELECT id, organization_id, full_name, \"owner\", name, default_branch, private, provider, github_repository_id, installation_id, created_at FROM repositories WHERE organization_id = $1 ORDER BY created_at DESC",
        [organizationId],
      );
      return result.rows.map(repositoryFromRow);
    });
  }

  async updateRepository(organizationId: string, id: string, patch: { fullName?: string; defaultBranch?: string; private?: boolean; githubRepositoryId?: number | null; installationId?: number | null }): Promise<RepositoryRecord | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<RepositoryRow>(
        `UPDATE repositories SET
          full_name = COALESCE($3, full_name),
          default_branch = COALESCE($4, default_branch),
          private = COALESCE($5, private),
          github_repository_id = COALESCE($6, github_repository_id),
          installation_id = COALESCE($7, installation_id)
        WHERE id = $1 AND organization_id = $2
        RETURNING id, organization_id, full_name, "owner", name, default_branch, private, provider, github_repository_id, installation_id, created_at`,
        [id, organizationId, patch.fullName ?? null, patch.defaultBranch ?? null, patch.private ?? null, patch.githubRepositoryId ?? null, patch.installationId ?? null],
      );
      return result.rows[0] === undefined ? undefined : repositoryFromRow(result.rows[0]);
    });
  }

  async createSchedule(organizationId: string, projectId: string, testId: string, cron: string, enabled?: boolean): Promise<ScheduleRecord> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; project_id: string; test_id: string; cron: string; enabled: boolean; created_at: Date }>(
        'INSERT INTO schedules (organization_id, project_id, test_id, cron, enabled) VALUES ($1, $2, $3, $4, $5) RETURNING id, organization_id, project_id, test_id, cron, enabled, created_at',
        [organizationId, projectId, testId, cron, enabled ?? true],
      );
      return scheduleFromRow(requiredRow(result.rows[0]));
    });
  }

  async listSchedules(organizationId: string): Promise<ScheduleRecord[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; project_id: string; test_id: string; cron: string; enabled: boolean; created_at: Date }>(
        'SELECT id, organization_id, project_id, test_id, cron, enabled, created_at FROM schedules WHERE organization_id = $1 ORDER BY created_at DESC',
        [organizationId],
      );
      return result.rows.map(scheduleFromRow);
    });
  }

  async createChangeRequest(organizationId: string, title: string, description?: string): Promise<ChangeRequestRecord> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; title: string; description: string; status: string; created_at: Date; updated_at: Date }>(
        'INSERT INTO change_requests (organization_id, title, description) VALUES ($1, $2, $3) RETURNING id, organization_id, title, description, status, created_at, updated_at',
        [organizationId, title, description ?? ''],
      );
      return changeRequestFromRow(requiredRow(result.rows[0]));
    });
  }

  async listChangeRequests(organizationId: string): Promise<ChangeRequestRecord[]> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; title: string; description: string; status: string; created_at: Date; updated_at: Date }>(
        'SELECT id, organization_id, title, description, status, created_at, updated_at FROM change_requests WHERE organization_id = $1 ORDER BY created_at DESC',
        [organizationId],
      );
      return result.rows.map(changeRequestFromRow);
    });
  }

  async getChangeRequest(organizationId: string, id: string): Promise<ChangeRequestRecord | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; title: string; description: string; status: string; created_at: Date; updated_at: Date }>(
        'SELECT id, organization_id, title, description, status, created_at, updated_at FROM change_requests WHERE organization_id = $1 AND id = $2',
        [organizationId, id],
      );
      return result.rows[0] === undefined ? undefined : changeRequestFromRow(result.rows[0]);
    });
  }

  async updateChangeRequest(organizationId: string, id: string, patch: { status?: ChangeRequestRecord['status']; description?: string }): Promise<ChangeRequestRecord | undefined> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; title: string; description: string; status: string; created_at: Date; updated_at: Date }>(
        `UPDATE change_requests SET
          status = COALESCE($3, status),
          description = COALESCE($4, description),
          updated_at = now()
        WHERE organization_id = $1 AND id = $2
        RETURNING id, organization_id, title, description, status, created_at, updated_at`,
        [organizationId, id, patch.status ?? null, patch.description ?? null],
      );
      return result.rows[0] === undefined ? undefined : changeRequestFromRow(result.rows[0]);
    });
  }

  async createRepair(organizationId: string, runId: string, reason: string): Promise<RepairRecord> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; run_id: string; category: string; status: string; created_at: Date }>(
        'INSERT INTO repair_attempts (organization_id, run_id, attempt, category, status) VALUES ($1, $2, $3, $4, $5) RETURNING id, organization_id, run_id, category, status, created_at',
        [organizationId, runId, 1, reason, 'queued'],
      );
      return repairFromRow(requiredRow(result.rows[0]));
    });
  }

  async createPullRequest(organizationId: string, url: string): Promise<PullRequestRecord> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; url: string; created_at: Date }>(
        'INSERT INTO pull_requests (organization_id, url) VALUES ($1, $2) RETURNING id, organization_id, url, created_at',
        [organizationId, url],
      );
      return pullRequestFromRow(requiredRow(result.rows[0]));
    });
  }
}

function dateValue(value: Date | string): string { return value instanceof Date ? value.toISOString() : value; }
function requiredRow<T>(row: T | undefined): T { if (row === undefined) throw new Error('PostgreSQL INSERT returned no row'); return row; }

function organizationFromRow(row: { id: string; name: string; created_at: Date }): Organization { return { id: row.id, name: row.name, createdAt: dateValue(row.created_at) }; }
function projectFromRow(row: { id: string; organization_id: string; name: string; created_at: Date }): Project { return { id: row.id, organizationId: row.organization_id, name: row.name, createdAt: dateValue(row.created_at) }; }
function testFromRow(row: { id: string; organization_id: string; project_id: string; name: string; manifest_id: string; created_at: Date }): TestRecord { return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, name: row.name, manifestId: row.manifest_id, createdAt: dateValue(row.created_at) }; }
function storagePolicyFromRow(row: { organization_id: string; success_retention_days: number; failure_retention_days: number; fixed_retention: boolean; generated_code_retention_days: number; capacity_bytes: string | number | null; updated_at: Date }): StoragePolicyRecord { return { organizationId: row.organization_id, successRetentionDays: row.success_retention_days, failureRetentionDays: row.failure_retention_days, fixedRetention: row.fixed_retention, generatedCodeRetentionDays: row.generated_code_retention_days, ...(row.capacity_bytes === null ? {} : { capacityBytes: Number(row.capacity_bytes) }), updatedAt: dateValue(row.updated_at) }; }
function aiWorkerFromRow(row: { id: string; organization_id: string; name: string; policy: Record<string, unknown>; last_heartbeat_at: Date | null; created_at: Date }): AiWorkerRecord { return { id: row.id, organizationId: row.organization_id, name: row.name, policy: row.policy, ...(row.last_heartbeat_at === null ? {} : { lastHeartbeatAt: dateValue(row.last_heartbeat_at) }), createdAt: dateValue(row.created_at) }; }
interface AiWorkerJobRow { id: string; organization_id: string; worker_id: string; operation: string; request: Record<string, unknown>; result: Record<string, unknown> | null; status: AiWorkerJobRecord['status']; attempt: number; lease_expires_at: Date | null; created_at: Date; updated_at: Date; }
function aiWorkerJobFromRow(row: AiWorkerJobRow): AiWorkerJobRecord { return { id: row.id, organizationId: row.organization_id, workerId: row.worker_id, operation: row.operation, request: row.request, ...(row.result === null ? {} : { result: row.result }), status: row.status, attempt: row.attempt, ...(row.lease_expires_at === null ? {} : { leaseExpiresAt: dateValue(row.lease_expires_at) }), createdAt: dateValue(row.created_at), updatedAt: dateValue(row.updated_at) }; }
interface SecretRow { id: string; organization_id: string; project_id: string | null; environment_id: string | null; name: string; provider: string; external_reference: string | null; encrypted_value: string | null; rotated_at: Date | null; created_at: Date; }
function secretFromRow(row: SecretRow, rotatedValue?: string): SecretRecord { return { id: row.id, organizationId: row.organization_id, ...(row.project_id === null ? {} : { projectId: row.project_id }), ...(row.environment_id === null ? {} : { environmentId: row.environment_id }), name: row.name, provider: row.provider, ...(row.external_reference === null ? {} : { externalReference: row.external_reference }), maskedValue: rotatedValue === undefined ? row.encrypted_value === null ? '[EXTERNAL]' : '[REDACTED]' : maskValue(rotatedValue), ...(row.rotated_at === null ? {} : { rotatedAt: dateValue(row.rotated_at) }), createdAt: dateValue(row.created_at) }; }
function maskValue(value: string): string { return value.length <= 4 ? '[REDACTED]' : `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`; }
function secretEncryptionKey(): string { return process.env['OPENTESTPILOT_SECRET_KEY'] ?? 'open-test-pilot-development-key'; }
function encryptSecretValue(value: string, key: string): string { const salt = randomBytes(16); const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', scryptSync(key, salt, 32), iv); const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return [salt, iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.'); }
function decryptSecretValue(encoded: string, key: string): string { const parts = encoded.split('.').map((part) => Buffer.from(part, 'base64url')); if (parts.length !== 4) throw new Error('invalid encrypted secret'); const [salt, iv, tag, body] = parts as [Buffer, Buffer, Buffer, Buffer]; const decipher = createDecipheriv('aes-256-gcm', scryptSync(key, salt, 32), iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'); }
function runFromRow(row: { id: string; organization_id: string; project_id: string; test_id: string; status: ServerRunStatus; created_at: Date; started_at: Date | null; ended_at: Date | null }): RunRecord { return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, testId: row.test_id, status: row.status, createdAt: dateValue(row.created_at), ...(row.started_at === null ? {} : { startedAt: dateValue(row.started_at) }), ...(row.ended_at === null ? {} : { endedAt: dateValue(row.ended_at) }) }; }
function artifactFromRow(row: { id: string; organization_id: string; run_id: string; storage_key: string; media_type: string; byte_size: string | number; sha256: string; created_at: Date }, key: string): ArtifactMetadata { return { id: row.id, organizationId: row.organization_id, runId: row.run_id, key, contentType: row.media_type, size: Number(row.byte_size), storageKey: row.storage_key, sha256: row.sha256, createdAt: dateValue(row.created_at) }; }

interface RepositoryRow { id: string; organization_id: string; full_name: string; owner: string; name: string; default_branch: string; private: boolean; provider: string; github_repository_id: string | null; installation_id: string | null; created_at: Date; }

function repositoryFromRow(row: RepositoryRow): RepositoryRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    owner: row.owner,
    name: row.name,
    fullName: row.full_name,
    defaultBranch: row.default_branch,
    private: row.private,
    provider: row.provider,
    ...(row.github_repository_id === null ? {} : { githubRepositoryId: Number(row.github_repository_id) }),
    ...(row.installation_id === null ? {} : { installationId: Number(row.installation_id) }),
    createdAt: dateValue(row.created_at),
  };
}

function scheduleFromRow(row: { id: string; organization_id: string; project_id: string; test_id: string; cron: string; enabled: boolean; created_at: Date }): ScheduleRecord {
  return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, testId: row.test_id, cron: row.cron, enabled: row.enabled, createdAt: dateValue(row.created_at) };
}

function changeRequestFromRow(row: { id: string; organization_id: string; title: string; description: string; status: string; created_at: Date; updated_at: Date }): ChangeRequestRecord {
  return { id: row.id, organizationId: row.organization_id, title: row.title, description: row.description, status: row.status as ChangeRequestRecord['status'], createdAt: dateValue(row.created_at), updatedAt: dateValue(row.updated_at) };
}

function repairFromRow(row: { id: string; organization_id: string; run_id: string; category: string; status: string; created_at: Date }): RepairRecord {
  return { id: row.id, organizationId: row.organization_id, runId: row.run_id, reason: row.category, status: row.status as RepairRecord['status'], createdAt: dateValue(row.created_at) };
}

function pullRequestFromRow(row: { id: string; organization_id: string; url: string; created_at: Date }): PullRequestRecord {
  return { id: row.id, organizationId: row.organization_id, url: row.url, createdAt: dateValue(row.created_at) };
}
