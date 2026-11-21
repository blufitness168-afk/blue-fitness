-- Prepare only. Apply after the R4-first combined migration and, in a separate
-- committed transaction, 20261201_R7_manual_visits.sql. Not for standalone R7.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$
BEGIN
 IF NOT EXISTS (SELECT FROM pg_proc p
   WHERE p.oid=to_regprocedure('public.r7_manual_visit(text,uuid,jsonb)')
    AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=public, pg_catalog','TimeZone=UTC']
    AND md5(replace(p.prosrc,chr(13),''))='b29ea5e85f57dfc1c6441ae387d0c8aa')
 OR to_regprocedure('public.r347_active_supplement(integer,timestamptz)') IS NULL THEN
  RAISE EXCEPTION 'Install the reviewed R4-first combined and manual R7 migrations first';
 END IF;
END $guard$;

-- Use the combined cancellation-aware proof at the observed IN, under the
-- same member lock as the sale/visit writers. No fallback to catalog, the
-- latest sale, the predecessor order or the reported service window.
CREATE FUNCTION public.r7_manual_staff_source(p_member integer,p_in timestamptz,p_sale uuid)
RETURNS TABLE(package_snapshot jsonb,source_kind text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_catalog AS $proof$
 SELECT m.package_snapshot,f.method
 FROM public.time_supplement_main(p_member,p_in) m
 JOIN r4_staff_private.free_sales f ON f.sale_id=m.sale_id
 WHERE m.order_id IS NULL AND m.sale_id=p_sale AND f.member_id=p_member
  AND f.method IN ('STAFF_FREE','STAFF_TRANSFER') AND f.starts_at<=p_in AND p_in<f.ends_at
$proof$;
REVOKE ALL ON FUNCTION public.r7_manual_staff_source(integer,timestamptz,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.r7_manual_visit(p_session text,p_key uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog SET TimeZone='UTC' AS $$
DECLARE s auth_sessions%ROWTYPE; owner members%ROWTYPE; target integer;
 prior r7_visit_requests%ROWTYPE; request_payload jsonb; result jsonb;
 entry_at timestamptz; exit_at timestamptz; package_copy jsonb; order_id uuid;
 checkin integer; visit integer; snap jsonb; staff_sale_id uuid; staff_method text;
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
 OR EXISTS(SELECT FROM jsonb_each(p_payload) f WHERE f.key NOT IN ('code','inAt','outAt','orderId','usedTimeSlot','serviceType','reason','note','staffSaleId')
   OR jsonb_typeof(f.value)<>'string' AND NOT (f.key IN ('orderId','usedTimeSlot','note','staffSaleId') AND f.value='null'))
 OR p_payload->>'code' !~ '^BLU-[0-9]{1,12}$'
 OR p_payload->>'inAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?\+07:00$'
 OR p_payload->>'outAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?\+07:00$'
 OR p_payload->>'orderId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR p_payload->>'staffSaleId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR (p_payload->>'orderId' IS NOT NULL AND p_payload->>'staffSaleId' IS NOT NULL)
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
 staff_sale_id:=(p_payload->>'staffSaleId')::uuid;
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
  IF staff_sale_id IS NOT NULL THEN
   SELECT proof.package_snapshot,proof.source_kind INTO package_copy,staff_method
   FROM public.r7_manual_staff_source(target,entry_at,staff_sale_id) proof;
  ELSIF order_id IS NOT NULL THEN
   -- Corroborate the OWNER's explicit observation from the purchase snapshot, not eligibility or the current catalog.
   SELECT o.package_snapshot INTO package_copy FROM package_payment_orders o
    WHERE o.id=order_id AND o.member_id=target AND o.status='PAID' AND o.paid_at<=entry_at
    AND o.membership_expires_at>entry_at AND jsonb_typeof(o.package_snapshot)='object'
    AND nullif(btrim(o.package_snapshot->>'name'),'') IS NOT NULL;
  END IF;
  IF (order_id IS NOT NULL OR staff_sale_id IS NOT NULL) AND package_copy IS NULL THEN
   result:=jsonb_build_object('ok',false,'reason','PACKAGE_UNVERIFIED');
  ELSE
   snap:=jsonb_build_object('reason','MANUAL_PAIR','orderId',order_id,'package',package_copy,
     'packageSource',CASE WHEN package_copy IS NULL THEN 'UNKNOWN' ELSE 'OWNER_OBSERVED_PAID_ORDER' END,
     'mainTimeSlot',package_copy->>'timeSlot','usedTimeSlot',p_payload->'usedTimeSlot',
     'serviceType',p_payload->'serviceType','manualReason',p_payload->'reason','note',p_payload->'note');
   IF staff_method IS NOT NULL THEN
    snap:=snap||jsonb_build_object('staffSaleId',staff_sale_id,'packageSource',staff_method);
   END IF;
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
