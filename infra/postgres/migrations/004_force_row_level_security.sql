-- Table owners bypass RLS by default. Force policies for the application role too.
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'projects','repositories','tests','test_versions','runners','jobs','runs','artifacts','audit_logs',
    'project_memberships','repository_installations','branches','commits','manifests','generated_codes',
    'change_requests','pull_requests','runner_capabilities','schedules','repair_attempts',
    'test_results','step_results','action_results','runner_groups','environments','secrets',
    'secret_references','storage_policies','github_checks','notifications','ai_workers','plugins','plugin_versions'
  ] LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;
