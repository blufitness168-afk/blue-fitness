-- Explicit, single-use owner retry; no provider call or benefit mutation.
BEGIN;
CREATE FUNCTION prepare_owner_payment_currency_recheck(p_order uuid,p_actor integer,p_session text)
RETURNS SETOF package_payment_attempts LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
DECLARE o package_payment_orders; a package_payment_attempts;
BEGIN
 PERFORM 1 FROM auth_sessions WHERE member_id=p_actor AND token_hash=p_session
 AND mode='NORMAL' AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Own pending order and NORMAL OWNER session required'; END IF;
 PERFORM 1 FROM members WHERE id=p_actor AND role='OWNER' AND status<>'SUSPENDED' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Own pending order and NORMAL OWNER session required'; END IF;
 SELECT * INTO o FROM package_payment_orders WHERE id=p_order AND member_id=p_actor FOR UPDATE;
 IF o.id IS NULL OR o.status<>'PENDING' THEN RAISE EXCEPTION 'Own pending order and NORMAL OWNER session required'; END IF;
 SELECT * INTO a FROM package_payment_attempts WHERE order_id=p_order AND state='REJECTED'
 AND rejection_reason='PROVIDER_VALIDATION_FAILED' AND evidence IS NULL AND provider_calls=1
 AND created_at<=o.upload_deadline ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF a.id IS NULL OR EXISTS(SELECT 1 FROM package_payment_resolution_audit WHERE order_id=p_order AND action='OWNER_RECHECK') THEN
 RAISE EXCEPTION 'Recheck unavailable or consumed'; END IF;
 INSERT INTO package_payment_resolution_audit(id,order_id,attempt_id,actor_member_id,action,reason_code,reason,reconciliation_evidence)
 VALUES(gen_random_uuid(),p_order,a.id,p_actor,'OWNER_RECHECK','THB_NUMERIC_CURRENCY_FIX',
 'Explicit owner retry after numeric THB currency 764 validation fix',
 jsonb_build_object('transactionId',txid_current()::text,'imageSha256',a.image_sha256,'originalCreatedAt',a.created_at,'originalReason',a.rejection_reason,'providerCalls',a.provider_calls));
 RETURN QUERY UPDATE package_payment_attempts SET state='UNKNOWN',rejection_reason=NULL,
 updated_at=least(updated_at,clock_timestamp()-interval '2 minutes 1 second') WHERE id=a.id RETURNING *;
END $$;
REVOKE ALL ON FUNCTION prepare_owner_payment_currency_recheck(uuid,integer,text) FROM PUBLIC;
COMMIT;
