-- Synthetic fixtures only. Execute via the scratch native runner.
INSERT INTO members(member_code,full_name,status,role,points)
 SELECT 'BLU-'||i,'Synthetic','EXPIRED', CASE i WHEN 1 THEN 'ADMIN' WHEN 2 THEN 'OWNER' ELSE 'MEMBER' END,7
 FROM generate_series(1,10) i;
INSERT INTO auth_sessions(member_id,token_hash,expires_at)
 SELECT id,'token-'||id,now()+interval '1 day' FROM members;
INSERT INTO auth_sessions(member_id,token_hash,expires_at,mode,device_id)
 VALUES(1,'kiosk',now()+interval '1 day','KIOSK','desk'),(1,'expired',now()-interval '1 day','NORMAL',NULL);
INSERT INTO auth_sessions(member_id,token_hash,expires_at,revoked_at)
 VALUES(1,'revoked',now()+interval '1 day',now());
CREATE FUNCTION test_buy(mid integer, pkg integer) RETURNS package_payment_orders LANGUAGE sql AS $$
 SELECT * FROM create_catalog_package_payment_order(gen_random_uuid(),mid,'token-'||mid,gen_random_uuid(),
  jsonb_build_object('package',jsonb_build_object('id',pkg,'catalogVersion',1)),
  '{"promptpay":"0890000000","bankCode":"002","bankAccount":"1234567890","name":"SYNTHETIC"}')
$$;
CREATE FUNCTION test_settle(mid integer, pkg integer DEFAULT 1) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o package_payment_orders; a package_payment_attempts; token text:='token-'||mid;
BEGIN
 o:=test_buy(mid,pkg);
 SELECT * INTO a FROM claim_package_payment_attempt(o.id,mid,token,gen_random_uuid(),repeat('a',64),false);
 UPDATE package_payment_attempts SET state='VERIFIED',evidence=jsonb_build_object(
   'transRef',gen_random_uuid(),'paidAt',clock_timestamp(),'amountSatang',o.amount_satang,'bankCode','002',
   'receiverEvidence','REGISTERED_ACCOUNT_V2','providerStrategy','EASYSLIP_V2_REGISTERED_ACCOUNT','orderId',o.id,
   'receiverIdentity',jsonb_build_object('matchingType','BANK_ACCOUNT','bankCode','002','bankAccount','1234567890',
    'name','SYNTHETIC','expectedName','SYNTHETIC','normalizedName','SYNTHETIC')) WHERE id=a.id;
 SELECT * INTO o FROM finalize_package_payment(o.id,mid,token,a.id);
 IF o.status IS DISTINCT FROM 'PAID' THEN RAISE EXCEPTION 'Synthetic settlement failed'; END IF;
END $$;
SELECT test_settle(3),test_settle(4),test_settle(5),test_settle(7),test_settle(8),test_settle(9),test_settle(10,2);
UPDATE members SET status='EXPIRED' WHERE id=5;
SELECT test_settle(5);
SELECT test_buy(9,1);
CREATE FUNCTION test_legacy_state() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM members x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM package_payment_orders x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM package_payment_attempts x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY order_id) FROM package_payment_point_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY order_id) FROM entitlement_online_observations x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY trans_ref) FROM payment_transfer_refs x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM coupons x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM checkins x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM finance_entries x),
 (SELECT array_agg(pg_get_functiondef(f) ORDER BY f) FROM unnest(ARRAY[
  'kiosk_checkin(text,text,uuid,text)'::regprocedure,'real_frontdesk_checkin(text,text,uuid,text)'::regprocedure,
  'real_finance_action(text,text,uuid,jsonb)'::regprocedure]) f));
$$;
CREATE TABLE test_pin AS SELECT test_legacy_state() AS business,
 real_finance_action('token-2','read',NULL,'{}') AS finance;
CREATE ROLE test_app NOLOGIN;

-- INSTALL FOUNDATION HERE
DO $$ BEGIN
 IF EXISTS (SELECT FROM r4_staff_private.free_sales) OR EXISTS (SELECT FROM r4_staff_private.finance_source)
 OR to_regprocedure('r4_staff_private.record_free_sale_candidate(text,uuid,text,uuid,integer,text)') IS NOT NULL
 OR has_schema_privilege('test_app','r4_staff_private','USAGE')
 OR has_table_privilege('test_app','r4_staff_private.free_sales','SELECT,INSERT')
 OR has_table_privilege('test_app','r4_staff_private.finance_source','SELECT')
 OR test_legacy_state() IS DISTINCT FROM (SELECT business FROM test_pin) THEN
  RAISE EXCEPTION 'Foundation is not isolated and disabled'; END IF;
END $$;

-- INSTALL WRITER HERE
CREATE FUNCTION test_order(mid integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM package_payment_orders WHERE member_id=mid AND status='PAID' ORDER BY confirmed_at DESC LIMIT 1
$$;
CREATE FUNCTION test_candidate(token text,k uuid,mid integer,reason text DEFAULT 'Synthetic reason') RETURNS jsonb LANGUAGE sql AS $$
 SELECT r4_staff_private.record_free_sale_candidate(token,k,'BLU-'||mid,test_order(mid),1,reason)
$$;
CREATE FUNCTION test_fail_sale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Injected write failure' USING ERRCODE='22000'; END $$;
CREATE TRIGGER test_fail_sale AFTER INSERT ON r4_staff_private.free_sales FOR EACH ROW
 WHEN (NEW.member_id=4) EXECUTE FUNCTION test_fail_sale();
DO $$
DECLARE k uuid:=gen_random_uuid(); failure_key uuid:=gen_random_uuid(); receipt jsonb; s r4_staff_private.free_sales;
 bad_token text; blocked integer;
BEGIN
 IF has_function_privilege('test_app','r4_staff_private.record_free_sale_candidate(text,uuid,text,uuid,integer,text)','EXECUTE') THEN
  RAISE EXCEPTION 'Prototype leaked EXECUTE'; END IF;
 FOREACH bad_token IN ARRAY ARRAY['token-3','kiosk','missing','expired','revoked'] LOOP
  BEGIN PERFORM test_candidate(bad_token,k,3); RAISE EXCEPTION 'Invalid actor accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 BEGIN PERFORM test_candidate('token-1',k,3,E' \t\n'); RAISE EXCEPTION 'Blank reason accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 FOREACH blocked IN ARRAY ARRAY[5,9,10] LOOP
  BEGIN PERFORM test_candidate('token-1',k,blocked); RAISE EXCEPTION 'Ineligible predecessor or benefits accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 END LOOP;
 BEGIN PERFORM r4_staff_private.record_free_sale_candidate('token-1',k,'BLU-3',test_order(4),1,'Test'); RAISE EXCEPTION 'Foreign order accepted';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 BEGIN PERFORM r4_staff_private.record_free_sale_candidate('token-1',k,'BLU-3',test_order(3),2,'Test'); RAISE EXCEPTION 'Stale catalog accepted';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 receipt:=test_candidate('token-1',k,3,E' \tSynthetic reason\n');
 SELECT * INTO STRICT s FROM r4_staff_private.free_sales;
 IF receipt IS DISTINCT FROM jsonb_build_object('candidateId',s.sale_id,'amountSatang',0,'enabled',false)
 OR test_candidate('token-1',k,3) IS DISTINCT FROM receipt
 OR s.actor_id<>1 OR s.actor_role<>'ADMIN' OR s.reason<>'Synthetic reason' OR s.member_id<>3
 OR s.predecessor_order_id IS DISTINCT FROM test_order(3)
 OR s.starts_at IS DISTINCT FROM (SELECT membership_expires_at FROM package_payment_orders WHERE id=test_order(3))
 OR s.ends_at-s.starts_at<>interval '24 hours' OR s.occurred_at<>s.recorded_at
 OR s.catalog_price_satang<>9000 OR s.amount_satang<>0 OR s.daily_slot<>'07:00-14:00'
 OR NOT EXISTS (SELECT FROM r4_staff_private.finance_source f
  WHERE f.sale_id=s.sale_id AND f.type='INCOME' AND f.source='STAFF_FREE' AND f.amount_satang=0
   AND f.source_id='staff-free:'||s.sale_id::text AND f.entry_date=(s.occurred_at AT TIME ZONE 'Asia/Bangkok')::date) THEN
  RAISE EXCEPTION 'Receipt, candidate, or finance provenance mismatch'; END IF;
 BEGIN PERFORM test_candidate('token-1',k,4); RAISE EXCEPTION 'Changed payload accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM test_candidate('token-2',k,3); RAISE EXCEPTION 'Second actor sold the same continuation';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 BEGIN
  UPDATE members SET role='MEMBER' WHERE id=1;
  PERFORM test_candidate('token-1',k,3); RAISE EXCEPTION 'Demoted actor replayed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE members SET status='SUSPENDED' WHERE id=1;
  PERFORM test_candidate('token-1',k,3); RAISE EXCEPTION 'Suspended actor replayed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM test_candidate('token-2',failure_key,4); RAISE EXCEPTION 'After-insert failure did not abort';
 EXCEPTION WHEN data_exception THEN NULL; END;
 IF EXISTS (SELECT FROM r4_staff_private.finance_source WHERE member_id=4) THEN RAISE EXCEPTION 'Orphaned finance row'; END IF;
 ALTER TABLE r4_staff_private.free_sales DISABLE TRIGGER test_fail_sale;
 receipt:=test_candidate('token-2',failure_key,4);
 IF NOT EXISTS (SELECT FROM r4_staff_private.free_sales WHERE request_key=failure_key AND actor_id=2 AND actor_role='OWNER')
 OR test_candidate('token-2',failure_key,4) IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'OWNER recovery failed'; END IF;
 BEGIN UPDATE r4_staff_private.free_sales SET reason='rewrite'; RAISE EXCEPTION 'Audit updated';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 BEGIN DELETE FROM r4_staff_private.free_sales; RAISE EXCEPTION 'Audit deleted';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 BEGIN TRUNCATE r4_staff_private.free_sales; RAISE EXCEPTION 'Audit truncated';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 IF test_legacy_state() IS DISTINCT FROM (SELECT business FROM test_pin)
 OR real_finance_action('token-2','read',NULL,'{}') IS DISTINCT FROM (SELECT finance FROM test_pin)
 THEN RAISE EXCEPTION 'Legacy state or finance changed'; END IF;
 BEGIN PERFORM real_finance_action('token-1','read',NULL,'{}'); RAISE EXCEPTION 'ADMIN gained finance access';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
