-- Incremental migration after 20261009_password_welcome.sql.
-- Stop old application instances before applying, then deploy the hardened auth code.
BEGIN;
ALTER TABLE auth_otp_challenges ADD COLUMN IF NOT EXISTS password_hash_at_issue text;
ALTER TABLE auth_signup_tickets ADD COLUMN IF NOT EXISTS hash_started_at timestamptz;
ALTER TABLE auth_password_tickets ADD COLUMN IF NOT EXISTS hash_started_at timestamptz;
-- Old challenges have no trustworthy issuance snapshot. Never reconstruct it at verify time.
UPDATE auth_otp_challenges SET consumed_at = now()
WHERE purpose IN ('PASSWORD_SETUP', 'PASSWORD_RESET') AND consumed_at IS NULL;
-- Existing password tickets may have originated from the vulnerable verify-time snapshot.
UPDATE auth_password_tickets SET consumed_at = now() WHERE consumed_at IS NULL;
COMMIT;
