-- Synthetic fixtures only; run with the fresh-cluster Python harness.
CREATE ROLE r4_noaccess NOLOGIN;
SELECT member_card_update('token-1',gen_random_uuid(),
 '{"memberCode":"BLU-3","cardCode":"CARD-123","expectedVersion":0,"reason":"Synthetic"}');
CREATE FUNCTION test_candidate(mid integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT r4_staff_private.record_free_sale_candidate('token-1',gen_random_uuid(),'BLU-'||mid,
  (SELECT id FROM package_payment_orders WHERE member_id=mid AND status='PAID'),1,'Synthetic')
$$;
SELECT test_candidate(3),test_candidate(4),test_candidate(7),test_candidate(8);
SELECT r3_override_write('token-1',gen_random_uuid(),jsonb_build_object('memberCode','BLU-3',
 'expectedOrderId',(SELECT predecessor_order_id FROM r4_staff_private.free_sales WHERE member_id=3),
 'expectedVersion',0,'timeSlot','00:00-24:00','reason','Synthetic R3 only'));
INSERT INTO coupons(member_id,type,source,title,total_quota,used_count,created_at,expire_date)
 VALUES (3,'FREE_ENTRY','WELCOME_REGISTRATION','Synthetic',1,0,now(),now()+interval '10 days');
CREATE TABLE test_r4_before AS SELECT member_card_admit('kiosk','desk',
 '61190000-0000-4000-8000-000000000001','CARD-123',NULL) AS replay;
CREATE FUNCTION test_r4_business() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM members x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM package_payment_orders x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY order_id) FROM package_payment_point_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM coupons x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY sale_id) FROM r4_staff_private.free_sales x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY source_id) FROM r4_staff_private.finance_source x));
$$;
ALTER TABLE test_r4_before ADD COLUMN business jsonb;
UPDATE test_r4_before SET business=test_r4_business();

-- APPLY ADMISSION HERE
BEGIN;
DO $$
BEGIN
 IF test_r4_business() IS DISTINCT FROM (SELECT business FROM test_r4_before)
 OR member_card_admit('kiosk','desk','61190000-0000-4000-8000-000000000001','CARD-123',NULL)
    IS DISTINCT FROM (SELECT replay FROM test_r4_before)
 OR has_schema_privilege('r4_noaccess','r4_staff_private','USAGE')
 OR has_function_privilege('r4_noaccess','r4_staff_private.admission_term(integer,timestamptz,uuid)','EXECUTE')
 OR has_table_privilege('r4_noaccess','r4_staff_private.free_sales','SELECT,INSERT') THEN
  RAISE EXCEPTION 'Migration changed legacy data/replay or granted access'; END IF;
END $$;

-- Freeze only the checked-at instant in the actual functions under test. Session
-- checks, writer, settlement, member locking, inserts and wrappers stay real.
DO $$
DECLARE d text;
BEGIN
 FOR d IN SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname IN ('kiosk_checkin','real_frontdesk_checkin') LOOP
  EXECUTE replace(d,'t:=clock_timestamp();',
   $repl$t:=coalesce(nullif(current_setting('test.r4_scan_at',true),'')::timestamptz,clock_timestamp());$repl$);
 END LOOP;
END $$;
CREATE FUNCTION test_r4_scan(token text,station text,k uuid,code text,instant timestamptz) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('test.r4_scan_at',instant::text,true);
 RETURN member_scan_admit(token,station,k,code,CASE WHEN token='kiosk' THEN NULL ELSE 'IN' END);
END $$;
CREATE FUNCTION test_r4_at(mid integer, local_time time) RETURNS timestamptz LANGUAGE sql AS $$
 SELECT CASE WHEN starts_at<=x THEN x ELSE x+interval '24 hours' END
 FROM r4_staff_private.free_sales f CROSS JOIN LATERAL
  (SELECT ((f.starts_at AT TIME ZONE 'Asia/Bangkok')::date+local_time) AT TIME ZONE 'Asia/Bangkok' AS x) t
 WHERE member_id=mid
$$;
CREATE FUNCTION test_fail_r4_visit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Injected late scan failure' USING ERRCODE='22000'; END $$;
CREATE TRIGGER test_fail_r4_visit AFTER INSERT ON kiosk_requests FOR EACH ROW
 WHEN (NEW.station='fail') EXECUTE FUNCTION test_fail_r4_visit();

DO $$
DECLARE s r4_staff_private.free_sales; r jsonb; k uuid:=gen_random_uuid(); n bigint; before_business jsonb:=test_r4_business();
BEGIN
 SELECT * INTO STRICT s FROM r4_staff_private.free_sales WHERE member_id=3;
 IF EXISTS(SELECT FROM r4_staff_private.admission_term(3,s.starts_at-interval '1 microsecond',s.predecessor_order_id))
 OR NOT EXISTS(SELECT FROM r4_staff_private.admission_term(3,s.starts_at,s.predecessor_order_id) WHERE source_kind='STAFF_FREE')
 OR NOT EXISTS(SELECT FROM r4_staff_private.admission_term(3,s.ends_at-interval '1 microsecond',s.predecessor_order_id) WHERE source_kind='STAFF_FREE')
 OR EXISTS(SELECT FROM r4_staff_private.admission_term(3,s.ends_at,s.predecessor_order_id)) THEN RAISE EXCEPTION 'Term bounds'; END IF;
 IF r3_override_slot(3,s.starts_at) IS NOT NULL
 OR EXISTS(SELECT FROM r3_override_current_order(3,s.starts_at)) THEN RAISE EXCEPTION 'R3 overlapped staff term'; END IF;
 r:=test_r4_scan('kiosk','desk',k,'CARD-123',test_r4_at(3,'07:00'));
 IF r->>'reason' IS DISTINCT FROM 'PAID_ENTRY'
 OR NOT EXISTS(SELECT FROM checkins WHERE id=(r->>'checkinId')::integer AND points_awarded=0
               AND notes='KIOSK ENTRY_ONLY STAFF_FREE_ENTRY term=STAFF_FREE:'||s.sale_id)
 OR test_r4_scan('kiosk','desk',k,'CARD-123',s.ends_at) IS DISTINCT FROM r
 OR test_r4_scan('kiosk','desk',gen_random_uuid(),'BLU-3',test_r4_at(3,'07:00')+interval '1 second')->>'reason' IS DISTINCT FROM 'BOUNCE'
 THEN RAISE EXCEPTION 'R4 kiosk path, provenance, replay or bounce: %',r; END IF;
 r:=test_r4_scan('token-1','desk-card',gen_random_uuid(),'CARD-123',test_r4_at(3,'10:00'));
 IF r->>'outSupported' IS DISTINCT FROM 'false' OR NOT EXISTS(SELECT FROM checkins WHERE id=(r->>'checkinId')::integer
               AND notes='FRONTDESK ENTRY_ONLY STAFF_FREE_ENTRY term=STAFF_FREE:'||s.sale_id) THEN RAISE EXCEPTION 'R2 staff CARD delegation'; END IF;
 IF test_r4_scan('token-1','end-slot',gen_random_uuid(),'BLU-3',test_r4_at(3,'14:00'))->>'reason' IS DISTINCT FROM 'OFF_PEAK'
 OR test_r4_scan('token-1','before-term',gen_random_uuid(),'BLU-3',s.starts_at-interval '1 microsecond')->>'reason' IS DISTINCT FROM 'PAID_ENTRY'
 THEN RAISE EXCEPTION 'Staff half-open slot / original override'; END IF;
 BEGIN PERFORM test_r4_scan('kiosk','wrong-station',gen_random_uuid(),'BLU-3',test_r4_at(3,'10:00'));
  RAISE EXCEPTION 'Wrong kiosk station accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM test_r4_scan('token-3','bad-role',gen_random_uuid(),'BLU-3',test_r4_at(3,'10:00'));
  RAISE EXCEPTION 'Member session accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SELECT count(*) INTO n FROM checkins;
 BEGIN PERFORM test_r4_scan('token-1','fail',gen_random_uuid(),'BLU-3',test_r4_at(3,'10:00'));
  RAISE EXCEPTION 'Expected late write failure'; EXCEPTION WHEN data_exception THEN NULL; END;
 IF n<>(SELECT count(*) FROM checkins) OR EXISTS(SELECT FROM kiosk_member_bounce WHERE station='fail')
 OR EXISTS(SELECT FROM kiosk_requests WHERE station='fail') OR EXISTS(SELECT FROM member_card_scan_requests WHERE station='fail')
 OR test_r4_business() IS DISTINCT FROM before_business THEN RAISE EXCEPTION 'Leaked writes, points or coupon use'; END IF;
 -- Existing October closes inclusively; the identical R3 slot is half-open.
 IF test_r4_scan('token-1','october',gen_random_uuid(),'BLU-6',
   (((now() AT TIME ZONE 'Asia/Bangkok')::date+1)+time '14:00') AT TIME ZONE 'Asia/Bangkok')->>'reason' IS DISTINCT FROM 'PAID_ENTRY'
 OR test_r4_scan('token-1','r3',gen_random_uuid(),'BLU-10',
   (((now() AT TIME ZONE 'Asia/Bangkok')::date+1)+time '14:00') AT TIME ZONE 'Asia/Bangkok')->>'reason' IS DISTINCT FROM 'OFF_PEAK'
 THEN RAISE EXCEPTION 'October/R3 closed gate regressed'; END IF;
END $$;
COMMIT;

BEGIN;
DO $$
DECLARE s r4_staff_private.free_sales;
BEGIN
 SELECT * INTO STRICT s FROM r4_staff_private.free_sales WHERE member_id=3;
 PERFORM test_buy(3,1);
 IF test_r4_scan('token-1','pending',gen_random_uuid(),'BLU-3',test_r4_at(3,'10:00'))->>'reason' IS DISTINCT FROM 'NO_ENTITLEMENT'
 OR (SELECT used_count FROM coupons WHERE member_id=3 AND source='WELCOME_REGISTRATION')<>0 THEN RAISE EXCEPTION 'Pending conflict used staff or welcome'; END IF;
 UPDATE members SET status='SUSPENDED' WHERE id=3;
 IF test_r4_scan('token-1','suspend',gen_random_uuid(),'BLU-3',test_r4_at(3,'10:00'))->>'reason' IS DISTINCT FROM 'SUSPENDED'
 THEN RAISE EXCEPTION 'Staff bypassed suspension'; END IF;
END $$;
ROLLBACK;
BEGIN;
DO $$
DECLARE s r4_staff_private.free_sales;
BEGIN
 SELECT * INTO STRICT s FROM r4_staff_private.free_sales WHERE member_id=3;
 UPDATE members SET expire_date=expire_date+interval '1 day' WHERE id=3;
 IF test_r4_scan('token-1','drift',gen_random_uuid(),'BLU-3',test_r4_at(3,'10:00'))->>'reason' IS DISTINCT FROM 'NO_ENTITLEMENT'
 THEN RAISE EXCEPTION 'Aggregate drift was used to admit'; END IF;
END $$;
ROLLBACK;
BEGIN;
DO $$
DECLARE outcome text; uses integer;
BEGIN
 outcome:=test_r4_scan('token-1','expiry',gen_random_uuid(),'BLU-3',test_r4_at(3,'10:00')+interval '24 hours')->>'reason';
 SELECT used_count INTO uses FROM coupons WHERE member_id=3 AND source='WELCOME_REGISTRATION';
 IF outcome IS DISTINCT FROM 'FREE_ENTRY' OR uses IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'Ordinary welcome path did not resume after staff term: outcome %, used %',outcome,uses; END IF;
END $$;
ROLLBACK;
-- Malformed privileged data must not turn overlapping candidates into an
-- arbitrary choice, even when one of the two rows is otherwise valid.
BEGIN;
INSERT INTO r4_staff_private.free_sales(member_id,member_code,predecessor_order_id,actor_id,actor_role,
 request_key,reason,package_id,catalog_version,package_name,duration_days,daily_slot,catalog_price_satang,
 occurred_at,recorded_at,starts_at,ends_at)
 SELECT f.member_id,f.member_code,o.id,f.actor_id,f.actor_role,gen_random_uuid(),f.reason,f.package_id,
 f.catalog_version,f.package_name,f.duration_days,f.daily_slot,f.catalog_price_satang,
 f.occurred_at,f.recorded_at,f.starts_at,f.ends_at
 FROM r4_staff_private.free_sales f CROSS JOIN package_payment_orders o WHERE f.member_id=3 AND o.member_id=10;
DO $$ BEGIN
 IF test_r4_scan('token-1','overlap',gen_random_uuid(),'BLU-3',
                 (SELECT min(starts_at) FROM r4_staff_private.free_sales WHERE member_id=3)+interval '1 hour')->>'reason'
    IS DISTINCT FROM 'NO_ENTITLEMENT' THEN RAISE EXCEPTION 'Ambiguous staff candidates admitted'; END IF;
END $$;
ROLLBACK;
-- Begin with a staff slot that would admit the race scan; do not leave a bounce.
BEGIN;
DO $$ BEGIN
 IF test_r4_scan('token-1','pre-race',gen_random_uuid(),'BLU-8',test_r4_at(8,'15:00'))->>'reason' IS DISTINCT FROM 'PAID_ENTRY' THEN
  RAISE EXCEPTION 'Race fixture: staff should admit before the online sale'; END IF;
END $$;
ROLLBACK;
