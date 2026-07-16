-- Idempotent RLS reinforcement for schedules, change_requests, pull_requests,
-- and repair_attempts.  Earlier migrations create these tables with policies and
-- FORCE ROW LEVEL SECURITY, but a dedicated post-006 checkpoint ensures tenant
-- isolation survives any drift across deployments.
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['schedules', 'change_requests', 'pull_requests', 'repair_attempts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name);
    EXECUTE format('CREATE POLICY %I ON %I USING (organization_id = current_setting(''app.organization_id'', true)::uuid)', table_name || '_tenant_isolation', table_name);
  END LOOP;
END $$;
