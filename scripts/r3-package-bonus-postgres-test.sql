-- Synthetic fixtures for r3-package-bonus-postgres-test.py, not a rollout script.
INSERT INTO members(member_code,full_name,status,role,points)
 SELECT 'TEST-'||i,'Synthetic', 'EXPIRED', CASE WHEN i=1 THEN 'ADMIN' ELSE 'MEMBER' END,7
 FROM generate_series(1,7) i;
INSERT INTO auth_sessions(member_id,token_hash,expires_at)
 SELECT id,'test-'||id,now()+interval '1 day' FROM members;
CREATE FUNCTION test_receiver() RETURNS jsonb LANGUAGE sql AS $$
 SELECT '{"promptpay":"0890000000","bankCode":"002","bankAccount":"1234567890","name":"SYNTHETIC"}'::jsonb
$$;
CREATE FUNCTION test_buy(m integer, k uuid, v integer, pkg integer DEFAULT 2, promo text DEFAULT NULL)
RETURNS package_payment_orders LANGUAGE sql AS $$
 SELECT * FROM create_catalog_package_payment_order(gen_random_uuid(),m,'test-'||m,k,
  jsonb_build_object('package',jsonb_build_object('id',pkg,'catalogVersion',v,'bonusPoints',99999),
    'subtotalSatang',1,'amountSatang',1,'discountSatang',99999,'pointsEarned',99999,
    'promo',jsonb_build_object('code',promo)),test_receiver())
$$;
CREATE FUNCTION test_settle(o package_payment_orders) RETURNS package_payment_orders LANGUAGE plpgsql AS $$
DECLARE a package_payment_attempts;
BEGIN
 SELECT * INTO a FROM package_payment_attempts WHERE order_id=o.id;
 IF NOT FOUND THEN
  SELECT * INTO a FROM claim_package_payment_attempt(o.id,o.member_id,'test-'||o.member_id,gen_random_uuid(),repeat('a',64),false);
  UPDATE package_payment_attempts SET state='VERIFIED',evidence=jsonb_build_object(
   'transRef',gen_random_uuid(),'paidAt',clock_timestamp(),'amountSatang',o.amount_satang,'bankCode','002',
   'receiverEvidence','REGISTERED_ACCOUNT_V2','providerStrategy','EASYSLIP_V2_REGISTERED_ACCOUNT','orderId',o.id,
   'receiverIdentity',jsonb_build_object('matchingType','BANK_ACCOUNT','bankCode','002','bankAccount','1234567890',
    'name','SYNTHETIC','expectedName','SYNTHETIC','normalizedName','SYNTHETIC')) WHERE id=a.id;
 END IF;
 RETURN (SELECT f FROM finalize_package_payment(o.id,o.member_id,'test-'||o.member_id,a.id) f);
END $$;
CREATE TABLE test_before(label text PRIMARY KEY, snapshot jsonb);
DO $$
DECLARE pending package_payment_orders; legacy package_payment_orders; paid package_payment_orders;
BEGIN
 pending:=test_buy(2,gen_random_uuid(),1);
 -- Exercise an unversioned historical checkout as well as a versioned PENDING.
 SELECT * INTO legacy FROM create_package_payment_order(gen_random_uuid(),3,'test-3',gen_random_uuid(),
  jsonb_build_object('package',pending.package_snapshot-ARRAY['snapshotVersion','catalogVersion','priceSatang'],
  'subtotalSatang',90000),test_receiver());
 paid:=test_settle(legacy);
 IF paid.status<>'PAID' OR paid.points_earned<>45 THEN RAISE EXCEPTION 'historical fixture did not settle'; END IF;
 INSERT INTO test_before VALUES ('pending',to_jsonb(pending)),('paid',to_jsonb(paid)),
  ('effects',(SELECT jsonb_build_array(
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM members x),
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY order_id) FROM package_payment_point_ledger x),
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY order_id) FROM entitlement_online_observations x),
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM coupons x))));
END $$;
-- APPLY BONUS MIGRATION HERE
CREATE FUNCTION test_check_award(o package_payment_orders, expected integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE paid package_payment_orders;
BEGIN
 IF o.status<>'PENDING' OR o.points_earned IS DISTINCT FROM expected
 OR (SELECT points FROM members WHERE id=o.member_id) IS DISTINCT FROM 7
 OR EXISTS(SELECT FROM package_payment_point_ledger WHERE order_id=o.id) THEN RAISE EXCEPTION 'incorrect pending points for member %',o.member_id; END IF;
 paid:=test_settle(o);
 IF paid.status<>'PAID' OR paid.package_snapshot IS DISTINCT FROM o.package_snapshot OR paid.points_earned IS DISTINCT FROM expected
 OR to_jsonb(test_settle(paid)) IS DISTINCT FROM to_jsonb(paid)
 OR (SELECT points FROM members WHERE id=o.member_id) IS DISTINCT FROM (7+expected)
 OR (SELECT count(*) FROM package_payment_point_ledger WHERE order_id=o.id AND delta=expected AND balance_after=7+expected)<>1
 OR (SELECT points_delta FROM entitlement_online_observations WHERE order_id=o.id) IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'incorrect settlement/replay for member %',o.member_id;
 END IF;
END $$;
DO $$
DECLARE legacy package_payment_orders; plain package_payment_orders; discounted package_payment_orders; zero_order package_payment_orders;
 a jsonb; b jsonb; patch jsonb; invalid jsonb; forged jsonb; k uuid:=gen_random_uuid();
 create_payload jsonb:='{"name":"Test custom","label":"Test","description":"","priceSatang":2001,"durationDays":1,"timeSlot":"00:00-24:00","friendCoupons":0,"bonusDays":0,"isActive":true,"bonusPoints":1000000}';
BEGIN
 IF (SELECT count(*) FROM package_payment_orders o JOIN test_before b ON b.snapshot->>'id'=o.id::text AND b.snapshot=to_jsonb(o))<>2
 OR (SELECT snapshot FROM test_before WHERE label='effects') IS DISTINCT FROM jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM members x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY order_id) FROM package_payment_point_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY order_id) FROM entitlement_online_observations x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM coupons x)) THEN RAISE EXCEPTION 'migration changed historical state'; END IF;
 SELECT * INTO legacy FROM package_payment_orders WHERE member_id=3;
 IF to_jsonb(test_settle(legacy)) IS DISTINCT FROM (SELECT snapshot FROM test_before WHERE label='paid')
 OR (SELECT points FROM members WHERE id=3) IS DISTINCT FROM 52 THEN RAISE EXCEPTION 'legacy paid replay changed'; END IF;
 IF EXISTS(SELECT FROM package_catalog_public WHERE "bonusPoints" IS DISTINCT FROM 0) THEN RAISE EXCEPTION 'catalog default is not zero'; END IF;
 FOR invalid IN SELECT * FROM jsonb_array_elements('[-1,1.5,"2",null,true,1000001,2147483648]') LOOP
  BEGIN
   PERFORM package_catalog_action('test-1','update',gen_random_uuid(),jsonb_build_object('id',2,'expectedVersion',1,'bonusPoints',invalid));
   RAISE EXCEPTION 'accepted invalid value %',invalid;
  EXCEPTION WHEN invalid_parameter_value OR check_violation OR numeric_value_out_of_range THEN NULL; END;
 END LOOP;
 IF EXISTS(SELECT FROM package_catalog_audit) THEN RAISE EXCEPTION 'invalid input created audit'; END IF;
 BEGIN
  PERFORM package_catalog_action('test-2','update',gen_random_uuid(),'{"id":2,"expectedVersion":1,"bonusPoints":17}');
  RAISE EXCEPTION 'member configured bonus';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 a:=package_catalog_action('test-1','create',gen_random_uuid(),create_payload);
 IF a->'bonusPoints' IS DISTINCT FROM '1000000'::jsonb THEN RAISE EXCEPTION 'create did not save bonus'; END IF;
 b:=package_catalog_action('test-1','create',gen_random_uuid(),create_payload-'bonusPoints');
 IF b->'bonusPoints' IS DISTINCT FROM '0'::jsonb THEN RAISE EXCEPTION 'old create did not default bonus'; END IF;
 patch:='{"id":2,"expectedVersion":1,"bonusPoints":17}';
 a:=package_catalog_action('test-1','update',k,patch);
 IF a->'bonusPoints' IS DISTINCT FROM '17'::jsonb OR package_catalog_action('test-1','update',k,patch) IS DISTINCT FROM a
 OR (SELECT result FROM package_catalog_audit WHERE request_key=k) IS DISTINCT FROM a
 OR (SELECT "bonusPoints" FROM package_catalog_public WHERE id=2) IS DISTINCT FROM 17
 OR NOT (package_catalog_action('test-1','list',NULL,'{}') @> '[{"id":2,"bonusPoints":17}]') THEN
  RAISE EXCEPTION 'catalog update/list/audit/replay mismatch'; END IF;
 BEGIN
  PERFORM test_buy(4,gen_random_uuid(),1);
  RAISE EXCEPTION 'stale quote accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Stale catalog version' THEN RAISE; END IF;
 END;
 SELECT * INTO legacy FROM package_payment_orders WHERE member_id=2;
 IF to_jsonb(test_buy(2,legacy.request_key,1)) IS DISTINCT FROM (SELECT snapshot FROM test_before WHERE label='pending') THEN
  RAISE EXCEPTION 'legacy pending replay recomputed'; END IF;
 -- The catalog now offers +17, but this historical PENDING order must settle at 45.
 PERFORM test_check_award(legacy,45);
 INSERT INTO benefit_definitions(kind,title,code,discount_type,discount_value,usage_limit,expires_at,created_by)
 VALUES('PROMO','Synthetic discount','BONUS-PROMO','FIXED',12345,10,now()+interval '1 day',1);
 INSERT INTO benefit_assignments(definition_id,member_id,granted_by)
 SELECT id,5,1 FROM benefit_definitions WHERE code='BONUS-PROMO';
 plain:=test_buy(4,gen_random_uuid(),2);
 discounted:=test_buy(5,gen_random_uuid(),2,2,' bonus-promo ');
 zero_order:=test_buy(6,gen_random_uuid(),1,1);
 IF (plain.subtotal_satang,plain.discount_satang,plain.amount_satang,plain.package_snapshot->'bonusPoints')
      IS DISTINCT FROM (90000,0,90000,'17'::jsonb)
 OR (discounted.subtotal_satang,discounted.discount_satang,discounted.amount_satang,discounted.package_snapshot->'bonusPoints')
      IS DISTINCT FROM (90000,12345,77655,'17'::jsonb)
 OR (zero_order.amount_satang,zero_order.package_snapshot->'bonusPoints') IS DISTINCT FROM (9000,'0'::jsonb)
 OR plain.package_snapshot->'r3HalfOpenTimeSlot' IS DISTINCT FROM 'true'::jsonb
 OR discounted.package_snapshot->'r3HalfOpenTimeSlot' IS DISTINCT FROM 'true'::jsonb
 OR zero_order.package_snapshot->'r3HalfOpenTimeSlot' IS DISTINCT FROM 'true'::jsonb
 OR (SELECT count(*) FROM benefit_promo_reservations WHERE order_id=discounted.id)<>1 THEN RAISE EXCEPTION 'authoritative quote mismatch'; END IF;
 FOR forged IN SELECT * FROM jsonb_array_elements('[null,"17",18,0]') LOOP
  BEGIN
   PERFORM create_package_payment_order(gen_random_uuid(),7,'test-7',gen_random_uuid(),
     jsonb_build_object('package',jsonb_set(plain.package_snapshot,'{bonusPoints}',forged),'subtotalSatang',90000),test_receiver());
   RAISE EXCEPTION 'forged snapshot accepted' USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'Invalid package bonus points snapshot' THEN RAISE; END IF;
  END;
 END LOOP;
 BEGIN
  PERFORM create_package_payment_order(gen_random_uuid(),7,'test-7',gen_random_uuid(),
    jsonb_build_object('package',plain.package_snapshot-'bonusPoints','subtotalSatang',90000),test_receiver());
  RAISE EXCEPTION 'missing bonus accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Package bonus points snapshot required' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM create_package_payment_order_before_benefits(gen_random_uuid(),7,'test-7',gen_random_uuid(),
    jsonb_build_object('package',plain.package_snapshot,'subtotalSatang',90000,'discountSatang',0,'amountSatang',90000,'pointsEarned',45),test_receiver());
  RAISE EXCEPTION 'base-only total accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE package_payment_orders SET points_earned=999 WHERE id=plain.id;
  RAISE EXCEPTION 'pending points changed' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Payment order snapshot is immutable' THEN RAISE; END IF;
 END;
 a:=package_catalog_action('test-1','update',gen_random_uuid(),'{"id":2,"expectedVersion":2,"label":"Changed"}');
 IF a->'bonusPoints' IS DISTINCT FROM '17'::jsonb THEN RAISE EXCEPTION 'old update cleared bonus'; END IF;
 PERFORM package_catalog_action('test-1','update',gen_random_uuid(),'{"id":2,"expectedVersion":3,"bonusPoints":0}');
 IF (SELECT "bonusPoints" FROM package_catalog_public WHERE id=2) IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'could not clear bonus'; END IF;
 IF to_jsonb(test_buy(4,plain.request_key,2)) IS DISTINCT FROM to_jsonb(plain) THEN RAISE EXCEPTION 'new replay recomputed'; END IF;
 PERFORM test_check_award(plain,62);
 PERFORM test_check_award(discounted,55);
 PERFORM test_check_award(zero_order,4);
END $$;
