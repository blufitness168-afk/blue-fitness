-- R4-first alternative to the standalone R6 supplement / R7 visits / R7 kiosk migrations.
-- Requires the complete R4 chain through 20261125; then apply 20261201_R7_manual_visits.sql.
-- No backfill, data repair, money movement, or runtime-role grants.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '5s';
DO $review$
DECLARE r record; f pg_proc;
BEGIN
 IF to_regclass('public.time_supplement_grants') IS NOT NULL OR to_regclass('public.r7_visits') IS NOT NULL
 OR to_regclass('public.r7_kiosk_scan_requests') IS NOT NULL THEN
  RAISE EXCEPTION 'Combined admission requires the R4-first branch, without standalone R6/R7'; END IF;
 PERFORM 'public.member_card_admit(text,text,uuid,text,text)'::regprocedure;
 FOR r IN SELECT * FROM (VALUES
  ('public.kiosk_checkin(text,text,uuid,text)','a0665523fee9b064be01b9215f55599e',ARRAY['search_path=public, pg_catalog']),
  ('public.real_frontdesk_checkin(text,text,uuid,text)','0f2eb89a6f07847f40ef3cd516a048a9',ARRAY['search_path=public, pg_catalog']),
  ('r4_staff_private.assert_writer_stack()','a7ad97bf24a6e20444379f6b8751932a',ARRAY['search_path=pg_catalog']),
  ('r4_online_private.cancellation_eligible(uuid,integer,timestamptz)','4f4907e672ac75cdc178b33e09a4e63c',ARRAY['search_path=pg_catalog','TimeZone=UTC'])
 ) v(signature,body_hash,config) LOOP
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=to_regprocedure(r.signature);
  IF f.prosecdef OR f.proconfig IS DISTINCT FROM r.config
  OR f.provolatile IS DISTINCT FROM (CASE WHEN r.signature LIKE 'public.%' THEN 'v' ELSE 's' END)::"char"
  OR md5(replace(f.prosrc,chr(13),'')) IS DISTINCT FROM r.body_hash THEN
   RAISE EXCEPTION 'Unreviewed combined admission dependency: % (config: %)',r.signature,f.proconfig;
  END IF;
 END LOOP;
END $review$;
SELECT r4_online_private.assert_cancellation_stack();

-- Same public supplement RPC and audit objects as the standalone branch.
CREATE TABLE time_supplement_grants (
 coupon_id integer PRIMARY KEY REFERENCES coupons(id) ON DELETE RESTRICT,
 member_id integer NOT NULL REFERENCES members(id),
 main_order_id uuid REFERENCES package_payment_orders(id),
 staff_sale_id uuid REFERENCES r4_staff_private.free_sales(sale_id),
 CHECK ((main_order_id IS NULL) <> (staff_sale_id IS NULL)),
 main_snapshot jsonb NOT NULL, main_expires_at timestamptz NOT NULL,
 daily_slot text NOT NULL CHECK(package_catalog_daily_slot_valid(daily_slot)),
 granted_by integer NOT NULL REFERENCES members(id), reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 240),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE time_supplement_activations (
 coupon_id integer PRIMARY KEY REFERENCES time_supplement_grants(coupon_id),
 member_id integer NOT NULL REFERENCES members(id),
 activated_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 CHECK(expires_at>activated_at)
);
CREATE TABLE time_supplement_requests (
 actor_id integer NOT NULL REFERENCES members(id), request_key uuid NOT NULL,
 action text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,request_key)
);
CREATE FUNCTION time_supplement_immutable() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Time supplement audit is append-only'; END $$;
CREATE TRIGGER time_supplement_grant_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON time_supplement_grants
 FOR EACH STATEMENT EXECUTE FUNCTION time_supplement_immutable();
CREATE TRIGGER time_supplement_activation_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON time_supplement_activations
 FOR EACH STATEMENT EXECUTE FUNCTION time_supplement_immutable();
CREATE TRIGGER time_supplement_request_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON time_supplement_requests
 FOR EACH STATEMENT EXECUTE FUNCTION time_supplement_immutable();

-- Caller holds the member lock and uses the same instant as the admission decision.
-- Resolve only explicit R4 terms or a provable standalone online order. The
-- legacy online admission fallback is not sufficient proof to issue a supplement.
CREATE FUNCTION r347_staff_package(f r4_staff_private.free_sales) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,pg_catalog AS $$
 SELECT jsonb_build_object('id',f.package_id,'name',f.package_name,'catalogVersion',f.catalog_version,
  'durationDays',f.duration_days,'timeSlot',f.daily_slot)
$$;
CREATE FUNCTION time_supplement_main(p_member integer,p_at timestamptz)
RETURNS TABLE (order_id uuid, sale_id uuid, package_snapshot jsonb, main_end timestamptz)
LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 WITH latest AS (
  SELECT id FROM r4_online_private.active_paid_orders WHERE member_id=p_member
  ORDER BY paid_at DESC NULLS LAST,created_at DESC,id DESC LIMIT 1
 ), term AS (
  SELECT a.* FROM r4_staff_private.admission_term(p_member,p_at,(SELECT id FROM latest)) a
 )
 SELECT o.id,NULL::uuid,o.package_snapshot,o.membership_expires_at
 FROM r3_override_current_order(p_member,p_at) o JOIN latest ON latest.id=o.id
 WHERE NOT EXISTS (SELECT FROM term)
 UNION ALL
 SELECT NULL::uuid,f.sale_id,r347_staff_package(f),f.ends_at
 FROM term a JOIN r4_staff_private.free_sales f ON f.sale_id=a.source_id
 WHERE a.source_kind IN ('STAFF_FREE','STAFF_TRANSFER')
$$;
CREATE FUNCTION time_supplement_window_end(p_slot text,p_at timestamptz,p_main_end timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path=public,pg_catalog AS $$
 SELECT CASE WHEN coalesce(package_catalog_slot_allows(p_slot,(p_at AT TIME ZONE 'Asia/Bangkok')::time),false)
 THEN least(p_main_end,(((p_at AT TIME ZONE 'Asia/Bangkok')::date + right(p_slot,5)::time) AT TIME ZONE 'Asia/Bangkok')) END
$$;
CREATE FUNCTION r347_active_supplement(p_member integer,p_at timestamptz)
RETURNS TABLE (coupon_id integer,daily_slot text,activated_at timestamptz,expires_at timestamptz,
 order_id uuid,sale_id uuid)
LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT g.coupon_id,g.daily_slot,a.activated_at,a.expires_at,o.order_id,o.sale_id
 FROM time_supplement_activations a JOIN time_supplement_grants g USING(coupon_id)
 JOIN coupons c ON c.id=g.coupon_id JOIN time_supplement_main(p_member,p_at) o
  ON (g.main_order_id,g.staff_sale_id) IS NOT DISTINCT FROM (o.order_id,o.sale_id)
 WHERE a.member_id=p_member AND g.member_id=p_member AND c.member_id=p_member
 AND a.activated_at<=p_at AND a.expires_at>p_at AND g.main_expires_at=o.main_end
 AND g.main_snapshot=o.package_snapshot AND c.type='CUSTOM' AND c.source='TIME_SUPPLEMENT:'||g.coupon_id
 AND c.status='USED' AND c.total_quota=1 AND c.used_count=1 AND c.bonus_days_value=0
 AND c.expire_date>p_at AND package_catalog_slot_allows(g.daily_slot,(p_at AT TIME ZONE 'Asia/Bangkok')::time)
 ORDER BY a.activated_at,a.coupon_id LIMIT 1
$$;
CREATE FUNCTION time_supplement_allows(p_member integer,p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT FROM r347_active_supplement(p_member,p_at))
$$;
CREATE FUNCTION time_supplement_action(p_session text,p_action text,p_key uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; actor members%ROWTYPE; m members%ROWTYPE; o record;
 g time_supplement_grants%ROWTYPE; c coupons%ROWTYPE; a time_supplement_activations%ROWTYPE;
 prior time_supplement_requests%ROWTYPE; result jsonb; t timestamptz; ending timestamptz; cid integer;
BEGIN
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 -- Serialize this actor before taking member locks (including self activation upgrades).
 PERFORM pg_advisory_xact_lock(hashtextextended('time-supplement-actor:'||s.member_id,0));
 SELECT * INTO actor FROM members WHERE id=s.member_id FOR SHARE;
 IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp()
 OR actor.id IS NULL OR actor.status='SUSPENDED' THEN RAISE EXCEPTION 'Normal session required' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('list','grant','activate') THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023'; END IF;
 IF p_action='grant' AND (actor.role IS NULL OR actor.role NOT IN ('ADMIN','OWNER')) THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
 IF p_action='list' THEN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('couponId',gg.coupon_id,'title',cc.title,'timeSlot',gg.daily_slot,
   'expiresAt',cc.expire_date,'usedCount',cc.used_count,'activatedAt',aa.activated_at,'activeUntil',aa.expires_at,
   'active',coalesce(aa.coupon_id=(SELECT a.coupon_id FROM r347_active_supplement(actor.id,clock_timestamp()) a),false)) ORDER BY gg.coupon_id DESC)
   FROM time_supplement_grants gg JOIN coupons cc ON cc.id=gg.coupon_id
   LEFT JOIN time_supplement_activations aa USING(coupon_id) WHERE gg.member_id=actor.id),'[]'::jsonb);
 END IF;
 IF p_key IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('time-supplement-request:'||actor.id||':'||p_key,0));
 SELECT * INTO prior FROM time_supplement_requests WHERE actor_id=actor.id AND request_key=p_key;
 IF FOUND THEN
  IF prior.action<>p_action OR prior.payload<>p_payload THEN RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
  RETURN prior.result;
 END IF;
 IF p_action='grant' THEN
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM ARRAY['memberCode','reason','timeSlot','title']::text[]
  OR jsonb_typeof(p_payload->'memberCode')<>'string' OR jsonb_typeof(p_payload->'reason')<>'string'
  OR jsonb_typeof(p_payload->'timeSlot')<>'string' OR jsonb_typeof(p_payload->'title')<>'string'
  OR length(btrim(p_payload->>'title')) NOT BETWEEN 1 AND 120 OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 240
  OR NOT coalesce(package_catalog_daily_slot_valid(p_payload->>'timeSlot'),false) THEN RAISE EXCEPTION 'Invalid grant' USING ERRCODE='22023'; END IF;
  SELECT * INTO m FROM members WHERE member_code=p_payload->>'memberCode' FOR UPDATE;
 ELSE
  IF p_payload IS DISTINCT FROM jsonb_build_object('couponId',p_payload->'couponId')
  OR jsonb_typeof(p_payload->'couponId') IS DISTINCT FROM 'number' OR (p_payload->>'couponId') !~ '^[1-9][0-9]{0,8}$'
  THEN RAISE EXCEPTION 'Invalid activation' USING ERRCODE='22023'; END IF;
  SELECT * INTO m FROM members WHERE id=actor.id FOR UPDATE;
 END IF;
 t:=clock_timestamp();
 IF s.expires_at<=t THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM time_supplement_main(m.id,t);
 IF NOT FOUND THEN RAISE EXCEPTION 'Proven active main required'; END IF;
 IF p_action='grant' THEN
  -- One coupon per request, no price, days, bulk targeting, implicit future grants or cancellation.
  INSERT INTO coupons(member_id,type,source,title,total_quota,used_count,bonus_days_value,expire_date,status)
  VALUES(m.id,'CUSTOM','TIME_SUPPLEMENT_REQUEST:'||actor.id||':'||p_key,btrim(p_payload->>'title'),1,0,0,o.main_end,'AVAILABLE') RETURNING id INTO cid;
  UPDATE coupons SET source='TIME_SUPPLEMENT:'||cid WHERE id=cid;
  INSERT INTO time_supplement_grants(coupon_id,member_id,main_order_id,staff_sale_id,main_snapshot,main_expires_at,daily_slot,granted_by,reason)
  VALUES(cid,m.id,o.order_id,o.sale_id,o.package_snapshot,o.main_end,p_payload->>'timeSlot',actor.id,btrim(p_payload->>'reason'));
  result:=jsonb_build_object('couponId',cid,'timeSlot',p_payload->>'timeSlot','expiresAt',o.main_end);
 ELSE
  -- Any concurrent coupon activation for this member converges on the already-active result.
  SELECT a0.* INTO a FROM r347_active_supplement(m.id,t) active
   JOIN time_supplement_activations a0 ON a0.coupon_id=active.coupon_id;
  SELECT * INTO g FROM time_supplement_grants WHERE coupon_id=(p_payload->>'couponId')::integer AND member_id=m.id;
  IF g.coupon_id IS NULL THEN RAISE EXCEPTION 'Coupon unavailable'; END IF;
  IF a.coupon_id IS NOT NULL THEN
   result:=jsonb_build_object('couponId',a.coupon_id,'activatedAt',a.activated_at,'expiresAt',a.expires_at);
  ELSE
   SELECT * INTO c FROM coupons WHERE id=g.coupon_id FOR UPDATE;
   IF (g.main_order_id,g.staff_sale_id,g.main_snapshot,g.main_expires_at)
    IS DISTINCT FROM (o.order_id,o.sale_id,o.package_snapshot,o.main_end)
   OR c.member_id<>m.id OR c.type<>'CUSTOM' OR c.source<>'TIME_SUPPLEMENT:'||g.coupon_id
   OR c.status<>'AVAILABLE' OR c.total_quota<>1 OR c.used_count<>0 OR c.bonus_days_value<>0
   OR c.created_at>t OR c.expire_date IS NULL OR c.expire_date<=t THEN RAISE EXCEPTION 'Coupon unavailable'; END IF;
   ending:=time_supplement_window_end(g.daily_slot,t,least(o.main_end,c.expire_date));
   IF ending IS NULL OR ending<=t THEN RAISE EXCEPTION 'Outside Bangkok window'; END IF;
   UPDATE coupons SET used_count=1,status='USED' WHERE id=c.id;
   INSERT INTO time_supplement_activations VALUES(c.id,m.id,t,ending) RETURNING * INTO a;
   result:=jsonb_build_object('couponId',a.coupon_id,'activatedAt',a.activated_at,'expiresAt',a.expires_at);
  END IF;
 END IF;
 INSERT INTO time_supplement_requests(actor_id,request_key,action,payload,result) VALUES(actor.id,p_key,p_action,p_payload,result);
 RETURN result;
END $$;
CREATE TABLE r7_visits (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 member_id integer NOT NULL REFERENCES members(id),
 checkin_id integer NOT NULL UNIQUE REFERENCES checkins(id),
 entered_at timestamptz NOT NULL,
 exited_at timestamptz,
 entry_actor integer NOT NULL REFERENCES members(id),
 exit_actor integer REFERENCES members(id),
 snapshot jsonb NOT NULL,
 CHECK(exited_at IS NULL OR exited_at>=entered_at),
 CHECK((exited_at IS NULL)=(exit_actor IS NULL))
);
CREATE UNIQUE INDEX r7_one_open_visit ON r7_visits(member_id) WHERE exited_at IS NULL;
CREATE TABLE r7_visit_requests (
 actor_id integer NOT NULL REFERENCES members(id), request_key uuid NOT NULL,
 payload jsonb NOT NULL,result jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_key)
);
CREATE FUNCTION r7_visit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'R7 audit is append-only'; END IF;
 IF OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL OR NEW.exit_actor IS NULL
 OR (to_jsonb(NEW)-'exited_at'-'exit_actor') IS DISTINCT FROM (to_jsonb(OLD)-'exited_at'-'exit_actor') THEN
  RAISE EXCEPTION 'Only first paired exit may update a visit'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER r7_visit_guard BEFORE UPDATE OR DELETE ON r7_visits FOR EACH ROW EXECUTE FUNCTION r7_visit_guard();
CREATE FUNCTION r7_audit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN RAISE EXCEPTION 'R7 audit is append-only'; END $$;
CREATE TRIGGER r7_request_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON r7_visit_requests FOR EACH STATEMENT EXECUTE FUNCTION r7_audit_guard();
CREATE TRIGGER r7_truncate_guard BEFORE TRUNCATE ON r7_visits FOR EACH STATEMENT EXECUTE FUNCTION r7_audit_guard();
CREATE TABLE r7_kiosk_scan_requests (
 station text NOT NULL, request_key uuid NOT NULL, code text NOT NULL,
 direction text NOT NULL CHECK(direction IN ('IN','OUT')),
 actor_id integer NOT NULL REFERENCES members(id), result jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(station,request_key)
);
CREATE TRIGGER r7_kiosk_request_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON r7_kiosk_scan_requests
 FOR EACH STATEMENT EXECUTE FUNCTION r7_audit_guard();
CREATE INDEX r7_kiosk_last_exit ON r7_visits(member_id,exited_at DESC) WHERE exited_at IS NOT NULL;

CREATE FUNCTION r7_visit_action(p_session text,p_station text,p_key uuid,p_code text,p_direction text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; staff members%ROWTYPE; m members%ROWTYPE;
 prior r7_visit_requests%ROWTYPE; v r7_visits%ROWTYPE; payload jsonb; result jsonb; t timestamptz;
BEGIN
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 SELECT * INTO staff FROM members WHERE id=s.member_id FOR SHARE;
 IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp()
 OR staff.id IS NULL OR staff.role NOT IN ('ADMIN','OWNER') OR staff.status='SUSPENDED' THEN
  RAISE EXCEPTION 'Normal staff session required' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_code IS NULL OR p_code !~ '^BLU-[0-9]{1,12}$' OR p_direction IS NULL OR p_direction NOT IN ('IN','OUT')
 OR p_station IS NULL THEN RAISE EXCEPTION 'Invalid visit request' USING ERRCODE='22023'; END IF;
 payload:=jsonb_build_object('code',p_code,'direction',p_direction,'station',p_station);
 PERFORM pg_advisory_xact_lock(hashtextextended('r7-request:'||staff.id||':'||p_key,0));
 SELECT * INTO prior FROM r7_visit_requests WHERE actor_id=staff.id AND request_key=p_key;
 IF FOUND THEN
  IF prior.payload<>payload THEN RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO m FROM members WHERE member_code=p_code FOR UPDATE;
 t:=clock_timestamp();
 IF s.expires_at<=t THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO v FROM r7_visits WHERE member_id=m.id AND exited_at IS NULL FOR UPDATE;
 IF m.id IS NULL THEN result:=jsonb_build_object('ok',false,'reason','NOT_FOUND');
 ELSIF p_direction='OUT' THEN
  IF v.id IS NULL THEN result:=jsonb_build_object('ok',false,'reason','NO_OPEN_VISIT');
  ELSE
   UPDATE r7_visits SET exited_at=t,exit_actor=staff.id WHERE id=v.id;
   result:=jsonb_build_object('ok',true,'reason','EXIT','visitId',v.id,'checkedAt',t);
  END IF;
 ELSIF v.id IS NOT NULL THEN result:=jsonb_build_object('ok',false,'reason','ALREADY_IN','visitId',v.id);
 ELSE
  -- Actor-scoped inner key avoids collisions with legacy station-scoped requests.
  result:=real_frontdesk_checkin(p_session,p_station||':R7:'||staff.id,p_key,p_code);
  IF coalesce((result->>'ok')::boolean,false) THEN
   -- Older ENTRY_ONLY receipts remain replayable through the old RPC, but
   -- must never acquire a fabricated visit if used in the new namespace.
   IF result->>'visitId' IS NULL THEN
    RAISE EXCEPTION 'Unexpected legacy inner admission receipt' USING ERRCODE='22023'; END IF;
  END IF;
 END IF;
 INSERT INTO r7_visit_requests(actor_id,request_key,payload,result) VALUES(staff.id,p_key,payload,result);
 RETURN result;
END $$;
CREATE FUNCTION r7_kiosk_scan(p_session text,p_station text,p_key uuid,p_code text,p_direction text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; staff members%ROWTYPE; m members%ROWTYPE;
 prior r7_kiosk_scan_requests%ROWTYPE; old_card member_card_scan_requests%ROWTYPE; v r7_visits%ROWTYPE;
 result jsonb; t timestamptz; is_card boolean;
BEGIN
 IF p_key IS NULL OR p_station IS NULL OR length(p_station) NOT BETWEEN 1 AND 200
 OR p_code IS NULL OR p_code !~ '^(BLU-[0-9]{1,12}|CARD-[0-9]{1,95})$'
 OR p_direction IS NULL OR p_direction NOT IN ('IN','OUT') THEN
  RAISE EXCEPTION 'Invalid kiosk scan' USING ERRCODE='22023'; END IF;
 is_card:=p_code LIKE 'CARD-%';
 -- Match the existing card lookup/rebind lock order, including when delegating IN.
 IF is_card THEN PERFORM pg_advisory_xact_lock(724192,2); END IF;
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 SELECT * INTO staff FROM members WHERE id=s.member_id FOR SHARE;
 IF s.id IS NULL OR s.mode IS DISTINCT FROM 'KIOSK' OR s.device_id IS DISTINCT FROM p_station
 OR s.revoked_at IS NOT NULL OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp()
 OR staff.id IS NULL OR staff.role NOT IN ('ADMIN','OWNER') OR staff.status='SUSPENDED' THEN
  RAISE EXCEPTION 'Kiosk required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('kiosk-request:'||p_station||':'||p_key::text,0));
 SELECT * INTO prior FROM r7_kiosk_scan_requests WHERE station=p_station AND request_key=p_key;
 IF FOUND THEN
  IF (prior.code,prior.direction) IS DISTINCT FROM (p_code,p_direction) THEN
   RAISE EXCEPTION 'Kiosk request key reused' USING ERRCODE='22023'; END IF;
  result:=prior.result;
 ELSE
  -- Preserve card replay before resolution, including after rebind or a prior NOT_FOUND.
  SELECT * INTO old_card FROM member_card_scan_requests
   WHERE actor_id=staff.id AND station=p_station AND channel='KIOSK' AND request_key=p_key;
  IF FOUND THEN
   IF p_direction<>'IN' OR old_card.payload IS DISTINCT FROM jsonb_build_object('code',p_code,'direction',NULL) THEN
    RAISE EXCEPTION 'Kiosk request key reused' USING ERRCODE='22023'; END IF;
   result:=old_card.result;
  ELSIF EXISTS(SELECT FROM kiosk_requests WHERE station=p_station AND request_key=p_key
             AND (is_card OR p_direction='OUT' OR member_code<>p_code)) THEN
   RAISE EXCEPTION 'Kiosk request key reused' USING ERRCODE='22023';
  ELSIF p_direction='IN' THEN
   IF is_card THEN result:=member_card_admit(p_session,p_station,p_key,p_code,NULL);
   ELSE result:=kiosk_checkin(p_session,p_station,p_key,p_code); END IF;
  ELSE
   IF is_card THEN
    SELECT mbr.* INTO m FROM member_cards c JOIN members mbr ON mbr.id=c.member_id
     WHERE c.card_code=p_code FOR UPDATE OF mbr;
   ELSE SELECT * INTO m FROM members WHERE member_code=p_code FOR UPDATE; END IF;
   SELECT * INTO v FROM r7_visits WHERE member_id=m.id AND exited_at IS NULL FOR UPDATE;
   t:=clock_timestamp();
   IF m.id IS NULL THEN result:=jsonb_build_object('ok',false,'reason','NOT_FOUND');
   ELSIF v.id IS NULL THEN result:=jsonb_build_object('ok',false,'reason','NO_OPEN_VISIT');
   ELSIF t<v.entered_at+interval '3 seconds' THEN result:=jsonb_build_object('ok',false,'reason','BOUNCE');
   ELSE
    -- OUT is not admission: an expired or suspended member may still close a visit.
    UPDATE r7_visits SET exited_at=t,exit_actor=staff.id WHERE id=v.id;
    result:=jsonb_build_object('ok',true,'reason','EXIT','visitId',v.id,'checkedAt',t);
   END IF;
  END IF;
  INSERT INTO r7_kiosk_scan_requests(station,request_key,code,direction,actor_id,result)
   VALUES(p_station,p_key,p_code,p_direction,staff.id,result);
 END IF;
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 RETURN result;
END $$;
-- Capture provenance inside the actual admission decision, before writing the receipt.
DO $admission$
DECLARE signature text; d text; r record; kiosk boolean;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.kiosk_checkin(text,text,uuid,text)','public.real_frontdesk_checkin(text,text,uuid,text)'] LOOP
  kiosk:=signature LIKE 'public.kiosk%';
  d:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
  FOR r IN SELECT * FROM (VALUES
   ('staff_slot text;', 'staff_slot text; visit_id integer; used_slot text; benefit record; supplement_snapshot jsonb; visit_snapshot jsonb;'),
   ($old$ ELSIF m.status='SUSPENDED' THEN reason:='SUSPENDED';$old$, $new$ ELSIF m.status='SUSPENDED' THEN reason:='SUSPENDED';
 ELSIF EXISTS(SELECT FROM r7_visits WHERE member_id=m.id AND exited_at IS NULL) THEN reason:='ALREADY_IN';
 ELSIF EXISTS(SELECT FROM r7_visits WHERE member_id=m.id AND exited_at>t-interval '3 seconds') THEN reason:='BOUNCE';$new$),
   ($old$   IF member_override IS NOT NULL AND s.mode='NORMAL' AND to_regclass('public.r7_visits') IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.r7_visits')
     AND tgname='r3_override_r7_snapshot' AND tgenabled IN ('O','A')) THEN
    RAISE EXCEPTION 'R7 override snapshot attachment required' USING ERRCODE='55000'; END IF;$old$, ''),
   ($old$   IF package_catalog_slot_allows(staff_slot,local_time) THEN reason:='PAID_ENTRY';
   ELSE reason:='OFF_PEAK'; END IF;$old$, $new$   slot:=staff_slot;
   SELECT r347_staff_package(f) INTO STRICT snapshot FROM r4_staff_private.free_sales f WHERE f.sale_id=term_id;
   IF package_catalog_slot_allows(slot,local_time) THEN reason:='PAID_ENTRY'; used_slot:=slot;
   ELSE
    SELECT * INTO benefit FROM r347_active_supplement(m.id,t) a WHERE a.sale_id=term_id;
    IF FOUND THEN reason:='PAID_ENTRY'; used_slot:=benefit.daily_slot;
     supplement_snapshot:=jsonb_build_object('couponId',benefit.coupon_id,'timeSlot',used_slot,'expiresAt',benefit.expires_at);
    ELSE reason:='OFF_PEAK'; END IF;
   END IF;$new$),
   ($old$   IF public.package_catalog_slot_allows(slot,local_time) THEN reason:='PAID_ENTRY';
   ELSIF legacy_slot AND local_time=right(slot,5)::time THEN reason:='PAID_ENTRY';
   ELSIF legacy_slot AND (local_time < time '07:00' OR local_time > time '22:00') THEN reason:='CLOSED';
   ELSE reason:='OFF_PEAK'; END IF;$old$, $new$   IF public.package_catalog_slot_allows(slot,local_time)
    OR (legacy_slot AND local_time=right(slot,5)::time) THEN reason:='PAID_ENTRY'; used_slot:=slot;
   ELSE
    SELECT * INTO benefit FROM r347_active_supplement(m.id,t) a WHERE a.order_id=online_order;
    IF FOUND THEN reason:='PAID_ENTRY'; used_slot:=benefit.daily_slot;
     supplement_snapshot:=jsonb_build_object('couponId',benefit.coupon_id,'timeSlot',used_slot,'expiresAt',benefit.expires_at);
    ELSIF legacy_slot AND (local_time < time '07:00' OR local_time > time '22:00') THEN reason:='CLOSED';
    ELSE reason:='OFF_PEAK'; END IF;
   END IF;$new$),
   ('scanner_device_id,points_awarded,notes)', 'scanner_device_id,points_awarded,checkin_time,notes)'),
   ($old$'HARDWARE_USB',p_station,0,$old$, $new$'HARDWARE_USB',p_station,0,t,$new$),
   ('RETURNING id INTO visit;', $new$RETURNING id INTO visit;
  IF reason='FREE_ENTRY' THEN
   visit_snapshot:=jsonb_build_object('reason',reason,'package',NULL,'orderId',NULL,'mainTimeSlot',NULL,
    'usedTimeSlot','07:00-22:00','supplement',NULL,'welcomeCouponId',c);
  ELSE
   visit_snapshot:=jsonb_build_object('reason',reason,'package',snapshot,
    'orderId',CASE WHEN term_kind IN ('STAFF_FREE','STAFF_TRANSFER') THEN NULL ELSE online_order END,
    'packageSource',CASE WHEN term_kind IN ('STAFF_FREE','STAFF_TRANSFER') THEN term_kind ELSE 'ONLINE_PAID' END,
    'staffSaleId',CASE WHEN term_kind IN ('STAFF_FREE','STAFF_TRANSFER') THEN term_id END,
    'mainTimeSlot',snapshot->>'timeSlot','usedTimeSlot',used_slot,'overrideTimeSlot',member_override,'supplement',supplement_snapshot);
  END IF;
  INSERT INTO r7_visits(member_id,checkin_id,entered_at,entry_actor,snapshot)
   VALUES(m.id,visit,t,staff.id,visit_snapshot) RETURNING id INTO visit_id;$new$),
   ('''checkinId'',visit,''checkedAt''', '''checkinId'',visit,''visitId'',visit_id,''checkedAt'''),
   (' SELECT * INTO prior FROM kiosk_requests', CASE WHEN kiosk THEN $new$ IF EXISTS(SELECT FROM r7_kiosk_scan_requests r WHERE r.station=p_station AND r.request_key=p_key
    AND (r.direction='OUT' OR NOT EXISTS(SELECT FROM kiosk_requests k WHERE k.station=p_station AND k.request_key=p_key))) THEN
  RAISE EXCEPTION 'Kiosk request key reused' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM kiosk_requests$new$ ELSE ' SELECT * INTO prior FROM kiosk_requests' END)
  ) v(anchor,replacement) LOOP
   IF length(d)-length(replace(d,r.anchor,''))<>length(r.anchor) THEN
    RAISE EXCEPTION 'Unreviewed combined admission anchor in %: %',signature,r.anchor; END IF;
   d:=replace(d,r.anchor,r.replacement);
  END LOOP;
  EXECUTE d;
 END LOOP;
END $admission$;
-- Keep the installed R4 checks except the old mutual-exclusion condition.
-- Consuming an online supplement counts as a used benefit even without a visit.
DO $guards$
DECLARE r record; d text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('r4_staff_private.assert_writer_stack()', $old$ OR to_regprocedure('public.time_supplement_allows(integer,timestamptz)') IS NOT NULL
 OR to_regclass('public.r7_visits') IS NOT NULL
 OR to_regprocedure('public.r7_visit_action(text,text,uuid,text,text)') IS NOT NULL$old$, $new$ OR to_regprocedure('public.r347_active_supplement(integer,timestamptz)') IS NULL
 OR to_regclass('public.r7_visits') IS NULL
 OR to_regprocedure('public.r7_visit_action(text,text,uuid,text,text)') IS NULL
 OR to_regprocedure('public.r7_kiosk_scan(text,text,uuid,text,text)') IS NULL
 OR EXISTS (SELECT FROM (VALUES ('public.kiosk_checkin(text,text,uuid,text)'),
   ('public.real_frontdesk_checkin(text,text,uuid,text)')) s(signature)
   LEFT JOIN pg_proc p ON p.oid=to_regprocedure(s.signature)
   WHERE p.oid IS NULL OR p.prosecdef OR strpos(p.prosrc,'INSERT INTO r7_visits')=0
    OR strpos(p.prosrc,'r347_active_supplement')=0)$new$),
  ('r4_online_private.cancellation_eligible(uuid,integer,timestamptz)',
   '   AND e.checkin_fingerprint=', $new$   AND NOT EXISTS (SELECT FROM public.time_supplement_grants g
    JOIN public.time_supplement_activations a USING(coupon_id) WHERE g.main_order_id=o.id)
   AND e.checkin_fingerprint=$new$)
 ) v(signature,anchor,replacement) LOOP
  d:=replace(pg_get_functiondef(r.signature::regprocedure),chr(13),'');
  IF length(d)-length(replace(d,r.anchor,''))<>length(r.anchor) THEN
   RAISE EXCEPTION 'Unreviewed combined writer guard: %',r.signature; END IF;
  EXECUTE replace(d,r.anchor,r.replacement);
 END LOOP;
END $guards$;
REVOKE ALL ON time_supplement_grants,time_supplement_activations,time_supplement_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION time_supplement_immutable(),time_supplement_main(integer,timestamptz),time_supplement_window_end(text,timestamptz,timestamptz),time_supplement_allows(integer,timestamptz),time_supplement_action(text,text,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON r7_visits,r7_visit_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION r7_visit_action(text,text,uuid,text,text),r7_visit_guard(),r7_audit_guard() FROM PUBLIC;
REVOKE ALL ON r7_kiosk_scan_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION r7_kiosk_scan(text,text,uuid,text,text),
 r347_staff_package(r4_staff_private.free_sales),r347_active_supplement(integer,timestamptz) FROM PUBLIC;
SELECT r4_online_private.assert_cancellation_stack();
COMMIT;
