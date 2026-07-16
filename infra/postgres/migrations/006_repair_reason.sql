-- Add reason column to repair_attempts for alignment with application-layer concept.
-- The category column remains for backward compatibility but is relaxed to optional.
ALTER TABLE repair_attempts ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE repair_attempts ALTER COLUMN category DROP NOT NULL;
UPDATE repair_attempts SET reason = category WHERE reason IS NULL AND category IS NOT NULL;
