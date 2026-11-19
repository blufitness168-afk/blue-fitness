-- PREPARE ONLY. Apply after R3 catalog/checkin; independent of R3 bonus.
BEGIN;
SET LOCAL search_path=public,pg_catalog;
DO $$
DECLARE kiosk_hash text; desk_hash text; has_r6 boolean;
BEGIN
 IF to_regprocedure('public.package_catalog_slot_allows(text,time)') IS NULL
 OR to_regprocedure('public.package_catalog_legacy_paid_slot(jsonb)') IS NULL THEN
  RAISE EXCEPTION 'R3 catalog/checkin required'; END IF;
 has_r6:=to_regprocedure('public.time_supplement_allows(integer,timestamptz)') IS NOT NULL;
 SELECT md5(replace(prosrc,chr(13),'')) INTO kiosk_hash FROM pg_proc
  WHERE oid=to_regprocedure('public.kiosk_checkin(text,text,uuid,text)');
 SELECT md5(replace(prosrc,chr(13),'')) INTO desk_hash FROM pg_proc
  WHERE oid=to_regprocedure('public.real_frontdesk_checkin(text,text,uuid,text)');
 IF kiosk_hash IS DISTINCT FROM (CASE WHEN has_r6 THEN 'aa0ce4b3c5cd4fdccdab04ae2d376fa4' ELSE 'e2ff1bfa02b2f78f10f97784a3a6f427' END)
 OR desk_hash IS DISTINCT FROM (CASE WHEN has_r6 THEN '114657b719f6eedfc4ccded438608860' ELSE '8c7846412e5cb6e550f41b208a2c61a4' END) THEN
  RAISE EXCEPTION 'Unreviewed R3/R6 checkin bodies; no changes applied'; END IF;
END $$;

CREATE TABLE r3_member_time_override_events (
 member_id integer NOT NULL REFERENCES members(id), version integer NOT NULL CHECK(version>0),
 order_id uuid NOT NULL REFERENCES package_payment_orders(id), order_snapshot jsonb NOT NULL,
 confirmed_at timestamptz NOT NULL, membership_expires_at timestamptz NOT NULL,
 actor_id integer NOT NULL REFERENCES members(id), actor_role text NOT NULL CHECK(actor_role IN ('ADMIN','OWNER')),
 request_key uuid NOT NULL, payload jsonb NOT NULL,
 previous_slot text, override_slot text CHECK(package_catalog_daily_slot_valid(override_slot)),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 240), recorded_at timestamptz NOT NULL,
 PRIMARY KEY(member_id,version), UNIQUE(actor_id,request_key)
);
CREATE FUNCTION r3_override_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Member time override audit is append-only'; END $$;
CREATE TRIGGER r3_override_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON r3_member_time_override_events
 FOR EACH STATEMENT EXECUTE FUNCTION r3_override_immutable();

-- Proof of a standalone online term, not an inference from latest PAID or catalog state.
-- All PAID rows count toward ambiguity, even if old, malformed or otherwise ineligible.
CREATE FUNCTION r3_override_current_order(p_member integer,p_at timestamptz)
RETURNS SETOF package_payment_orders LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT o.* FROM package_payment_orders o
 JOIN members m ON m.id=o.member_id
 JOIN package_payment_point_ledger l ON l.order_id=o.id AND l.member_id=m.id
 JOIN payment_transfer_refs r ON r.trans_ref=o.trans_ref AND r.source='PACKAGE_ORDER:'||o.id
 WHERE m.id=p_member AND m.role='MEMBER' AND m.status='ACTIVE' AND m.expire_date>p_at
 AND o.status='PAID' AND o.confirmed_at<=p_at AND o.paid_at<=o.confirmed_at
 AND m.expire_date=o.membership_expires_at
 AND o.membership_expires_at=o.confirmed_at + (CASE
   WHEN (o.package_snapshot->>'durationDays') ~ '^[1-9][0-9]{0,3}$'
   THEN (o.package_snapshot->>'durationDays')::integer END)*interval '24 hours'
 AND package_catalog_daily_slot_valid(o.package_snapshot->>'timeSlot')
 AND NOT EXISTS(SELECT 1 FROM package_payment_orders x WHERE x.member_id=m.id AND x.status='PAID' AND x.id<>o.id)
$$;
CREATE FUNCTION r3_override_slot(p_member integer,p_at timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT e.override_slot FROM
 (SELECT * FROM r3_member_time_override_events WHERE member_id=p_member ORDER BY version DESC LIMIT 1) e
 JOIN LATERAL r3_override_current_order(e.member_id,p_at) o
 ON (o.id,o.confirmed_at,o.membership_expires_at,o.package_snapshot)=
    (e.order_id,e.confirmed_at,e.membership_expires_at,e.order_snapshot)
 WHERE e.override_slot IS NOT NULL AND e.recorded_at<=p_at
$$;

CREATE FUNCTION r3_override_staff(p_session text) RETURNS auth_sessions
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; a members%ROWTYPE;
BEGIN
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 SELECT * INTO a FROM members WHERE id=s.member_id FOR SHARE;
 IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL
 OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp() OR a.id IS NULL OR a.status='SUSPENDED'
 OR a.role IS NULL OR a.role NOT IN ('ADMIN','OWNER') THEN
  RAISE EXCEPTION 'Live normal staff session required' USING ERRCODE='42501'; END IF;
 RETURN s;
END $$;
CREATE FUNCTION r3_override_read(p_session text,p_code text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; mid integer; o package_payment_orders%ROWTYPE; t timestamptz;
BEGIN
 s:=r3_override_staff(p_session);
 IF p_code IS NULL OR p_code !~ '^BLU-[0-9]{1,12}$' THEN RAISE EXCEPTION 'Invalid member code' USING ERRCODE='22023'; END IF;
 SELECT id INTO mid FROM members WHERE member_code=p_code AND role='MEMBER' FOR SHARE;
 t:=clock_timestamp();
 IF s.expires_at<=t THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 IF mid IS NULL THEN RAISE EXCEPTION 'Member not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO o FROM r3_override_current_order(mid,t);
 RETURN jsonb_build_object('version',coalesce((SELECT max(version) FROM r3_member_time_override_events WHERE member_id=mid),0),
  'entitlement',CASE WHEN o.id IS NOT NULL THEN jsonb_build_object('orderId',o.id,
   'expiresAt',o.membership_expires_at,'baseSlot',o.package_snapshot->>'timeSlot','overrideSlot',r3_override_slot(mid,t)) END);
END $$;
CREATE FUNCTION r3_override_write(p_session text,p_key uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; mid integer; o package_payment_orders%ROWTYPE;
 e r3_member_time_override_events%ROWTYPE; t timestamptz; v integer; old_slot text; new_slot text; why text;
BEGIN
 s:=r3_override_staff(p_session);
 new_slot:=p_payload->>'timeSlot'; why:=regexp_replace(p_payload->>'reason','^[[:space:]]+|[[:space:]]+$','','g');
 IF p_key IS NULL OR p_payload IS DISTINCT FROM jsonb_build_object('memberCode',p_payload->'memberCode',
  'expectedOrderId',p_payload->'expectedOrderId','expectedVersion',p_payload->'expectedVersion',
  'timeSlot',p_payload->'timeSlot','reason',p_payload->'reason')
 OR jsonb_typeof(p_payload->'memberCode') IS DISTINCT FROM 'string' OR (p_payload->>'memberCode') !~ '^BLU-[0-9]{1,12}$'
 OR jsonb_typeof(p_payload->'expectedOrderId') IS DISTINCT FROM 'string'
 OR (p_payload->>'expectedOrderId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR jsonb_typeof(p_payload->'expectedVersion') IS DISTINCT FROM 'number' OR (p_payload->>'expectedVersion') !~ '^(0|[1-9][0-9]{0,9})$'
 OR NOT coalesce(jsonb_typeof(p_payload->'timeSlot')='null' OR
  (jsonb_typeof(p_payload->'timeSlot')='string' AND package_catalog_daily_slot_valid(new_slot)),false)
 OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR length(why) NOT BETWEEN 1 AND 240 THEN
  RAISE EXCEPTION 'Invalid time override request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('r3-override:'||s.member_id||':'||p_key,0));
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM r3_member_time_override_events WHERE actor_id=s.member_id AND request_key=p_key;
 IF FOUND THEN
  IF e.payload<>p_payload THEN RAISE EXCEPTION 'Request key reused' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('ok',true,'version',e.version);
 END IF;
 -- This matches the member lock taken by settlement, checkin and coupon redemption.
 SELECT id INTO mid FROM members WHERE member_code=p_payload->>'memberCode' AND role='MEMBER' FOR UPDATE;
 t:=clock_timestamp();
 IF s.expires_at<=t THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 IF mid IS NULL THEN RAISE EXCEPTION 'Member not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO o FROM r3_override_current_order(mid,t);
 SELECT coalesce(max(version),0) INTO v FROM r3_member_time_override_events WHERE member_id=mid;
 IF o.id IS DISTINCT FROM (p_payload->>'expectedOrderId')::uuid OR v<>(p_payload->>'expectedVersion')::bigint OR v=2147483647 THEN
  RAISE EXCEPTION 'Stale version or unproven current entitlement' USING ERRCODE='40001'; END IF;
 old_slot:=r3_override_slot(mid,t);
 IF old_slot IS NOT DISTINCT FROM new_slot THEN RAISE EXCEPTION 'No override change' USING ERRCODE='22023'; END IF;
 INSERT INTO r3_member_time_override_events(member_id,version,order_id,order_snapshot,confirmed_at,membership_expires_at,
  actor_id,actor_role,request_key,payload,previous_slot,override_slot,reason,recorded_at)
 SELECT mid,v+1,o.id,o.package_snapshot,o.confirmed_at,o.membership_expires_at,
  a.id,a.role,p_key,p_payload,old_slot,new_slot,why,t FROM members a WHERE a.id=s.member_id;
 RETURN jsonb_build_object('ok',true,'version',v+1);
END $$;

-- Explicit admission definitions retain legacy names, ACLs, auth, station locks,
-- replay, bounce, welcome redemption, response and checkin row shape.
DO $install$
DECLARE fn_name text; mode_predicate text; denied_message text; entry_note text; supplement_clause text;
BEGIN
 -- Author both known versions here. Do not read/modify installed function source.
 supplement_clause:=CASE WHEN to_regprocedure('public.time_supplement_allows(integer,timestamptz)') IS NOT NULL
   THEN ' OR time_supplement_allows(m.id,t)' ELSE '' END;
 FOREACH fn_name IN ARRAY ARRAY['kiosk_checkin','real_frontdesk_checkin'] LOOP
  IF fn_name='kiosk_checkin' THEN
   mode_predicate:=$literal$'KIOSK' OR s.device_id IS DISTINCT FROM p_station$literal$;
   denied_message:=quote_literal('Kiosk required'); entry_note:=quote_literal('KIOSK ENTRY_ONLY ');
  ELSE
   mode_predicate:=quote_literal('NORMAL');
   denied_message:=quote_literal('Normal admin session required'); entry_note:=quote_literal('FRONTDESK ENTRY_ONLY ');
  END IF;
  EXECUTE $ddl$CREATE OR REPLACE FUNCTION $ddl$||fn_name||$ddl$(p_session text,p_station text,p_key uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE s auth_sessions%ROWTYPE; staff members%ROWTYPE; m members%ROWTYPE; prior kiosk_requests%ROWTYPE;
 slot text; snapshot jsonb; member_override text; legacy_slot boolean; reason text; c integer; visit integer; t timestamptz; local_time time; result jsonb;
BEGIN
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 SELECT * INTO staff FROM members WHERE id=s.member_id FOR SHARE;
 IF s.id IS NULL OR s.mode<>$ddl$||mode_predicate||$ddl$ OR s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp()
 OR staff.id IS NULL OR staff.role NOT IN ('ADMIN','OWNER') OR staff.status='SUSPENDED' THEN
 RAISE EXCEPTION $ddl$||denied_message||$ddl$ USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('kiosk-request:'||p_station||':'||p_key::text,0));
 SELECT * INTO prior FROM kiosk_requests WHERE station=p_station AND request_key=p_key;
 IF FOUND THEN
  IF prior.member_code<>p_code THEN RAISE EXCEPTION 'Request key reused'; END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO m FROM members WHERE member_code=p_code FOR UPDATE;
 t:=clock_timestamp(); local_time:=(t AT TIME ZONE 'Asia/Bangkok')::time;
 reason:='NO_ENTITLEMENT';
 IF m.id IS NULL THEN reason:='NOT_FOUND';
 ELSIF m.status='SUSPENDED' THEN reason:='SUSPENDED';
 ELSIF EXISTS(SELECT 1 FROM kiosk_member_bounce WHERE station=p_station AND member_id=m.id AND accepted_at>t-interval '3 seconds') THEN reason:='BOUNCE';
 ELSE
  SELECT package_snapshot INTO snapshot FROM package_payment_orders
   WHERE member_id=m.id AND status='PAID' ORDER BY paid_at DESC NULLS LAST,created_at DESC,id DESC LIMIT 1;
  slot:=snapshot->>'timeSlot';
  IF m.status='ACTIVE' AND m.expire_date>t AND coalesce(package_catalog_daily_slot_valid(slot),false) THEN
   member_override:=r3_override_slot(m.id,t);
   -- Do not silently admit via the override with an incorrect R7 snapshot if
   -- the R7 migration was installed later but its attachment step was missed.
   IF member_override IS NOT NULL AND s.mode='NORMAL' AND to_regclass('public.r7_visits') IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.r7_visits')
     AND tgname='r3_override_r7_snapshot' AND tgenabled IN ('O','A')) THEN
    RAISE EXCEPTION 'R7 override snapshot attachment required' USING ERRCODE='55000'; END IF;
   legacy_slot:=member_override IS NULL AND package_catalog_legacy_paid_slot(snapshot);
   slot:=coalesce(member_override,slot);
   IF package_catalog_slot_allows(slot,local_time)$ddl$||supplement_clause||$ddl$ THEN reason:='PAID_ENTRY';
   ELSIF legacy_slot AND local_time=right(slot,5)::time THEN reason:='PAID_ENTRY';
   ELSIF legacy_slot AND (local_time < time '07:00' OR local_time > time '22:00') THEN reason:='CLOSED';
   ELSE reason:='OFF_PEAK'; END IF;
  ELSIF local_time < time '07:00' OR local_time > time '22:00' THEN reason:='CLOSED';
  ELSE
   SELECT id INTO c FROM coupons WHERE member_id=m.id AND source='WELCOME_REGISTRATION' AND type='FREE_ENTRY'
    AND status='AVAILABLE' AND total_quota=1 AND used_count=0 AND created_at<=t
    AND created_at+interval '30 days'>t AND expire_date>t ORDER BY id LIMIT 1 FOR UPDATE;
   IF c IS NOT NULL THEN
    UPDATE coupons SET used_count=1,status='USED' WHERE id=c;
    reason:='FREE_ENTRY';
   END IF;
  END IF;
 END IF;
 IF reason IN ('PAID_ENTRY','FREE_ENTRY') THEN
  INSERT INTO checkins(member_id,scanner_type,scanner_device_id,points_awarded,notes)
   VALUES(m.id,'HARDWARE_USB',p_station,0,$ddl$||entry_note||$ddl$||reason||COALESCE(' coupon='||c::text,'')) RETURNING id INTO visit;
  INSERT INTO kiosk_member_bounce VALUES(p_station,m.id,t)
   ON CONFLICT(station,member_id) DO UPDATE SET accepted_at=excluded.accepted_at;
 END IF;
 result:=jsonb_build_object('ok',visit IS NOT NULL,'reason',reason,'checkinId',visit,'checkedAt',t,
  'member',CASE WHEN m.id IS NOT NULL THEN jsonb_build_object('name',m.full_name,'photo',m.avatar_url) ELSE NULL END);
 INSERT INTO kiosk_requests(station,request_key,member_code,result) VALUES(p_station,p_key,p_code,result);
 RETURN result;
END $$$ddl$;
 END LOOP;
END $install$;

-- Optional R7: enrich only new snapshots, not past visits or the R7 API/replay.
CREATE FUNCTION r3_override_r7_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE slot text; used_slot text; local_time time;
BEGIN
 IF NEW.snapshot->>'reason' IS DISTINCT FROM 'PAID_ENTRY' THEN RETURN NEW; END IF;
 slot:=r3_override_slot(NEW.member_id,NEW.entered_at);
 IF slot IS NULL THEN RETURN NEW; END IF;
 local_time:=(NEW.entered_at AT TIME ZONE 'Asia/Bangkok')::time;
 IF package_catalog_slot_allows(slot,local_time) THEN used_slot:=slot;
 ELSE
  -- Use the same provenance predicates as R6, including on R7's fallback path.
  SELECT g.daily_slot INTO used_slot FROM time_supplement_activations a
  JOIN time_supplement_grants g USING(coupon_id) JOIN coupons c ON c.id=g.coupon_id
  JOIN time_supplement_main(NEW.member_id,NEW.entered_at) o ON o.id=g.main_order_id
  WHERE a.member_id=NEW.member_id AND g.member_id=NEW.member_id AND c.member_id=NEW.member_id
   AND a.activated_at<=NEW.entered_at AND a.expires_at>NEW.entered_at AND g.main_expires_at=o.membership_expires_at
   AND g.main_snapshot=o.package_snapshot AND c.type='CUSTOM' AND c.source='TIME_SUPPLEMENT:'||g.coupon_id
   AND c.status='USED' AND c.total_quota=1 AND c.used_count=1 AND c.bonus_days_value=0 AND c.expire_date>NEW.entered_at
   AND package_catalog_slot_allows(g.daily_slot,local_time)
  ORDER BY a.activated_at,a.coupon_id LIMIT 1;
 END IF;
 IF used_slot IS NULL THEN RAISE EXCEPTION 'Missing R7 admission slot for time override'; END IF;
 NEW.snapshot:=NEW.snapshot||jsonb_build_object('overrideTimeSlot',slot,'usedTimeSlot',used_slot);
 RETURN NEW;
END $$;
CREATE FUNCTION r3_override_attach_r7() RETURNS void LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE body_hash text;
BEGIN
 IF to_regprocedure('public.r7_visit_action(text,text,uuid,text,text)') IS NULL
 AND to_regclass('public.r7_visits') IS NULL THEN RETURN; END IF;
 SELECT md5(replace(prosrc,chr(13),'')) INTO body_hash FROM pg_proc
  WHERE oid=to_regprocedure('public.r7_visit_action(text,text,uuid,text,text)');
 IF body_hash IS DISTINCT FROM '7db4cfc995e0ba8e312abb12452498ec' OR to_regclass('public.r7_visits') IS NULL
 OR to_regprocedure('public.time_supplement_allows(integer,timestamptz)') IS NULL THEN
  RAISE EXCEPTION 'Unreviewed R7/R6 stack; no override snapshot integration'; END IF;
 CREATE TRIGGER r3_override_r7_snapshot BEFORE INSERT ON public.r7_visits
  FOR EACH ROW EXECUTE FUNCTION public.r3_override_r7_snapshot();
END $$;
SELECT r3_override_attach_r7();

REVOKE ALL ON r3_member_time_override_events FROM PUBLIC;
REVOKE ALL ON FUNCTION r3_override_immutable(),r3_override_current_order(integer,timestamptz),r3_override_slot(integer,timestamptz),
 r3_override_staff(text),r3_override_read(text,text),r3_override_write(text,uuid,jsonb),
 r3_override_r7_snapshot(),r3_override_attach_r7() FROM PUBLIC;
COMMIT;
