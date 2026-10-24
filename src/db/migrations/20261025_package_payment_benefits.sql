-- PREPARE ONLY. Apply manually AFTER real_package_payments, payment_promptpay,
-- kiosk, real_benefits_admin, real_rewards and real_frontdesk migrations.
-- Deploy with the BUSINESS.md package catalog. No historical grants/backfill:
-- existing orders (including pending orders) retain NULL eligibility.
-- BUSINESS.md does not specify coupon expiry. Conservative assumption: freeze
-- each coupon's expiry at this order's membership_expires_at, not a later renewal.
-- Bonus days are redeemable coupons, NEVER automatic membership extensions.
BEGIN;
ALTER TABLE package_payment_orders ADD COLUMN package_benefits_version integer
 CHECK(package_benefits_version IS NULL OR package_benefits_version=1);
ALTER TABLE package_payment_orders ALTER COLUMN package_benefits_version SET DEFAULT 1;

-- One wallet row per order and coupon type, carrying the full friend quota.
-- A source identifies its order globally, independent of the member uniqueness.
CREATE UNIQUE INDEX coupons_package_order_source_unique ON coupons(source)
 WHERE source LIKE 'PACKAGE_ORDER:%';

CREATE FUNCTION protect_package_benefits_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF NEW.package_benefits_version IS DISTINCT FROM OLD.package_benefits_version THEN
 RAISE EXCEPTION 'Package benefit eligibility is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER package_benefits_version_guard BEFORE UPDATE ON package_payment_orders
 FOR EACH ROW EXECUTE FUNCTION protect_package_benefits_version();

-- Runs inside the existing finalizer transaction, after its PAID update. Any
-- issuance error rolls back transfer claim, points, membership and PAID together.
-- Never replace/wrap the finalizer: preserve kiosk NORMAL auth, evidence checks,
-- member-before-order locks and terminal replay behavior exactly as installed.
CREATE FUNCTION issue_paid_package_benefits() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE friends integer; days integer;
BEGIN
 IF OLD.status<>'PENDING' OR NEW.status<>'PAID' OR NEW.package_benefits_version IS DISTINCT FROM 1 THEN
 RETURN NEW; END IF;
 -- package_snapshot is immutable and comes from quotePackage's server catalog,
 -- not the browser payload. Fail closed for malformed new snapshots.
 IF jsonb_typeof(NEW.package_snapshot->'friendCoupons') IS DISTINCT FROM 'number'
 OR jsonb_typeof(NEW.package_snapshot->'bonusDays') IS DISTINCT FROM 'number'
 OR (NEW.package_snapshot->>'friendCoupons') !~ '^(0|5|10)$'
 OR (NEW.package_snapshot->>'bonusDays') !~ '^(0|15|30|60)$' THEN
 RAISE EXCEPTION 'Invalid package benefit snapshot'; END IF;
 friends:=(NEW.package_snapshot->>'friendCoupons')::integer;
 days:=(NEW.package_snapshot->>'bonusDays')::integer;
 IF NEW.membership_expires_at IS NULL THEN RAISE EXCEPTION 'Membership expiry required'; END IF;
 IF friends>0 THEN
 INSERT INTO coupons(member_id,source,type,title,total_quota,used_count,bonus_days_value,expire_date,status)
 VALUES(NEW.member_id,'PACKAGE_ORDER:'||NEW.id||':FRIEND_PASS','FRIEND_PASS','คูปองพาเพื่อนจากแพ็กเกจ',friends,0,0,NEW.membership_expires_at,'AVAILABLE');
 END IF;
 IF days>0 THEN
 INSERT INTO coupons(member_id,source,type,title,total_quota,used_count,bonus_days_value,expire_date,status)
 VALUES(NEW.member_id,'PACKAGE_ORDER:'||NEW.id||':EXTRA_DAYS','EXTRA_DAYS','คูปองเพิ่มวันจากแพ็กเกจ',1,0,days,NEW.membership_expires_at,'AVAILABLE');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER package_paid_benefits AFTER UPDATE OF status ON package_payment_orders
 FOR EACH ROW EXECUTE FUNCTION issue_paid_package_benefits();
REVOKE ALL ON FUNCTION protect_package_benefits_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION issue_paid_package_benefits() FROM PUBLIC;
COMMIT;
