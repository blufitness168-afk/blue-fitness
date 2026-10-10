-- PREPARE ONLY. Revised unapplied migration; NEVER apply while writers are running.
-- Existing member/points/payment values are not changed by top-level statements.
BEGIN;
CREATE TABLE payment_transfer_refs (
 trans_ref varchar(100) PRIMARY KEY, source text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO payment_transfer_refs(trans_ref, source)
SELECT easyslip_trans_ref, 'LEGACY_PAYMENT' FROM payments WHERE easyslip_trans_ref IS NOT NULL;
CREATE UNIQUE INDEX payments_easyslip_trans_ref_unique ON payments(easyslip_trans_ref);
CREATE FUNCTION protect_legacy_payment_ref() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND OLD.easyslip_trans_ref IS DISTINCT FROM NEW.easyslip_trans_ref AND OLD.easyslip_trans_ref IS NOT NULL THEN RAISE EXCEPTION 'Payment transfer reference is immutable'; END IF;
 IF NEW.easyslip_trans_ref IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.easyslip_trans_ref IS NULL) THEN INSERT INTO payment_transfer_refs(trans_ref, source) VALUES(NEW.easyslip_trans_ref, 'LEGACY_PAYMENT'); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payments_transfer_ref_guard BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION protect_legacy_payment_ref();

CREATE TABLE package_payment_orders (
 id uuid PRIMARY KEY, member_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL, package_snapshot jsonb NOT NULL, receiver_snapshot jsonb NOT NULL,
 subtotal_satang integer NOT NULL CHECK(subtotal_satang > 0), discount_satang integer NOT NULL CHECK(discount_satang >= 0),
 amount_satang integer NOT NULL CHECK(amount_satang > 0 AND amount_satang = subtotal_satang - discount_satang),
 promo_snapshot jsonb, promo_code text, points_earned integer NOT NULL CHECK(points_earned = amount_satang / 2000),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','REJECTED')),
 rejection_reason text, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 upload_deadline timestamptz NOT NULL, paid_at timestamptz, confirmed_at timestamptz,
 membership_expires_at timestamptz, verification_snapshot jsonb,
 trans_ref varchar(100) UNIQUE REFERENCES payment_transfer_refs(trans_ref), UNIQUE(member_id, request_key),
 CHECK(expires_at = created_at + interval '15 minutes'),
 CHECK(upload_deadline = expires_at + interval '30 minutes'),
 CHECK((status = 'REJECTED') = (rejection_reason IS NOT NULL)),
 CHECK((status = 'PAID' AND paid_at IS NOT NULL AND confirmed_at IS NOT NULL AND trans_ref IS NOT NULL AND membership_expires_at IS NOT NULL AND verification_snapshot IS NOT NULL)
    OR (status <> 'PAID' AND paid_at IS NULL AND confirmed_at IS NULL AND trans_ref IS NULL AND membership_expires_at IS NULL AND verification_snapshot IS NULL))
);
CREATE INDEX package_payment_orders_member_created ON package_payment_orders(member_id, created_at DESC);
CREATE INDEX package_payment_orders_promo ON package_payment_orders(promo_code, upload_deadline);
CREATE TABLE package_payment_attempts (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES package_payment_orders(id) ON DELETE RESTRICT,
 image_sha256 varchar(64) NOT NULL, lease_token uuid NOT NULL,
 provider_calls integer NOT NULL DEFAULT 1 CHECK(provider_calls BETWEEN 1 AND 2),
 state text NOT NULL CHECK(state IN ('PROCESSING','UNKNOWN','REJECTED','VERIFIED')),
 rejection_reason text, evidence jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id, image_sha256), CHECK((state = 'REJECTED') = (rejection_reason IS NOT NULL)),
 CHECK((state = 'VERIFIED' AND evidence IS NOT NULL) OR (state = 'REJECTED') OR (state IN ('PROCESSING','UNKNOWN') AND evidence IS NULL))
);
CREATE UNIQUE INDEX package_payment_one_inflight ON package_payment_attempts(order_id) WHERE state IN ('PROCESSING','UNKNOWN','VERIFIED');
CREATE TABLE package_payment_point_ledger (
 order_id uuid PRIMARY KEY REFERENCES package_payment_orders(id) ON DELETE RESTRICT,
 member_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT, delta integer NOT NULL CHECK(delta >= 0),
 balance_after integer NOT NULL CHECK(balance_after >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE package_payment_resolution_audit (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES package_payment_orders(id) ON DELETE RESTRICT,
 attempt_id uuid NOT NULL REFERENCES package_payment_attempts(id) ON DELETE RESTRICT,
 actor_member_id integer NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('AUTO_REJECT','OWNER_REJECT')),
 reason_code text NOT NULL, reason text NOT NULL, reconciliation_evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_payment_resolution_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Payment resolution audit is append-only'; END $$;
CREATE TRIGGER payment_resolution_audit_guard BEFORE UPDATE OR DELETE ON package_payment_resolution_audit FOR EACH ROW EXECUTE FUNCTION protect_payment_resolution_audit();

CREATE FUNCTION protect_package_order_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.member_id,NEW.request_key,NEW.package_snapshot,NEW.receiver_snapshot,NEW.subtotal_satang,NEW.discount_satang,NEW.amount_satang,NEW.promo_snapshot,NEW.promo_code,NEW.points_earned,NEW.created_at,NEW.expires_at,NEW.upload_deadline)
 IS DISTINCT FROM (OLD.id,OLD.member_id,OLD.request_key,OLD.package_snapshot,OLD.receiver_snapshot,OLD.subtotal_satang,OLD.discount_satang,OLD.amount_satang,OLD.promo_snapshot,OLD.promo_code,OLD.points_earned,OLD.created_at,OLD.expires_at,OLD.upload_deadline) THEN RAISE EXCEPTION 'Payment order snapshot is immutable'; END IF;
 IF OLD.status IN ('PAID','REJECTED') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Terminal order is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER package_order_snapshot_guard BEFORE UPDATE ON package_payment_orders FOR EACH ROW EXECUTE FUNCTION protect_package_order_snapshot();

CREATE FUNCTION protect_package_payment_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment attempt cannot be deleted'; END IF;
 IF (NEW.id,NEW.order_id,NEW.image_sha256,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.order_id,OLD.image_sha256,OLD.created_at) THEN RAISE EXCEPTION 'Attempt identity is immutable'; END IF;
 IF OLD.evidence IS NOT NULL AND NEW.evidence IS DISTINCT FROM OLD.evidence THEN RAISE EXCEPTION 'Verified evidence is immutable'; END IF;
 IF OLD.state = 'REJECTED' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Rejected attempt is immutable'; END IF;
 IF OLD.state = 'VERIFIED' AND (NEW.state NOT IN ('VERIFIED','REJECTED') OR (NEW.lease_token,NEW.provider_calls) IS DISTINCT FROM (OLD.lease_token,OLD.provider_calls)) THEN RAISE EXCEPTION 'Verified attempt cannot be reopened'; END IF;
 IF (NEW.lease_token,NEW.provider_calls) IS DISTINCT FROM (OLD.lease_token,OLD.provider_calls) THEN
   IF OLD.state NOT IN ('PROCESSING','UNKNOWN') OR NEW.state <> 'PROCESSING' OR NEW.lease_token = OLD.lease_token OR NEW.provider_calls <> OLD.provider_calls + 1 OR OLD.updated_at > clock_timestamp() - interval '2 minutes' THEN RAISE EXCEPTION 'Invalid verification lease transition'; END IF;
 ELSIF NEW.state = 'PROCESSING' AND OLD.state <> 'PROCESSING' THEN RAISE EXCEPTION 'Retry requires a new bounded lease'; END IF;
 IF NEW.evidence IS NOT NULL AND OLD.evidence IS NULL AND (OLD.state <> 'PROCESSING' OR NEW.state <> 'VERIFIED') THEN RAISE EXCEPTION 'Evidence requires provider lease'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER package_payment_attempt_guard BEFORE UPDATE OR DELETE ON package_payment_attempts FOR EACH ROW EXECUTE FUNCTION protect_package_payment_attempt();

-- SECURITY INVOKER throughout. Database access must remain server-only.
CREATE FUNCTION create_package_payment_order(p_id uuid,p_member integer,p_session text,p_key uuid,p_quote jsonb,p_receiver jsonb)
RETURNS SETOF package_payment_orders LANGUAGE plpgsql AS $$
DECLARE m members; existing package_payment_orders; code text; capacity integer; used integer; started timestamptz;
BEGIN
 SELECT * INTO m FROM members WHERE id = p_member FOR UPDATE;
 IF m.id IS NULL OR m.status = 'SUSPENDED' OR NOT EXISTS(SELECT 1 FROM auth_sessions WHERE member_id=p_member AND token_hash=p_session AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 started := clock_timestamp();
 SELECT * INTO existing FROM package_payment_orders WHERE member_id=p_member AND request_key=p_key;
 IF existing.id IS NOT NULL THEN RETURN NEXT existing; RETURN; END IF;
 IF (SELECT count(*) FROM package_payment_orders WHERE member_id=p_member AND created_at>started-interval '1 hour') >= 5 THEN RAISE EXCEPTION 'Order rate limit'; END IF;
 IF EXISTS(SELECT 1 FROM package_payment_orders o WHERE o.member_id=p_member AND o.status='PENDING' AND (o.upload_deadline>started OR EXISTS(SELECT 1 FROM package_payment_attempts a WHERE a.order_id=o.id AND a.state IN ('PROCESSING','UNKNOWN','VERIFIED')))) THEN RAISE EXCEPTION 'Existing pending order'; END IF;
 code := p_quote->'promo'->>'code';
 IF code IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtext('package-promo:' || code)); started := clock_timestamp();
   capacity := (p_quote->'promo'->>'usageLimit')::integer-(p_quote->'promo'->>'usedCount')::integer;
   SELECT count(*) INTO used FROM package_payment_orders o WHERE promo_code=code AND
     (status='PAID' OR (status='PENDING' AND (upload_deadline>started OR EXISTS(SELECT 1 FROM package_payment_attempts a WHERE a.order_id=o.id AND a.state IN ('PROCESSING','UNKNOWN','VERIFIED')))));
   IF used>=capacity THEN RAISE EXCEPTION 'Promo quota exhausted'; END IF;
   IF (p_quote->'promo'->>'expiresAt')::timestamptz<=started THEN RAISE EXCEPTION 'Promo expired'; END IF;
 END IF;
 RETURN QUERY INSERT INTO package_payment_orders(id,member_id,request_key,package_snapshot,receiver_snapshot,subtotal_satang,discount_satang,amount_satang,promo_snapshot,promo_code,points_earned,created_at,expires_at,upload_deadline)
 VALUES(p_id,p_member,p_key,p_quote->'package',p_receiver,(p_quote->>'subtotalSatang')::integer,(p_quote->>'discountSatang')::integer,(p_quote->>'amountSatang')::integer,nullif(p_quote->'promo','null'::jsonb),code,(p_quote->>'pointsEarned')::integer,started,started+interval '15 minutes',started+interval '45 minutes') RETURNING *;
END $$;

CREATE FUNCTION claim_package_payment_attempt(p_order uuid,p_member integer,p_session text,p_attempt uuid,p_hash text,p_reconcile boolean DEFAULT false)
RETURNS SETOF package_payment_attempts LANGUAGE plpgsql AS $$
DECLARE o package_payment_orders; a package_payment_attempts;
BEGIN
 SELECT * INTO o FROM package_payment_orders WHERE id=p_order AND member_id=p_member FOR UPDATE;
 IF o.id IS NULL OR NOT EXISTS(SELECT 1 FROM auth_sessions s JOIN members m ON m.id=s.member_id WHERE s.member_id=p_member AND s.token_hash=p_session AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND m.status<>'SUSPENDED') THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 SELECT * INTO a FROM package_payment_attempts WHERE order_id=p_order AND image_sha256=p_hash;
 IF o.status<>'PENDING' THEN RAISE EXCEPTION 'Terminal order'; END IF;
 IF a.id IS NOT NULL THEN
   IF p_reconcile AND a.state IN ('PROCESSING','UNKNOWN') AND a.updated_at<clock_timestamp()-interval '2 minutes' AND a.provider_calls<2 AND o.upload_deadline>clock_timestamp() THEN
     RETURN QUERY UPDATE package_payment_attempts SET state='PROCESSING',lease_token=p_attempt,provider_calls=provider_calls+1,updated_at=clock_timestamp() WHERE id=a.id RETURNING *;
   ELSE RETURN NEXT a; END IF;
   RETURN;
 END IF;
 IF o.promo_code IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtext('package-promo:' || o.promo_code)); END IF;
 IF o.upload_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'Upload deadline elapsed'; END IF;
 IF EXISTS(SELECT 1 FROM package_payment_attempts WHERE order_id=p_order AND state IN ('PROCESSING','UNKNOWN','VERIFIED')) THEN RAISE EXCEPTION 'Verification pending'; END IF;
 IF (SELECT count(*) FROM package_payment_attempts WHERE order_id=p_order)>=3 THEN RAISE EXCEPTION 'Attempt limit'; END IF;
 IF EXISTS(SELECT 1 FROM package_payment_attempts WHERE order_id=p_order AND created_at>clock_timestamp()-interval '30 seconds') THEN RAISE EXCEPTION 'Attempt cooldown'; END IF;
 RETURN QUERY INSERT INTO package_payment_attempts(id,order_id,image_sha256,lease_token,state) VALUES(p_attempt,p_order,p_hash,p_attempt,'PROCESSING') RETURNING *;
END $$;

CREATE FUNCTION normalize_payment_receiver_name(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT upper(regexp_replace(regexp_replace(trim(normalize(value,NFKC)), '^(นาย|นางสาว|นาง|MRS\.?|MR\.?|MISS)[[:space:]]*', '', 'i'), '[[:space:]]+', '', 'g'))
$$;
CREATE FUNCTION finalize_package_payment(p_order uuid,p_member integer,p_session text,p_attempt uuid)
RETURNS SETOF package_payment_orders LANGUAGE plpgsql AS $$
DECLARE o package_payment_orders; a package_payment_attempts; m members; payment_time timestamptz; confirmed timestamptz; expiry timestamptz; ref text; rejected text; claimed text;
BEGIN
 SELECT * INTO m FROM members WHERE id = p_member FOR UPDATE;
 SELECT * INTO o FROM package_payment_orders WHERE id=p_order AND member_id=p_member FOR UPDATE;
 IF o.id IS NULL OR NOT EXISTS(SELECT 1 FROM auth_sessions WHERE member_id=p_member AND token_hash=p_session AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 IF o.status IN ('PAID','REJECTED') THEN RETURN NEXT o; RETURN; END IF;
 SELECT * INTO a FROM package_payment_attempts WHERE id=p_attempt AND order_id=p_order AND state='VERIFIED' FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'No verified evidence'; END IF;
 payment_time := (a.evidence->>'paidAt')::timestamptz; ref := a.evidence->>'transRef';
 IF (a.evidence->>'amountSatang')::integer IS DISTINCT FROM o.amount_satang OR payment_time IS NULL OR payment_time<o.created_at-interval '60 seconds' OR payment_time>o.expires_at OR payment_time>clock_timestamp()+interval '60 seconds'
 OR ref IS NULL OR ref !~ '^[A-Za-z0-9._:/-]{1,100}$' OR a.evidence->>'bankCode' IS DISTINCT FROM o.receiver_snapshot->>'bankCode'
 OR a.evidence->>'receiverEvidence' IS DISTINCT FROM 'REGISTERED_ACCOUNT_V2'
 OR a.evidence->>'providerStrategy' IS DISTINCT FROM 'EASYSLIP_V2_REGISTERED_ACCOUNT'
 OR a.evidence->>'orderId' IS DISTINCT FROM o.id::text
 OR a.evidence->>'bankCode' IS DISTINCT FROM '004'
 OR a.evidence->'receiverIdentity'->>'bankCode' IS DISTINCT FROM o.receiver_snapshot->>'bankCode'
 OR a.evidence->'receiverIdentity'->>'bankAccount' IS DISTINCT FROM regexp_replace(o.receiver_snapshot->>'bankAccount','[ -]','','g')
 OR a.evidence->'receiverIdentity'->>'expectedName' IS DISTINCT FROM o.receiver_snapshot->>'name'
  OR normalize_payment_receiver_name(a.evidence->'receiverIdentity'->>'name') IS DISTINCT FROM normalize_payment_receiver_name(o.receiver_snapshot->>'name')
 OR coalesce(length(a.evidence->'receiverIdentity'->>'normalizedName'),0)=0
  OR a.evidence->'receiverIdentity'->>'normalizedName' IS DISTINCT FROM normalize_payment_receiver_name(o.receiver_snapshot->>'name') THEN RAISE EXCEPTION 'Invalid payment evidence'; END IF;
 IF m.status='SUSPENDED' THEN rejected := 'MEMBER_SUSPENDED';
 ELSE
   INSERT INTO payment_transfer_refs(trans_ref,source) VALUES(ref,'PACKAGE_ORDER:' || p_order) ON CONFLICT(trans_ref) DO NOTHING RETURNING trans_ref INTO claimed;
   IF claimed IS NULL THEN rejected := 'DUPLICATE_TRANS_REF'; END IF;
 END IF;
 IF rejected IS NOT NULL THEN
   UPDATE package_payment_attempts SET state='REJECTED',rejection_reason=rejected,updated_at=clock_timestamp() WHERE id=a.id;
   INSERT INTO package_payment_resolution_audit(id,order_id,attempt_id,actor_member_id,action,reason_code,reason,reconciliation_evidence)
   VALUES(gen_random_uuid(),p_order,a.id,p_member,'AUTO_REJECT',rejected,rejected,jsonb_build_object('transRef',ref,'memberStatus',m.status));
   RETURN QUERY UPDATE package_payment_orders SET status='REJECTED',rejection_reason=rejected WHERE id=p_order RETURNING *;
   RETURN;
 END IF;
 -- Successful confirmation is the start for expired/inactive memberships. Never backdate benefits to an old transfer.
 confirmed := clock_timestamp();
 expiry := (CASE WHEN m.status='ACTIVE' AND m.expire_date>confirmed THEN greatest(m.expire_date,confirmed) ELSE confirmed END)+((o.package_snapshot->>'durationDays')::integer*interval '24 hours');
 UPDATE members SET expire_date=expiry,status=CASE WHEN expiry>clock_timestamp() THEN 'ACTIVE'::member_status ELSE 'EXPIRED'::member_status END,points=points+o.points_earned,updated_at=confirmed WHERE id = p_member;
 INSERT INTO package_payment_point_ledger(order_id,member_id,delta,balance_after) VALUES(p_order,p_member,o.points_earned,m.points+o.points_earned);
 RETURN QUERY UPDATE package_payment_orders SET status='PAID',paid_at=payment_time,confirmed_at=confirmed,membership_expires_at=expiry,trans_ref=ref,verification_snapshot=a.evidence WHERE id=p_order RETURNING *;
END $$;

-- OWNER can only terminally REJECT after reconciliation; never manual PAID or benefits.
CREATE FUNCTION reject_unresolved_package_payment(p_order uuid,p_actor integer,p_session text,p_reason text,p_proof jsonb)
RETURNS SETOF package_payment_orders LANGUAGE plpgsql AS $$
DECLARE o package_payment_orders; a package_payment_attempts;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth_sessions s JOIN members m ON m.id=s.member_id WHERE s.member_id=p_actor AND s.token_hash=p_session AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND m.role='OWNER' AND m.status<>'SUSPENDED') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF length(trim(p_reason))<10 OR length(p_reason)>500 OR p_reason IS NULL OR p_proof->>'source' IS NULL OR p_proof->>'source' NOT IN ('BANK','PROVIDER') OR p_proof->>'outcome' IS NULL OR p_proof->>'outcome' NOT IN ('NO_TRANSFER_CONFIRMED','REFUND_CONFIRMED','DUPLICATE_CONFIRMED') OR coalesce(length(trim(p_proof->>'caseReference')),0)<5 OR length(p_proof->>'caseReference')>200 OR coalesce(length(trim(p_proof->>'summary')),0)<10 OR length(p_proof->>'summary')>1000 OR p_proof->>'approved' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Explicit reconciliation evidence required'; END IF;
 SELECT * INTO o FROM package_payment_orders WHERE id=p_order FOR UPDATE;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
 IF o.status='REJECTED' THEN RETURN NEXT o; RETURN; END IF;
 IF o.status<>'PENDING' OR o.upload_deadline>clock_timestamp() THEN RAISE EXCEPTION 'Cannot resolve paid order or open upload window'; END IF;
 SELECT * INTO a FROM package_payment_attempts WHERE order_id=p_order AND state IN ('UNKNOWN','PROCESSING','VERIFIED') FOR UPDATE;
 IF a.id IS NULL OR a.updated_at>clock_timestamp()-interval '2 minutes' THEN RAISE EXCEPTION 'No stale unresolved attempt'; END IF;
 INSERT INTO package_payment_resolution_audit(id,order_id,attempt_id,actor_member_id,action,reason_code,reason,reconciliation_evidence)
 VALUES(gen_random_uuid(),p_order,a.id,p_actor,'OWNER_REJECT','OWNER_RECONCILED_REJECTION',trim(p_reason),p_proof);
 UPDATE package_payment_attempts SET state='REJECTED',rejection_reason='OWNER_RECONCILED_REJECTION',updated_at=clock_timestamp() WHERE id=a.id;
 RETURN QUERY UPDATE package_payment_orders SET status='REJECTED',rejection_reason='OWNER_RECONCILED_REJECTION' WHERE id=p_order RETURNING *;
END $$;
COMMIT;
