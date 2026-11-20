-- ISOLATED TEST PROTOTYPE ONLY. Not a migration. Do not install or grant on a live DB.
BEGIN;
CREATE FUNCTION r4_staff_private.record_free_sale_candidate(
 p_session text, p_key uuid, p_member_code text, p_expected_order uuid,
 p_catalog_version integer, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
 s public.auth_sessions; actor public.members; actor_id_hint integer;
 mid integer; predecessor public.package_payment_orders; pkg public.package_catalog;
 sale r4_staff_private.free_sales; t timestamptz; package_key text;
 why text := regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
BEGIN
 -- Match member-before-session locking used by password/session mutations.
 SELECT member_id INTO actor_id_hint FROM public.auth_sessions WHERE token_hash = p_session;
 SELECT * INTO actor FROM public.members WHERE id = actor_id_hint FOR SHARE;
 SELECT * INTO s FROM public.auth_sessions WHERE token_hash = p_session AND member_id = actor.id FOR SHARE;
 IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL
 OR s.expires_at IS NULL OR s.expires_at <= clock_timestamp()
 OR actor.role IS NULL OR actor.role NOT IN ('ADMIN','OWNER')
 OR actor.status IS NULL OR actor.status = 'SUSPENDED' THEN
  RAISE EXCEPTION 'Live normal staff session required' USING ERRCODE = '42501';
 END IF;
 IF p_key IS NULL OR p_expected_order IS NULL OR p_member_code IS NULL
 OR p_member_code !~ '^BLU-[0-9]{1,12}$' OR p_catalog_version IS NULL OR p_catalog_version < 1
 OR why IS NULL OR length(why) NOT BETWEEN 1 AND 240 THEN
  RAISE EXCEPTION 'Invalid free continuation request' USING ERRCODE = '22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('r4-free:' || actor.id || ':' || p_key, 0));
 IF s.expires_at <= clock_timestamp() THEN
  RAISE EXCEPTION 'Session expired' USING ERRCODE = '42501';
 END IF;
 SELECT * INTO sale FROM r4_staff_private.free_sales f WHERE f.actor_id = actor.id AND f.request_key = p_key;
 IF FOUND THEN
  IF (sale.member_code,sale.predecessor_order_id,sale.catalog_version,sale.reason)
     IS DISTINCT FROM (p_member_code,p_expected_order,p_catalog_version,why) THEN
   RAISE EXCEPTION 'Request key reused' USING ERRCODE = '22023';
  END IF;
 ELSE
  SELECT id INTO mid FROM public.members WHERE member_code = p_member_code AND role = 'MEMBER' FOR UPDATE;
  t := clock_timestamp();
  IF s.expires_at <= t THEN RAISE EXCEPTION 'Session expired' USING ERRCODE = '42501'; END IF;
  IF mid IS NULL THEN RAISE EXCEPTION 'No proven continuation' USING ERRCODE = '55000'; END IF;
  SELECT * INTO predecessor FROM public.r3_override_current_order(mid,t);
  package_key := predecessor.package_snapshot->>'id';
  IF predecessor.id IS DISTINCT FROM p_expected_order OR package_key IS NULL
     OR package_key !~ '^[1-9][0-9]{0,9}$' THEN
   RAISE EXCEPTION 'No proven continuation' USING ERRCODE = '55000';
  END IF;
  -- Only the same package, an active exact catalog version, zero extra benefits.
  -- There is no client-supplied amount, payment reference or timestamp.
  SELECT * INTO pkg FROM public.package_catalog WHERE id = package_key::bigint FOR SHARE;
  t := clock_timestamp();
  IF s.expires_at <= t THEN RAISE EXCEPTION 'Session expired' USING ERRCODE = '42501'; END IF;
  IF pkg.id IS NULL OR NOT pkg.is_active OR pkg.version <> p_catalog_version OR pkg.friend_quota <> 0
     OR pkg.bonus_days <> 0 OR pkg.bonus_points <> 0 OR predecessor.membership_expires_at <= t
     OR EXISTS (SELECT FROM public.package_payment_orders WHERE member_id = mid AND status = 'PENDING')
     OR EXISTS (SELECT FROM r4_staff_private.free_sales WHERE predecessor_order_id = predecessor.id) THEN
   RAISE EXCEPTION 'No eligible free continuation' USING ERRCODE = '55000';
  END IF;
  INSERT INTO r4_staff_private.free_sales (
   member_id,member_code,predecessor_order_id,actor_id,actor_role,request_key,reason,
   package_id,catalog_version,package_name,duration_days,daily_slot,catalog_price_satang,
   occurred_at,recorded_at,starts_at,ends_at
  ) VALUES (mid,p_member_code,predecessor.id,actor.id,actor.role,p_key,why,
   pkg.id,pkg.version,pkg.name,pkg.duration_days,pkg.time_slot,pkg.price_satang,t,t,
   predecessor.membership_expires_at,predecessor.membership_expires_at + pkg.duration_days * interval '24 hours')
  RETURNING * INTO sale;
 END IF;
 -- A candidate receipt is not confirmation of admission. Never return list price or other sales.
 RETURN jsonb_build_object('candidateId',sale.sale_id,'amountSatang',sale.amount_satang,'enabled',false);
END $$;
REVOKE ALL ON FUNCTION r4_staff_private.record_free_sale_candidate(text,uuid,text,uuid,integer,text) FROM PUBLIC;
COMMIT;
