-- Extend repositories for GitHub App sync with locally-created records.
-- Locally-created repositories have no github_repository_id yet and are synced
-- later through the /v1/repositories/:id/sync endpoint.

ALTER TABLE repositories ALTER COLUMN github_repository_id DROP NOT NULL;

ALTER TABLE repositories ADD COLUMN IF NOT EXISTS "owner" text;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS private boolean NOT NULL DEFAULT false;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'github';
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS installation_id bigint;

UPDATE repositories
   SET "owner" = split_part(full_name, '/', 1),
       name = split_part(full_name, '/', 2)
 WHERE "owner" IS NULL;

ALTER TABLE repositories ALTER COLUMN "owner" SET NOT NULL;
ALTER TABLE repositories ALTER COLUMN name SET NOT NULL;

ALTER TABLE repositories FORCE ROW LEVEL SECURITY;
