-- Apply enum additions separately and commit before the remaining statements.
ALTER TYPE auth_otp_purpose ADD VALUE IF NOT EXISTS 'PASSWORD_SETUP';
ALTER TYPE auth_otp_purpose ADD VALUE IF NOT EXISTS 'PASSWORD_RESET';
ALTER TYPE coupon_type ADD VALUE IF NOT EXISTS 'FREE_ENTRY';
-- Remaining statements can run in one transaction after the enum commit.
ALTER TABLE members ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS source text;
CREATE UNIQUE INDEX IF NOT EXISTS coupons_member_source_unique ON coupons(member_id, source);
CREATE TABLE IF NOT EXISTS auth_login_limits (phone varchar(20) PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS auth_password_tickets (id serial PRIMARY KEY, phone varchar(20) NOT NULL, purpose auth_otp_purpose NOT NULL, password_hash_at_issue text, token_hash varchar(64) UNIQUE NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz);
UPDATE auth_otp_challenges SET consumed_at = now() WHERE purpose = 'LOGIN' AND consumed_at IS NULL;
-- Existing members deliberately receive neither a password nor a welcome coupon.
