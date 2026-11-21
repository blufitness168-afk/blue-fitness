-- Prepare only, after R7 kiosk pairing. Record observed history, never grant admission.
BEGIN;
SELECT 'public.r7_kiosk_scan(text,text,uuid,text,text)'::regprocedure;
ALTER TYPE public.scanner_type ADD VALUE IF NOT EXISTS 'MANUAL';

CREATE FUNCTION public.r7_manual_visit(p_session text,p_key uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog SET TimeZone='UTC' AS $$
DECLARE s auth_sessions%ROWTYPE; owner members%ROWTYPE; target integer;
 prior r7_visit_requests%ROWTYPE; request_payload jsonb; result jsonb;
 entry_at timestamptz; exit_at timestamptz; package_copy jsonb; order_id uuid;
 checkin integer; visit integer; snap jsonb;
BEGIN
 -- The overlap read must see writes committed while waiting on the member lock.
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'Manual visits require READ COMMITTED' USING ERRCODE='0A000'; END IF;
 SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session FOR SHARE;
 SELECT * INTO owner FROM members WHERE id=s.member_id FOR SHARE;
 IF s.id IS NULL OR s.mode IS DISTINCT FROM 'NORMAL' OR s.revoked_at IS NOT NULL
 OR s.expires_at IS NULL OR s.expires_at<=clock_timestamp() OR owner.role IS DISTINCT FROM 'OWNER'
 OR owner.status IS NULL OR owner.status='SUSPENDED' THEN
  RAISE EXCEPTION 'Normal OWNER session required' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid manual visit' USING ERRCODE='22023'; END IF;
 IF NOT (p_payload ?& ARRAY['code','inAt','outAt','orderId','usedTimeSlot','serviceType','reason','note'])
 OR EXISTS(SELECT FROM jsonb_each(p_payload) f WHERE f.key NOT IN ('code','inAt','outAt','orderId','usedTimeSlot','serviceType','reason','note')
   OR jsonb_typeof(f.value)<>'string' AND NOT (f.key IN ('orderId','usedTimeSlot','note') AND f.value='null'))
 OR p_payload->>'code' !~ '^BLU-[0-9]{1,12}$'
 OR p_payload->>'inAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?\+07:00$'
 OR p_payload->>'outAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?\+07:00$'
 OR p_payload->>'orderId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR (p_payload->>'usedTimeSlot' IS NOT NULL AND NOT coalesce(package_catalog_daily_slot_valid(p_payload->>'usedTimeSlot'),false))
 OR p_payload->>'serviceType' !~ '[^[:space:]]' OR length(p_payload->>'serviceType')>80
 OR p_payload->>'reason' !~ '[^[:space:]]' OR length(p_payload->>'reason')>300
 OR length(p_payload->>'note')>300 THEN
  RAISE EXCEPTION 'Invalid manual visit fields' USING ERRCODE='22023'; END IF;
 entry_at:=(p_payload->>'inAt')::timestamptz;
 exit_at:=(p_payload->>'outAt')::timestamptz;
 IF entry_at>=exit_at OR exit_at>clock_timestamp() THEN
  RAISE EXCEPTION 'Require observed IN then OUT, neither in the future' USING ERRCODE='22023'; END IF;
 order_id:=(p_payload->>'orderId')::uuid;
 request_payload:=jsonb_build_object('operation','MANUAL_PAIR','input',p_payload);
 -- Same request namespace as frontdesk R7; no replay across operations.
 PERFORM pg_advisory_xact_lock(hashtextextended('r7-request:'||owner.id||':'||p_key,0));
 SELECT * INTO prior FROM r7_visit_requests WHERE actor_id=owner.id AND request_key=p_key;
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 IF FOUND THEN
  IF prior.payload IS DISTINCT FROM request_payload THEN RAISE EXCEPTION 'Request key reused' USING ERRCODE='22023'; END IF;
  RETURN prior.result;
 END IF;
 -- Frontdesk and kiosk serialize writes on the same member row. Do not pair to any existing row.
 SELECT id INTO target FROM members WHERE member_code=p_payload->>'code' FOR UPDATE;
 IF target IS NULL THEN result:=jsonb_build_object('ok',false,'reason','NOT_FOUND');
 ELSIF EXISTS(SELECT FROM r7_visits v WHERE v.member_id=target AND v.entered_at<exit_at
   AND (v.exited_at IS NULL OR v.exited_at>entry_at OR v.entered_at=entry_at))
 OR EXISTS(SELECT FROM checkins c WHERE c.member_id=target AND c.checkin_time>=entry_at AND c.checkin_time<exit_at
   AND NOT EXISTS(SELECT FROM r7_visits v WHERE v.checkin_id=c.id)) THEN
  result:=jsonb_build_object('ok',false,'reason','OVERLAP');
 ELSE
  IF order_id IS NOT NULL THEN
   -- Corroborate the OWNER's explicit observation from the purchase snapshot, not eligibility or the current catalog.
   SELECT o.package_snapshot INTO package_copy FROM package_payment_orders o
    WHERE o.id=order_id AND o.member_id=target AND o.status='PAID' AND o.paid_at<=entry_at
    AND o.membership_expires_at>entry_at AND jsonb_typeof(o.package_snapshot)='object'
    AND nullif(btrim(o.package_snapshot->>'name'),'') IS NOT NULL;
  END IF;
  IF order_id IS NOT NULL AND package_copy IS NULL THEN
   result:=jsonb_build_object('ok',false,'reason','PACKAGE_UNVERIFIED');
  ELSE
   snap:=jsonb_build_object('reason','MANUAL_PAIR','orderId',order_id,'package',package_copy,
     'packageSource',CASE WHEN package_copy IS NULL THEN 'UNKNOWN' ELSE 'OWNER_OBSERVED_PAID_ORDER' END,
     'mainTimeSlot',package_copy->>'timeSlot','usedTimeSlot',p_payload->'usedTimeSlot',
     'serviceType',p_payload->'serviceType','manualReason',p_payload->'reason','note',p_payload->'note');
   INSERT INTO checkins(member_id,checkin_time,scanner_type,scanner_device_id,points_awarded,notes)
    VALUES(target,entry_at,'MANUAL','OWNER_MANUAL',0,p_payload->>'note') RETURNING id INTO checkin;
   INSERT INTO r7_visits(member_id,checkin_id,entered_at,exited_at,entry_actor,exit_actor,snapshot)
    VALUES(target,checkin,entry_at,exit_at,owner.id,owner.id,snap) RETURNING id INTO visit;
   result:=jsonb_build_object('ok',true,'reason','MANUAL_PAIR','visitId',visit,'checkinId',checkin);
  END IF;
 END IF;
 IF s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Session expired' USING ERRCODE='42501'; END IF;
 INSERT INTO r7_visit_requests(actor_id,request_key,payload,result) VALUES(owner.id,p_key,request_payload,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.r7_manual_visit(text,uuid,jsonb) FROM PUBLIC;
COMMIT;
