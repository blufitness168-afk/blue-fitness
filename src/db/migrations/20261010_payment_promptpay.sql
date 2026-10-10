-- Incremental only: leaves orders, credits and original image identities untouched.
BEGIN;
ALTER TABLE package_payment_resolution_audit DROP CONSTRAINT package_payment_resolution_audit_action_check;
ALTER TABLE package_payment_resolution_audit ADD CONSTRAINT package_payment_resolution_audit_action_check CHECK(action IN ('AUTO_REJECT','OWNER_REJECT','OWNER_RECHECK'));
CREATE OR REPLACE FUNCTION normalize_payment_receiver_name(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
 SELECT upper(regexp_replace(regexp_replace(trim(normalize(value,NFKC)), '^(นาย|นางสาว|นาง|MRS\.?|MR\.?|MISS)[[:space:]]*', '', 'i'), '[[:space:]]+', '', 'g'))
$$;

CREATE OR REPLACE FUNCTION protect_package_payment_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment attempt cannot be deleted'; END IF;
 IF (NEW.id,NEW.order_id,NEW.image_sha256,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.order_id,OLD.image_sha256,OLD.created_at) THEN RAISE EXCEPTION 'Attempt identity is immutable'; END IF;
 IF OLD.evidence IS NOT NULL AND NEW.evidence IS DISTINCT FROM OLD.evidence THEN RAISE EXCEPTION 'Verified evidence is immutable'; END IF;
 IF OLD.state='REJECTED' AND NEW IS DISTINCT FROM OLD THEN
   IF OLD.rejection_reason='PROVIDER_VALIDATION_FAILED' AND OLD.evidence IS NULL AND OLD.provider_calls=1
   AND NEW.state='UNKNOWN' AND NEW.rejection_reason IS NULL AND NEW.evidence IS NULL
   AND (NEW.lease_token,NEW.provider_calls) IS NOT DISTINCT FROM (OLD.lease_token,OLD.provider_calls)
   AND EXISTS(SELECT 1 FROM package_payment_resolution_audit r WHERE r.attempt_id=OLD.id AND r.action='OWNER_RECHECK' AND r.reconciliation_evidence->>'transactionId'=txid_current()::text)
   THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Rejected attempt is immutable';
 END IF;
 IF OLD.state = 'VERIFIED' AND (NEW.state NOT IN ('VERIFIED','REJECTED') OR (NEW.lease_token,NEW.provider_calls) IS DISTINCT FROM (OLD.lease_token,OLD.provider_calls)) THEN RAISE EXCEPTION 'Verified attempt cannot be reopened'; END IF;
 IF (NEW.lease_token,NEW.provider_calls) IS DISTINCT FROM (OLD.lease_token,OLD.provider_calls) THEN
   IF OLD.state NOT IN ('PROCESSING','UNKNOWN') OR NEW.state <> 'PROCESSING' OR NEW.lease_token = OLD.lease_token OR NEW.provider_calls <> OLD.provider_calls + 1 OR OLD.updated_at > clock_timestamp() - interval '2 minutes' THEN RAISE EXCEPTION 'Invalid verification lease transition'; END IF;
 ELSIF NEW.state = 'PROCESSING' AND OLD.state <> 'PROCESSING' THEN RAISE EXCEPTION 'Retry requires a new bounded lease'; END IF;
 IF NEW.evidence IS NOT NULL AND OLD.evidence IS NULL AND (OLD.state <> 'PROCESSING' OR NEW.state <> 'VERIFIED') THEN RAISE EXCEPTION 'Evidence requires provider lease'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION claim_package_payment_attempt(p_order uuid,p_member integer,p_session text,p_attempt uuid,p_hash text,p_reconcile boolean DEFAULT false)
RETURNS SETOF package_payment_attempts LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE o package_payment_orders; a package_payment_attempts;
BEGIN
 SELECT * INTO o FROM package_payment_orders WHERE id=p_order AND member_id=p_member FOR UPDATE;
 IF o.id IS NULL OR NOT EXISTS(SELECT 1 FROM auth_sessions s JOIN members m ON m.id=s.member_id WHERE s.member_id=p_member AND s.token_hash=p_session AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND m.status<>'SUSPENDED') THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 SELECT * INTO a FROM package_payment_attempts WHERE order_id=p_order AND image_sha256=p_hash;
 IF o.status<>'PENDING' THEN RAISE EXCEPTION 'Terminal order'; END IF;
 IF a.id IS NOT NULL THEN
   IF p_reconcile AND a.state IN ('PROCESSING','UNKNOWN') AND a.updated_at<clock_timestamp()-interval '2 minutes' AND a.provider_calls<2 AND (o.upload_deadline>clock_timestamp() OR EXISTS(SELECT 1 FROM package_payment_resolution_audit r JOIN members m ON m.id=r.actor_member_id WHERE r.attempt_id=a.id AND r.action='OWNER_RECHECK' AND r.actor_member_id=p_member AND m.role='OWNER')) THEN
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
CREATE OR REPLACE FUNCTION finalize_package_payment(p_order uuid,p_member integer,p_session text,p_attempt uuid)
RETURNS SETOF package_payment_orders LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
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
 OR NOT (
 (coalesce(a.evidence->'receiverIdentity'->>'matchingType','BANK_ACCOUNT')='BANK_ACCOUNT'
 AND a.evidence->>'bankCode'='004'
 AND a.evidence->'receiverIdentity'->>'bankCode'=o.receiver_snapshot->>'bankCode'
 AND a.evidence->'receiverIdentity'->>'bankAccount'=regexp_replace(o.receiver_snapshot->>'bankAccount','[ -]','','g'))
 OR (a.evidence->'receiverIdentity'->>'matchingType'='PROMPTPAY'
 AND a.evidence->'receiverIdentity'->>'providerBankCode'='PROMPTPAY'
 AND a.evidence->'receiverIdentity'->>'bankCode'='PROMPTPAY'
 AND a.evidence->'receiverIdentity'->>'promptpay'=o.receiver_snapshot->>'promptpay'
 AND a.evidence->'receiverIdentity'->>'promptpay' ~ '^0[689][0-9]{8}$')
 ) IS TRUE
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
CREATE FUNCTION prepare_owner_payment_recheck(p_order uuid,p_actor integer,p_session text)
RETURNS SETOF package_payment_attempts LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE o package_payment_orders; a package_payment_attempts;
BEGIN
 SELECT * INTO o FROM package_payment_orders WHERE id=p_order AND member_id=p_actor FOR UPDATE;
 IF o.id IS NULL OR o.status<>'PENDING' OR NOT EXISTS(SELECT 1 FROM auth_sessions s JOIN members m ON m.id=s.member_id WHERE s.member_id=p_actor AND s.token_hash=p_session AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND m.role='OWNER' AND m.status<>'SUSPENDED') THEN RAISE EXCEPTION 'Own pending order and OWNER session required'; END IF;
 SELECT * INTO a FROM package_payment_attempts WHERE order_id=p_order AND state='REJECTED' AND rejection_reason='PROVIDER_VALIDATION_FAILED' AND evidence IS NULL AND provider_calls=1 AND created_at<=o.upload_deadline ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF a.id IS NULL OR EXISTS(SELECT 1 FROM package_payment_resolution_audit WHERE order_id=p_order AND action='OWNER_RECHECK') THEN RAISE EXCEPTION 'Recheck unavailable or consumed'; END IF;
 INSERT INTO package_payment_resolution_audit(id,order_id,attempt_id,actor_member_id,action,reason_code,reason,reconciliation_evidence)
 VALUES(gen_random_uuid(),p_order,a.id,p_actor,'OWNER_RECHECK','PROMPTPAY_REGISTRATION_FIX','Explicit owner retry after registered PromptPay validation fix',jsonb_build_object('transactionId',txid_current()::text,'imageSha256',a.image_sha256,'originalCreatedAt',a.created_at,'originalReason',a.rejection_reason,'providerCalls',a.provider_calls));
 RETURN QUERY UPDATE package_payment_attempts SET state='UNKNOWN',rejection_reason=NULL,updated_at=least(updated_at,clock_timestamp()-interval '2 minutes 1 second') WHERE id=a.id RETURNING *;
END $$;
REVOKE ALL ON FUNCTION prepare_owner_payment_recheck(uuid,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_package_payment_attempt(uuid,integer,text,uuid,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION finalize_package_payment(uuid,integer,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_package_payment_attempt() FROM PUBLIC;
REVOKE ALL ON FUNCTION normalize_payment_receiver_name(text) FROM PUBLIC;
COMMIT;
