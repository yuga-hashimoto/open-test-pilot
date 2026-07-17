CREATE TABLE IF NOT EXISTS ai_worker_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES ai_workers(id) ON DELETE CASCADE,
  operation text NOT NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  status text NOT NULL CHECK (status IN ('queued', 'leased', 'completed', 'failed', 'cancelled')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_worker_jobs_lease_idx ON ai_worker_jobs (organization_id, worker_id, status, created_at);
ALTER TABLE ai_worker_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_worker_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_worker_jobs_tenant_isolation ON ai_worker_jobs;
CREATE POLICY ai_worker_jobs_tenant_isolation ON ai_worker_jobs
  USING (organization_id = current_setting('app.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);
