-- Synthetic only: input for the isolated native runner, not for rollout.
INSERT INTO members(member_code,full_name,status,role,points)
 SELECT 'BLU-'||i,'Synthetic','EXPIRED', CASE i WHEN 1 THEN 'ADMIN' WHEN 2 THEN 'OWNER' ELSE 'MEMBER' END,7
 FROM generate_series(1,6) i;
INSERT INTO auth_sessions(member_id,token_hash,expires_at)
 SELECT id,'token-'||id,now()+interval '1 day' FROM members;
INSERT INTO auth_sessions(member_id,token_hash,expires_at,mode,device_id)
 VALUES(1,'kiosk',now()+interval '1 day','KIOSK','desk');
CREATE FUNCTION test_settle(mid integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o package_payment_orders; a package_payment_attempts; token text:='token-'||mid;
BEGIN
 SELECT * INTO o FROM create_catalog_package_payment_order(gen_random_uuid(),mid,token,gen_random_uuid(),
  '{"package":{"id":2,"catalogVersion":1}}',
  '{"promptpay":"0890000000","bankCode":"002","bankAccount":"1234567890","name":"SYNTHETIC"}');
 SELECT * INTO a FROM claim_package_payment_attempt(o.id,mid,token,gen_random_uuid(),repeat('a',64),false);
 UPDATE package_payment_attempts SET state='VERIFIED',evidence=jsonb_build_object(
   'transRef',gen_random_uuid(),'paidAt',clock_timestamp(),'amountSatang',o.amount_satang,'bankCode','002',
   'receiverEvidence','REGISTERED_ACCOUNT_V2','providerStrategy','EASYSLIP_V2_REGISTERED_ACCOUNT','orderId',o.id,
   'receiverIdentity',jsonb_build_object('matchingType','BANK_ACCOUNT','bankCode','002','bankAccount','1234567890',
    'name','SYNTHETIC','expectedName','SYNTHETIC','normalizedName','SYNTHETIC')) WHERE id=a.id;
 SELECT * INTO o FROM finalize_package_payment(o.id,mid,token,a.id);
 IF o.status IS DISTINCT FROM 'PAID' THEN RAISE EXCEPTION 'Synthetic settlement failed'; END IF;
END $$;
SELECT test_settle(3),test_settle(4),test_settle(5);
-- Two PAIDs on member 5, one of them having an exactly matching standalone interval.
UPDATE members SET status='EXPIRED' WHERE id=5;
SELECT test_settle(5);
-- APPLY R3 HERE
CREATE FUNCTION test_payload(mid integer, v integer, slot text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('memberCode','BLU-'||mid,'expectedVersion',v,'timeSlot',slot,'reason','synthetic reason',
 'expectedOrderId',(SELECT id FROM package_payment_orders WHERE member_id=mid ORDER BY confirmed_at DESC LIMIT 1));
$$;
SELECT member_card_update('token-1',gen_random_uuid(),'{"memberCode":"BLU-3","cardCode":"CARD-123","expectedVersion":0,"reason":"Synthetic"}');
CREATE FUNCTION test_state() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM members m),
  (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM package_payment_orders o),
  (SELECT jsonb_agg(to_jsonb(l) ORDER BY order_id) FROM package_payment_point_ledger l),
  (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM coupons c));
$$;
CREATE TABLE test_pin AS SELECT test_state() AS business,
 member_card_admit('kiosk','desk','1596dd80-ec73-4ad0-8eb7-abe5e398241c','CARD-123',NULL) AS scan;
-- APPLY OVERRIDE HERE
-- Roll back fixed-clock definitions, scans, and temporary overrides before the
-- other tests. Tomorrow is after settlement and inside the 30-day paid term.
BEGIN;
DO $$
DECLARE d text; defs text[]; instant timestamptz; visit jsonb; v integer:=0; wanted text;
BEGIN
 IF (SELECT package_snapshot ? 'r3HalfOpenTimeSlot' FROM package_payment_orders WHERE member_id=3) THEN
  RAISE EXCEPTION 'October snapshot was changed'; END IF;
 SELECT array_agg(pg_get_functiondef(oid)) INTO defs FROM pg_proc
  WHERE proname IN ('kiosk_checkin','real_frontdesk_checkin');
 FOR i IN 1..4 LOOP
  CASE i
   WHEN 1 THEN instant:=((now() AT TIME ZONE 'Asia/Bangkok')::date+1+time '06:59:59.999999') AT TIME ZONE 'Asia/Bangkok'; wanted:='CLOSED';
   ELSE instant:=((now() AT TIME ZONE 'Asia/Bangkok')::date+1+time '14:00') AT TIME ZONE 'Asia/Bangkok'; wanted:='PAID_ENTRY';
  END CASE;
  IF i=3 THEN
   PERFORM r3_override_write('token-1',gen_random_uuid(),test_payload(3,v,'07:00-14:00'));
   v:=v+1; wanted:='OFF_PEAK';
  ELSIF i=4 THEN
   PERFORM r3_override_write('token-1',gen_random_uuid(),test_payload(3,v,NULL));
  END IF;
  FOREACH d IN ARRAY defs LOOP
   EXECUTE replace(d,'t:=clock_timestamp();',format('t:=%L::timestamptz;',instant));
  END LOOP;
  DELETE FROM kiosk_member_bounce WHERE member_id=3;
  IF kiosk_checkin('kiosk','desk',gen_random_uuid(),'BLU-3')->>'reason' IS DISTINCT FROM wanted
   OR real_frontdesk_checkin('token-1','legacy-boundary',gen_random_uuid(),'BLU-3')->>'reason' IS DISTINCT FROM wanted THEN
   RAISE EXCEPTION 'Legacy boundary/override mismatch, case %',i; END IF;
  IF i=4 AND to_regclass('public.r7_visits') IS NOT NULL THEN
   visit:=member_scan_admit('token-1','legacy-r7',gen_random_uuid(),'CARD-123','IN');
   IF visit->>'reason' IS DISTINCT FROM 'PAID_ENTRY' OR NOT EXISTS(SELECT FROM r7_visits
    WHERE checkin_id=(visit->>'checkinId')::integer AND snapshot->>'usedTimeSlot'='07:00-14:00') THEN
    RAISE EXCEPTION 'Legacy closing instant lost its R7 slot attribution'; END IF;
  END IF;
 END LOOP;
END $$;
ROLLBACK;
DO $$
DECLARE p jsonb:=test_payload(3,0,'00:00-24:00'); k uuid:=gen_random_uuid(); r jsonb; state jsonb;
 slot text; off_hour integer; scan_key uuid:=gen_random_uuid(); bad_token text; base_slot text; grant_result jsonb; clear_key uuid:=gen_random_uuid();
BEGIN
 IF test_state() IS DISTINCT FROM (SELECT business FROM test_pin) THEN RAISE EXCEPTION 'Migration changed business state'; END IF;
 IF member_card_admit('kiosk','desk','1596dd80-ec73-4ad0-8eb7-abe5e398241c','CARD-123',NULL) IS DISTINCT FROM (SELECT scan FROM test_pin) THEN
  RAISE EXCEPTION 'Historical card replay changed'; END IF;
 IF NOT package_catalog_slot_allows('00:00-24:00','00:00') OR package_catalog_slot_allows('00:00-24:00','24:00')
 OR NOT package_catalog_slot_allows('07:00-14:00','07:00') OR package_catalog_slot_allows('07:00-14:00','14:00') THEN
  RAISE EXCEPTION 'Slot boundary semantics changed'; END IF;
 FOREACH bad_token IN ARRAY ARRAY['token-3','kiosk','missing'] LOOP
  BEGIN PERFORM r3_override_write(bad_token,k,p); RAISE EXCEPTION 'Non-staff write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 BEGIN PERFORM r3_override_write('token-1',k,p||'{"expireDate":"2099-01-01"}'); RAISE EXCEPTION 'Overpost accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM r3_override_write('token-1',k,p||jsonb_build_object('expectedOrderId',gen_random_uuid())); RAISE EXCEPTION 'Stale order accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 IF r3_override_read('token-2','BLU-5')->'entitlement' IS DISTINCT FROM 'null'::jsonb
 OR r3_override_read('token-1','BLU-6')->'entitlement' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Unproven read'; END IF;
 BEGIN PERFORM r3_override_write('token-2',gen_random_uuid(),test_payload(5,0,'00:00-24:00')); RAISE EXCEPTION 'Ambiguous write';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 r:=r3_override_write('token-1',k,p);
 state:=r3_override_read('token-2','BLU-3'); base_slot:=state->'entitlement'->>'baseSlot';
 IF r->'version' IS DISTINCT FROM '1'::jsonb OR state->'entitlement'->>'overrideSlot' IS DISTINCT FROM '00:00-24:00'
 OR (SELECT actor_role FROM r3_member_time_override_events WHERE request_key=k) IS DISTINCT FROM 'ADMIN' THEN RAISE EXCEPTION 'Set or audit failed'; END IF;
 BEGIN PERFORM r3_override_write('token-1',k,p||'{"reason":"changed"}'); RAISE EXCEPTION 'Conflicting replay accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN PERFORM r3_override_write('token-2',gen_random_uuid(),p); RAISE EXCEPTION 'Stale version accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN UPDATE r3_member_time_override_events SET reason='tampered'; RAISE EXCEPTION 'Mutable audit' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF; END;
 IF test_state() IS DISTINCT FROM (SELECT business FROM test_pin) THEN RAISE EXCEPTION 'Override changed business state'; END IF;
 IF to_regclass('public.r7_visits') IS NOT NULL THEN
  BEGIN
   ALTER TABLE r7_visits DISABLE TRIGGER r3_override_r7_snapshot;
   PERFORM member_scan_admit('token-1','missing-r7-trigger',gen_random_uuid(),'CARD-123','IN');
   RAISE EXCEPTION 'R7 admission without the snapshot trigger';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 END IF;
 r:=member_scan_admit('token-1','staff',scan_key,'CARD-123','IN');
 IF r->>'reason' IS DISTINCT FROM 'PAID_ENTRY' THEN RAISE EXCEPTION 'Card frontdesk admission failed: %',r; END IF;
 IF to_regclass('public.r7_visits') IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM r7_visits WHERE checkin_id=(r->>'checkinId')::integer
     AND snapshot @> jsonb_build_object('usedTimeSlot','00:00-24:00','mainTimeSlot',base_slot,'overrideTimeSlot','00:00-24:00')) THEN
   RAISE EXCEPTION 'Incorrect visit snapshot'; END IF;
  IF member_scan_admit('token-1','staff',gen_random_uuid(),'CARD-123','OUT')->>'reason' IS DISTINCT FROM 'EXIT' THEN
   RAISE EXCEPTION 'R7 exit failed'; END IF;
 END IF;
 off_hour:=(extract(hour FROM clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::integer+12)%24;
 slot:=lpad(off_hour::text,2,'0')||':00-'||lpad((off_hour+1)::text,2,'0')||':00';
 PERFORM r3_override_write('token-2',gen_random_uuid(),test_payload(3,1,slot));
 BEGIN
  PERFORM kiosk_checkin('kiosk','desk-deny',gen_random_uuid(),'BLU-3'); RAISE EXCEPTION 'Wrong kiosk station accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- Member 4 has no pre-existing bounce record; member 3 can be tested via a fresh frontdesk station.
 IF real_frontdesk_checkin('token-1','fresh-deny',gen_random_uuid(),'BLU-3')->>'reason' IS DISTINCT FROM 'OFF_PEAK' THEN
  RAISE EXCEPTION 'Override did not replace base slot'; END IF;
 IF member_scan_admit('token-1','staff',scan_key,'CARD-123','IN') IS DISTINCT FROM r THEN
  RAISE EXCEPTION 'Existing scan replay changed'; END IF;
 IF r3_override_write('token-1',k,p)->'version' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'Old write not replayed'; END IF;
 IF to_regprocedure('public.time_supplement_allows(integer,timestamptz)') IS NOT NULL THEN
  grant_result:=time_supplement_action('token-1','grant',gen_random_uuid(),
   '{"memberCode":"BLU-3","timeSlot":"00:00-24:00","reason":"Synthetic","title":"Synthetic"}');
  PERFORM time_supplement_action('token-3','activate',gen_random_uuid(),jsonb_build_object('couponId',grant_result->'couponId'));
  IF to_regclass('public.r7_visits') IS NOT NULL THEN
   r:=member_scan_admit('token-1','r6-r7',gen_random_uuid(),'CARD-123','IN');
   IF NOT EXISTS(SELECT 1 FROM r7_visits WHERE checkin_id=(r->>'checkinId')::integer
    AND snapshot @> jsonb_build_object('usedTimeSlot','00:00-24:00','overrideTimeSlot',slot,'mainTimeSlot',base_slot)) THEN
    RAISE EXCEPTION 'R7 supplement fallback failed: %',r; END IF;
  ELSE
   IF real_frontdesk_checkin('token-1','r6',gen_random_uuid(),'BLU-3')->>'reason' IS DISTINCT FROM 'PAID_ENTRY' THEN
    RAISE EXCEPTION 'R6-only supplement fallback failed'; END IF;
  END IF;
 END IF;
 r:=r3_override_write('token-2',clear_key,test_payload(3,2,NULL));
 state:=r3_override_read('token-1','BLU-3');
 IF r->'version' IS DISTINCT FROM '3'::jsonb
 OR state->'entitlement'->'overrideSlot' IS DISTINCT FROM 'null'::jsonb
 OR NOT EXISTS (SELECT 1 FROM r3_member_time_override_events WHERE request_key=clear_key AND actor_role='OWNER'
  AND previous_slot=slot AND override_slot IS NULL) THEN RAISE EXCEPTION 'Clear/audit failed'; END IF;
 PERFORM r3_override_write('token-2',gen_random_uuid(),test_payload(3,3,'00:00-24:00'));
 p:=test_payload(3,4,slot);
 PERFORM test_settle(3);
 IF r3_override_slot(3,clock_timestamp()) IS NOT NULL THEN RAISE EXCEPTION 'Override leaked to renewal'; END IF;
 BEGIN PERFORM r3_override_write('token-1',gen_random_uuid(),p); RAISE EXCEPTION 'Stale post-renewal override accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
