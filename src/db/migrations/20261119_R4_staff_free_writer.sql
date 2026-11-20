-- PREPARE ONLY: after the reviewed R4 foundation, admission and finance migrations.
-- Private invoker RPCs. No grants, backfill or modifications to existing readers.
BEGIN;
SET LOCAL search_path = pg_catalog;

CREATE FUNCTION r4_staff_private.assert_writer_stack() RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed'
 OR to_regprocedure('public.time_supplement_allows(integer,timestamptz)') IS NOT NULL
 OR to_regclass('public.r7_visits') IS NOT NULL
 OR to_regprocedure('public.r7_visit_action(text,text,uuid,text,text)') IS NOT NULL
 OR to_regclass('r4_staff_private.finance_source') IS NULL
 OR to_regclass('r4_staff_private.free_sales') IS NULL
 OR to_regprocedure('r4_staff_private.admission_term(integer,timestamptz,uuid)') IS NULL
 OR EXISTS (
  SELECT FROM (VALUES
   ('public.kiosk_checkin(text,text,uuid,text)', 'FROM r4_staff_private.admission_term', 'STAFF_FREE_ENTRY term=STAFF_FREE:'),
   ('public.real_frontdesk_checkin(text,text,uuid,text)', 'FROM r4_staff_private.admission_term', 'STAFF_FREE_ENTRY term=STAFF_FREE:'),
   ('public.member_scan_admit(text,text,uuid,text,text)', 'public.real_frontdesk_checkin', 'public.kiosk_checkin'),
   ('public.real_finance_action(text,text,uuid,jsonb)', 'FROM r4_staff_private.finance_source', 'Owner session required')
  ) AS reader(signature, anchor, second_anchor)
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(reader.signature)
  WHERE p.oid IS NULL OR p.prosecdef OR strpos(p.prosrc,reader.anchor)=0 OR strpos(p.prosrc,reader.second_anchor)=0
 ) THEN RAISE EXCEPTION 'R4 staff free readers unavailable' USING ERRCODE='0A000'; END IF;
END $$;
SELECT r4_staff_private.assert_writer_stack();

-- Runtime only: cancellation and purchase-guard installation use the reader preflight above.
CREATE FUNCTION r4_staff_private.assert_free_purchase_guard() RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
 IF current_setting('session_replication_role') = 'replica'
 OR to_regclass('r4_staff_private.free_sale_cancellations') IS NULL
 OR NOT EXISTS (
  SELECT FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE t.tgrelid=to_regclass('public.package_payment_orders')
    AND t.tgname='a_r4_staff_free_online_purchase_guard' AND t.tgenabled IN ('O','A')
    -- 7 = BEFORE | INSERT | ROW. No WHEN, trigger arguments, or constraint deferral.
    AND t.tgtype=7 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgconstraint=0 AND NOT t.tgisinternal
    AND p.oid=to_regprocedure('r4_staff_private.guard_online_purchase()')
    AND p.prorettype='pg_catalog.trigger'::regtype AND NOT p.prosecdef AND p.provolatile='v'
    AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
    AND p.proconfig=ARRAY['search_path=pg_catalog']
    -- Pin the reviewed guard body, including the approved paid-cancellation upgrade.
    -- Normalize CRLF and the outer newlines added by pg_get_functiondef on upgrade.
    AND encode(sha256(convert_to(btrim(replace(p.prosrc,chr(13),''),chr(10)),'UTF8')),'hex') =
      CASE WHEN to_regclass('r4_staff_private.paid_transfer_cancellations') IS NULL
       THEN 'a22b3258bee11b8616d8c5728ea128f5aadaa06bc5ccd4ad3c1070281dbbc4dd'
       ELSE '365083b10cb52369d1d6722e4aa39dda38417905a0f58dbcc10c2f759eefeb84'
      END
 ) THEN RAISE EXCEPTION 'R4 staff free purchase guard unavailable' USING ERRCODE='0A000'; END IF;
END $$;

CREATE FUNCTION r4_staff_private.staff_session(p_session text) RETURNS public.auth_sessions
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE a public.members; s public.auth_sessions;
BEGIN
 -- Lock the staff row before the session, as in password and catalog mutations.
 SELECT m.* INTO a FROM public.members m WHERE m.id=(SELECT member_id FROM public.auth_sessions WHERE token_hash=p_session)
 AND m.role IN ('ADMIN','OWNER') FOR SHARE;
 SELECT * INTO s FROM public.auth_sessions WHERE token_hash=p_session AND member_id=a.id FOR SHARE;
 IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL
 OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp()
 OR a.status IS NULL OR a.status='SUSPENDED' THEN
  RAISE EXCEPTION 'Live normal staff session required' USING ERRCODE='42501';
 END IF;
 RETURN s;
END $$;

CREATE FUNCTION r4_staff_private.sale_term(f r4_staff_private.free_sales) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog SET timezone = 'UTC' AS $$
 SELECT jsonb_build_object('source','ONLINE_PAID','orderId',f.predecessor_order_id,
 'packageId',f.package_id,'catalogVersion',f.catalog_version,'packageName',f.package_name,
 'startsAt',f.starts_at,'endsAt',f.ends_at,'dailySlot',f.daily_slot)
$$;

CREATE FUNCTION r4_staff_private.locked_offer(p_code text) RETURNS r4_staff_private.free_sales
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE m public.members; o public.package_payment_orders; c public.package_catalog;
 f r4_staff_private.free_sales; k text; t timestamptz;
BEGIN
 IF p_code IS NULL OR p_code !~ '^BLU-[0-9]{1,12}$' THEN
  RAISE EXCEPTION 'Invalid member code' USING ERRCODE='22023'; END IF;
 -- Shared serialization point with online create/finalize and both admission paths.
 SELECT * INTO m FROM public.members WHERE member_code=p_code AND role='MEMBER' FOR UPDATE;
 IF m.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO o FROM public.r3_override_current_order(m.id,clock_timestamp());
 k:=o.package_snapshot->>'id';
 IF k IS NULL OR k !~ '^[1-9][0-9]{0,9}$' THEN RETURN NULL; END IF;
 SELECT * INTO c FROM public.package_catalog WHERE id=k::bigint FOR SHARE;
 t:=clock_timestamp();
 IF c.id IS NULL OR c.is_active IS NOT TRUE OR c.friend_quota<>0 OR c.bonus_days<>0 OR c.bonus_points<>0
 OR o.package_snapshot->'id' IS DISTINCT FROM to_jsonb(c.id)
 OR NOT EXISTS (SELECT FROM public.r3_override_current_order(m.id,t) p WHERE p.id=o.id)
 OR EXISTS (SELECT FROM public.package_payment_orders WHERE member_id=m.id AND status='PENDING') THEN
  RETURN NULL;
 END IF;
 f.member_id:=m.id; f.member_code:=p_code; f.predecessor_order_id:=o.id;
 f.package_id:=c.id; f.catalog_version:=c.version; f.package_name:=c.name;
 f.duration_days:=c.duration_days; f.daily_slot:=c.time_slot; f.catalog_price_satang:=c.price_satang;
 f.occurred_at:=t; f.recorded_at:=t; f.starts_at:=o.membership_expires_at;
 f.ends_at:=f.starts_at+c.duration_days*interval '24 hours';
 IF NOT isfinite(f.starts_at) OR NOT isfinite(f.ends_at) OR f.starts_at<=t
 OR EXISTS (SELECT FROM r4_staff_private.free_sales s WHERE s.member_id=m.id
  AND (s.predecessor_order_id=o.id OR (s.starts_at<f.ends_at AND s.ends_at>f.starts_at))) THEN
  RETURN NULL;
 END IF;
 RETURN f;
END $$;

CREATE FUNCTION r4_staff_private.preview_free_sale(p_session text,p_code text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE s public.auth_sessions; f r4_staff_private.free_sales;
BEGIN
 PERFORM r4_staff_private.assert_writer_stack();
 PERFORM r4_staff_private.assert_free_purchase_guard();
 s:=r4_staff_private.staff_session(p_session);
 f:=r4_staff_private.locked_offer(p_code);
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN CASE WHEN f.member_id IS NOT NULL THEN r4_staff_private.sale_term(f) END;
END $$;

CREATE FUNCTION r4_staff_private.record_free_sale(p_session text,p_key uuid,p_code text,p_term jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE s public.auth_sessions; f r4_staff_private.free_sales;
 why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
BEGIN
 PERFORM r4_staff_private.assert_writer_stack();
 PERFORM r4_staff_private.assert_free_purchase_guard();
 s:=r4_staff_private.staff_session(p_session);
 -- Keep trigger DDL out until commit without blocking ordinary online inserts.
 LOCK TABLE public.package_payment_orders IN ROW EXCLUSIVE MODE;
 PERFORM r4_staff_private.assert_free_purchase_guard();
 IF p_key IS NULL OR p_code IS NULL OR p_code !~ '^BLU-[0-9]{1,12}$'
 OR jsonb_typeof(p_term) IS DISTINCT FROM 'object' OR why IS NULL OR length(why) NOT BETWEEN 1 AND 240 THEN
  RAISE EXCEPTION 'Invalid staff free request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('r4-free-sale:'||s.member_id||':'||p_key,0));
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM r4_staff_private.free_sales WHERE actor_id=s.member_id AND request_key=p_key;
 IF FOUND THEN
  IF (f.method,f.member_code,r4_staff_private.sale_term(f),f.reason) IS DISTINCT FROM ('STAFF_FREE'::text,p_code,p_term,why) THEN
   RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
 ELSE
  f:=r4_staff_private.locked_offer(p_code);
  IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
  IF f.member_id IS NULL OR r4_staff_private.sale_term(f) IS DISTINCT FROM p_term THEN
   RAISE EXCEPTION 'Terms changed or member ineligible' USING ERRCODE='55000'; END IF;
  INSERT INTO r4_staff_private.free_sales(member_id,member_code,predecessor_order_id,actor_id,actor_role,
   request_key,reason,package_id,catalog_version,package_name,duration_days,daily_slot,catalog_price_satang,
   occurred_at,recorded_at,starts_at,ends_at)
  VALUES(f.member_id,f.member_code,f.predecessor_order_id,s.member_id,
   (SELECT role FROM public.members WHERE id=s.member_id),p_key,why,f.package_id,f.catalog_version,
   f.package_name,f.duration_days,f.daily_slot,f.catalog_price_satang,f.occurred_at,f.recorded_at,f.starts_at,f.ends_at)
  RETURNING * INTO f;
  -- Exercise both private reader contracts before committing the immutable fact.
  IF NOT EXISTS (SELECT FROM r4_staff_private.admission_term(f.member_id,f.starts_at,f.predecessor_order_id) a
    WHERE (a.source_kind,a.source_id,a.daily_slot)=('STAFF_FREE',f.sale_id,f.daily_slot))
  OR NOT EXISTS (SELECT FROM r4_staff_private.finance_source v WHERE v.sale_id=f.sale_id
    AND (v.member_id,v.source_id,v.type,v.source,v.amount_satang,v.entry_date,v.recorded_at)=
      (f.member_id,'staff-free:'||f.sale_id,'INCOME','STAFF_FREE',0,(f.occurred_at AT TIME ZONE 'Asia/Bangkok')::date,f.recorded_at)) THEN
   RAISE EXCEPTION 'Staff free reader mismatch' USING ERRCODE='55000'; END IF;
  IF f.starts_at<=clock_timestamp() THEN RAISE EXCEPTION 'Predecessor expired during write' USING ERRCODE='55000'; END IF;
 END IF;
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('saleId',f.sale_id,'source','STAFF_FREE','amountSatang',f.amount_satang,
   'startsAt',r4_staff_private.sale_term(f)->'startsAt','endsAt',r4_staff_private.sale_term(f)->'endsAt','dailySlot',f.daily_slot);
END $$;

REVOKE ALL ON FUNCTION r4_staff_private.assert_writer_stack(),r4_staff_private.assert_free_purchase_guard(),
 r4_staff_private.staff_session(text),
 r4_staff_private.sale_term(r4_staff_private.free_sales),r4_staff_private.locked_offer(text),
 r4_staff_private.preview_free_sale(text,text),r4_staff_private.record_free_sale(text,uuid,text,jsonb,text) FROM PUBLIC;
COMMIT;
