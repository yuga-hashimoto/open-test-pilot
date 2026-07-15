import { Pool, type PoolClient } from 'pg';
import type { Organization, Project, RunRecord, ServerRunStatus, TenantRepository, TestRecord } from './index.js';

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

  async createRun(organizationId: string, projectId: string, testId: string): Promise<RunRecord> {
    return this.tenantQuery(organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; project_id: string; test_id: string; status: ServerRunStatus; created_at: Date; started_at: Date | null; ended_at: Date | null }>('INSERT INTO runs (organization_id, project_id, test_id, status) VALUES ($1, $2, $3, $4) RETURNING id, organization_id, project_id, test_id, status, created_at, started_at, ended_at', [organizationId, projectId, testId, 'queued']);
      return runFromRow(requiredRow(result.rows[0]));
    });
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    const result = await this.pool.query<{ id: string; organization_id: string; project_id: string; test_id: string; status: ServerRunStatus; created_at: Date; started_at: Date | null; ended_at: Date | null }>('SELECT id, organization_id, project_id, test_id, status, created_at, started_at, ended_at FROM runs WHERE id = $1', [id]);
    return result.rows[0] === undefined ? undefined : runFromRow(result.rows[0]);
  }

  async updateRun(id: string, patch: RunPatch): Promise<RunRecord | undefined> {
    const existing = await this.getRun(id);
    if (existing === undefined) return undefined;
    return this.tenantQuery(existing.organizationId, async (client) => {
      const result = await client.query<{ id: string; organization_id: string; project_id: string; test_id: string; status: ServerRunStatus; created_at: Date; started_at: Date | null; ended_at: Date | null }>('UPDATE runs SET status = COALESCE($2, status), started_at = COALESCE($3, started_at), ended_at = COALESCE($4, ended_at) WHERE id = $1 RETURNING id, organization_id, project_id, test_id, status, created_at, started_at, ended_at', [id, patch.status ?? null, patch.startedAt ?? null, patch.endedAt ?? null]);
      return result.rows[0] === undefined ? undefined : runFromRow(result.rows[0]);
    });
  }
}

function dateValue(value: Date | string): string { return value instanceof Date ? value.toISOString() : value; }
function requiredRow<T>(row: T | undefined): T { if (row === undefined) throw new Error('PostgreSQL INSERT returned no row'); return row; }

function organizationFromRow(row: { id: string; name: string; created_at: Date }): Organization { return { id: row.id, name: row.name, createdAt: dateValue(row.created_at) }; }
function projectFromRow(row: { id: string; organization_id: string; name: string; created_at: Date }): Project { return { id: row.id, organizationId: row.organization_id, name: row.name, createdAt: dateValue(row.created_at) }; }
function testFromRow(row: { id: string; organization_id: string; project_id: string; name: string; manifest_id: string; created_at: Date }): TestRecord { return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, name: row.name, manifestId: row.manifest_id, createdAt: dateValue(row.created_at) }; }
function runFromRow(row: { id: string; organization_id: string; project_id: string; test_id: string; status: ServerRunStatus; created_at: Date; started_at: Date | null; ended_at: Date | null }): RunRecord { return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, testId: row.test_id, status: row.status, createdAt: dateValue(row.created_at), ...(row.started_at === null ? {} : { startedAt: dateValue(row.started_at) }), ...(row.ended_at === null ? {} : { endedAt: dateValue(row.ended_at) }) }; }
