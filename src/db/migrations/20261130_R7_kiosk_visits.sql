-- Prepare only: after R7 visits, R6 supplement, and R2 card admission.
-- R4 staff-term admission is a separate stack; do not guess its snapshot.
BEGIN;
CREATE TABLE r7_kiosk_scan_requests (
 station text NOT NULL, request_key uuid NOT NULL, code text NOT NULL,
 direction text NOT NULL CHECK(direction IN ('IN','OUT')),
 actor_id integer NOT NULL REFERENCES members(id), result jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(station,request_key)
);
CREATE TRIGGER r7_kiosk_request_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON r7_kiosk_scan_requests
 FOR EACH STATEMENT EXECUTE FUNCTION r7_audit_guard();
CREATE INDEX r7_kiosk_last_exit ON r7_visits(member_id,exited_at DESC) WHERE exited_at IS NOT NULL;

CREATE FUNCTION r7_kiosk_entry_snapshot(p_member integer,p_at timestamptz,p_reason text,p_coupon integer,
 p_order uuid,p_package jsonb,p_slot text,p_override text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE local_time time:=(p_at AT TIME ZONE 'Asia/Bangkok')::time; used_slot text; supplement jsonb;
BEGIN
 IF p_reason='FREE_ENTRY' THEN
  RETURN jsonb_build_object('reason',p_reason,'package',NULL,'orderId',NULL,'mainTimeSlot',NULL,
   'usedTimeSlot','07:00-22:00','supplement',NULL,'welcomeCouponId',p_coupon);
 END IF;
 IF p_reason IS DISTINCT FROM 'PAID_ENTRY' OR p_order IS NULL THEN RAISE EXCEPTION 'Missing R7 admission provenance'; END IF;
 IF package_catalog_slot_allows(p_slot,local_time) THEN used_slot:=p_slot;
 ELSE
  -- Match the R6 eligibility predicate; do not pick an unrelated active grant.
  SELECT g.daily_slot,jsonb_build_object('couponId',g.coupon_id,'timeSlot',g.daily_slot,'expiresAt',a.expires_at)
  INTO used_slot,supplement FROM time_supplement_activations a
  JOIN time_supplement_grants g USING(coupon_id) JOIN coupons c ON c.id=g.coupon_id
  JOIN time_supplement_main(p_member,p_at) o ON o.id=g.main_order_id AND o.id=p_order
  WHERE a.member_id=p_member AND g.member_id=p_member AND c.member_id=p_member
   AND a.activated_at<=p_at AND a.expires_at>p_at AND g.main_expires_at=o.membership_expires_at
   AND g.main_snapshot=o.package_snapshot AND c.type='CUSTOM' AND c.source='TIME_SUPPLEMENT:'||g.coupon_id
   AND c.status='USED' AND c.total_quota=1 AND c.used_count=1 AND c.bonus_days_value=0 AND c.expire_date>p_at
   AND package_catalog_slot_allows(g.daily_slot,local_time)
  ORDER BY a.activated_at,a.coupon_id LIMIT 1;
  IF used_slot IS NULL AND p_override IS NULL AND package_catalog_legacy_paid_slot(p_package)
   AND local_time=right(p_slot,5)::time THEN used_slot:=p_slot; END IF;
 END IF;
 IF used_slot IS NULL THEN RAISE EXCEPTION 'Missing R7 admission slot'; END IF;
 RETURN jsonb_build_object('reason',p_reason,'package',p_package,'orderId',p_order,'mainTimeSlot',p_package->>'timeSlot',
  'usedTimeSlot',used_slot,'overrideTimeSlot',p_override,'supplement',supplement);
END $$;

-- Keep installed eligibility, auth, bounce and legacy request records in the same entrypoint.
-- In particular, older kiosk clients cannot insert an unpaired IN alongside an open visit.
DO $install$
DECLARE f pg_proc; body_sql text; patch record; override_var text; body_hash text;
BEGIN
 PERFORM 'public.r7_visit_action(text,text,uuid,text,text)'::regprocedure;
 PERFORM 'public.member_card_admit(text,text,uuid,text,text)'::regprocedure;
 SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.kiosk_checkin(text,text,uuid,text)'::regprocedure;
 body_hash:=md5(replace(f.prosrc,chr(13),''));
 IF f.prosecdef OR f.provolatile<>'v' OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_catalog']
 OR body_hash NOT IN ('aa0ce4b3c5cd4fdccdab04ae2d376fa4','d3e770906a895740b2f9afad7b217d9d') THEN
  RAISE EXCEPTION 'Unsupported kiosk admission stack for R7'; END IF;
 override_var:=CASE body_hash WHEN 'd3e770906a895740b2f9afad7b217d9d' THEN 'member_override' ELSE 'NULL' END;
 body_sql:=replace(pg_get_functiondef(f.oid),chr(13),'');
 FOR patch IN SELECT * FROM (VALUES
  ('slot text; snapshot jsonb;', 'slot text; snapshot jsonb; r7_order uuid; r7_id integer;'),
  ('SELECT package_snapshot INTO snapshot FROM package_payment_orders', 'SELECT id,package_snapshot INTO r7_order,snapshot FROM package_payment_orders'),
  (' SELECT * INTO prior FROM kiosk_requests', $new$ IF EXISTS(SELECT 1 FROM r7_kiosk_scan_requests r WHERE r.station=p_station AND r.request_key=p_key
      AND (r.direction='OUT' OR NOT EXISTS(SELECT FROM kiosk_requests k WHERE k.station=p_station AND k.request_key=p_key))) THEN
  RAISE EXCEPTION 'Kiosk request key reused' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM kiosk_requests$new$),
  ($old$ ELSIF m.status='SUSPENDED' THEN reason:='SUSPENDED';$old$, $new$ ELSIF m.status='SUSPENDED' THEN reason:='SUSPENDED';
 ELSIF EXISTS(SELECT 1 FROM r7_visits WHERE member_id=m.id AND exited_at IS NULL) THEN reason:='ALREADY_IN';
 ELSIF EXISTS(SELECT 1 FROM r7_visits WHERE member_id=m.id AND exited_at>t-interval '3 seconds') THEN reason:='BOUNCE';$new$),
  ($old$'KIOSK ENTRY_ONLY '$old$, $new$'KIOSK R7 IN '$new$),
  ('RETURNING id INTO visit;', 'RETURNING id INTO visit;'||$new$
  INSERT INTO r7_visits(member_id,checkin_id,entered_at,entry_actor,snapshot)
  VALUES(m.id,visit,t,staff.id,r7_kiosk_entry_snapshot(m.id,t,reason,c,r7_order,snapshot,slot,$new$||override_var||')) RETURNING id INTO r7_id;'),
  ('''checkinId'',visit,''checkedAt''', '''checkinId'',visit,''visitId'',r7_id,''checkedAt''')
 ) AS p(anchor,replacement) LOOP
  IF length(body_sql)-length(replace(body_sql,patch.anchor,''))<>length(patch.anchor) THEN
   RAISE EXCEPTION 'Unreviewed kiosk admission anchor: %',patch.anchor; END IF;
  body_sql:=replace(body_sql,patch.anchor,patch.replacement);
 END LOOP;
 EXECUTE body_sql;
END $install$;

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
REVOKE ALL ON r7_kiosk_scan_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION r7_kiosk_scan(text,text,uuid,text,text),
 r7_kiosk_entry_snapshot(integer,timestamptz,text,integer,uuid,jsonb,text,text) FROM PUBLIC;
COMMIT;
