-- Encrypted values are stored only for the built-in provider. API responses expose metadata only.
ALTER TABLE secrets ADD COLUMN IF NOT EXISTS encrypted_value text;
