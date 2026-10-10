-- DISPOSABLE POSTGRESQL ONLY, after payment migration. No provider/SMS calls.
-- Never run against a member database. Rows roll back; sequences may advance.
BEGIN;
DO $$
DECLARE
 ids integer[] := '{}'; tokens text[] := '{}'; i integer; member_id integer; failed boolean;
 receiver jsonb := '{"promptpay":"0973355322","bankCode":"004","bankAccount":"0528938965","name":"OFFLINE TEST"}';
 quote jsonb := '{"package":{"id":2,"name":"OFFLINE TEST","durationDays":30,"timeSlot":"07:00-14:00","friendCoupons":0,"bonusDays":0},"subtotalSatang":90000,"discountSatang":0,"amountSatang":90000,"promo":null,"pointsEarned":45}';
 promo jsonb; promo_quote jsonb; proof jsonb; bad_proof jsonb; key uuid := gen_random_uuid();
 o package_payment_orders; replay package_payment_orders; a package_payment_attempts; claimed package_payment_attempts;
 old_expiry timestamptz := clock_timestamp()+interval '10 days'; started timestamptz;
BEGIN
 IF normalize_payment_receiver_name('นาย ณัฐนที รุ่งทองใบสุรีย์') IS DISTINCT FROM normalize_payment_receiver_name('ณัฐนที รุ่งทองใบสุรีย์') THEN RAISE EXCEPTION 'Registered name normalization failed'; END IF;
 FOR i IN 1..7 LOOP
  INSERT INTO members(phone,full_name,member_code,status,points,expire_date,role)
  VALUES('099000000' || i,'PAYMENT_DISPOSABLE_FIXTURE','BLU-PAYMENT-TEST-' || i,'ACTIVE',7,old_expiry,CASE WHEN i=7 THEN 'OWNER'::member_role ELSE 'MEMBER'::member_role END) RETURNING id INTO member_id;
  ids := array_append(ids,member_id); tokens := array_append(tokens,repeat(i::text,64));
  INSERT INTO auth_sessions(member_id,token_hash,expires_at) VALUES(member_id,tokens[i],clock_timestamp()+interval '1 day');
 END LOOP;
 SELECT * INTO o FROM create_package_payment_order(gen_random_uuid(),ids[1],tokens[1],key,quote,receiver);
 SELECT * INTO replay FROM create_package_payment_order(gen_random_uuid(),ids[1],tokens[1],key,quote,receiver);
 IF o.id<>replay.id OR o.upload_deadline<>o.expires_at+interval '30 minutes' THEN RAISE EXCEPTION 'Create idempotency/grace failed'; END IF;
 failed := false;
 BEGIN UPDATE package_payment_orders SET amount_satang=1 WHERE id=o.id; EXCEPTION WHEN OTHERS THEN failed := true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Snapshot mutable'; END IF;
 SELECT * INTO a FROM claim_package_payment_attempt(o.id,ids[1],tokens[1],gen_random_uuid(),repeat('1',64),false);
 SELECT * INTO claimed FROM claim_package_payment_attempt(o.id,ids[1],tokens[1],gen_random_uuid(),repeat('1',64),false);
 IF a.lease_token<>claimed.lease_token THEN RAISE EXCEPTION 'Image replay consumed lease'; END IF;
 failed := false;
 BEGIN PERFORM claim_package_payment_attempt(o.id,ids[1],tokens[1],gen_random_uuid(),repeat('2',64),false); EXCEPTION WHEN OTHERS THEN failed := true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Multiple inflight claims'; END IF;
 proof := jsonb_build_object('transRef','DISPOSABLE-REF-1','paidAt',clock_timestamp(),'amountSatang',90000,'bankCode','004','receiverEvidence','REGISTERED_ACCOUNT_V2','providerStrategy','EASYSLIP_V2_REGISTERED_ACCOUNT','orderId',o.id,'receiverIdentity',jsonb_build_object('bankAccount','0528938965','name','OFFLINE TEST','expectedName','OFFLINE TEST','normalizedName','OFFLINETEST','bankCode','004'));
 -- Each failed finalization rolls back the attempt update; never creates benefits.
 FOR bad_proof IN SELECT v FROM (VALUES
   (jsonb_set(proof,'{orderId}',to_jsonb(gen_random_uuid()::text))),
   (jsonb_set(proof,'{receiverIdentity,bankAccount}','"0528938966"')),
   (jsonb_set(proof,'{receiverIdentity,name}','"OTHER NAME"')),
      (jsonb_set(proof,'{receiverIdentity,expectedName}','"OTHER NAME"')),
   (jsonb_set(proof,'{receiverIdentity,normalizedName}','"OTHERNAME"')),
   (jsonb_set(proof,'{providerStrategy}','"FULL_V1_CONFIRMED"')),
   (jsonb_set(proof,'{receiverEvidence}','"FULL_BANK_ACCOUNT"'))
 ) AS invalid(v) LOOP
   failed := false;
   BEGIN
     UPDATE package_payment_attempts SET state='VERIFIED',evidence=bad_proof WHERE id=a.id;
     PERFORM finalize_package_payment(o.id,ids[1],tokens[1],a.id);
   EXCEPTION WHEN OTHERS THEN failed := true;
   END;
   IF NOT failed OR (SELECT points FROM members WHERE id=ids[1])<>7 THEN RAISE EXCEPTION 'Invalid registered identity or cross-order proof accepted'; END IF;
 END LOOP;
 proof := jsonb_set(proof,'{orderId}',to_jsonb(o.id::text));
 UPDATE package_payment_attempts SET state='VERIFIED',evidence=proof WHERE id=a.id;
 failed := false;
 BEGIN UPDATE package_payment_attempts SET evidence=jsonb_set(evidence,'{transRef}','"FORGED"') WHERE id=a.id; EXCEPTION WHEN OTHERS THEN failed := true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Verified evidence mutable'; END IF;
 SELECT * INTO o FROM finalize_package_payment(o.id,ids[1],tokens[1],a.id);
 PERFORM finalize_package_payment(o.id,ids[1],tokens[1],a.id);
 IF o.status<>'PAID' OR o.membership_expires_at<>old_expiry+interval '30 days' OR (SELECT points FROM members WHERE id=ids[1])<>52 OR (SELECT count(*) FROM package_payment_point_ledger WHERE order_id=o.id)<>1 THEN RAISE EXCEPTION 'Active renewal/idempotent points failed'; END IF;

 -- Expired timestamp with stale ACTIVE flag: benefits start on successful confirmation now.
 UPDATE members SET expire_date=clock_timestamp()-interval '1 day' WHERE id=ids[2];
 SELECT * INTO o FROM create_package_payment_order(gen_random_uuid(),ids[2],tokens[2],gen_random_uuid(),quote,receiver);
 SELECT * INTO a FROM claim_package_payment_attempt(o.id,ids[2],tokens[2],gen_random_uuid(),repeat('3',64),false);
 proof := jsonb_set(proof,'{transRef}','"DISPOSABLE-REF-2"');
 proof := jsonb_set(proof,'{orderId}',to_jsonb(o.id::text));
 UPDATE package_payment_attempts SET state='VERIFIED',evidence=proof WHERE id=a.id;
 SELECT * INTO o FROM finalize_package_payment(o.id,ids[2],tokens[2],a.id);
 IF o.membership_expires_at<>o.confirmed_at+interval '30 days' OR o.confirmed_at<o.paid_at OR (SELECT status FROM members WHERE id=ids[2])<>'ACTIVE' THEN RAISE EXCEPTION 'Expired confirmation-time renewal failed'; END IF;

 -- Historical insertion is fixture-only; immutable timestamps cannot be edited later.
 started := clock_timestamp()-interval '20 minutes';
 promo := jsonb_build_object('code','GRACE_TEST','usageLimit',1,'usedCount',0,'expiresAt',clock_timestamp()+interval '1 day');
 promo_quote := jsonb_set(quote,'{promo}',promo);
 INSERT INTO package_payment_orders(id,member_id,request_key,package_snapshot,receiver_snapshot,subtotal_satang,discount_satang,amount_satang,points_earned,promo_snapshot,promo_code,created_at,expires_at,upload_deadline)
 VALUES(gen_random_uuid(),ids[3],gen_random_uuid(),quote->'package',receiver,90000,0,90000,45,promo,'GRACE_TEST',started,started+interval '15 minutes',started+interval '45 minutes') RETURNING * INTO o;
 failed := false;
 BEGIN PERFORM create_package_payment_order(gen_random_uuid(),ids[4],tokens[4],gen_random_uuid(),promo_quote,receiver); EXCEPTION WHEN OTHERS THEN failed := true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Promo reservation released during upload grace'; END IF;
 SELECT * INTO a FROM claim_package_payment_attempt(o.id,ids[3],tokens[3],gen_random_uuid(),repeat('4',64),false);
 proof := jsonb_set(jsonb_set(proof,'{transRef}','"DISPOSABLE-REF-GRACE"'),'{paidAt}',to_jsonb(o.expires_at-interval '1 minute'));
 proof := jsonb_set(proof,'{orderId}',to_jsonb(o.id::text));
 UPDATE package_payment_attempts SET state='VERIFIED',evidence=proof WHERE id=a.id;
 SELECT * INTO o FROM finalize_package_payment(o.id,ids[3],tokens[3],a.id);
 IF o.status<>'PAID' OR o.paid_at>o.expires_at THEN RAISE EXCEPTION 'First upload during grace failed'; END IF;

 SELECT * INTO o FROM create_package_payment_order(gen_random_uuid(),ids[4],tokens[4],gen_random_uuid(),quote,receiver);
 SELECT * INTO a FROM claim_package_payment_attempt(o.id,ids[4],tokens[4],gen_random_uuid(),repeat('5',64),false);
 proof := jsonb_set(jsonb_set(proof,'{transRef}','"DISPOSABLE-REF-1"'),'{paidAt}',to_jsonb(clock_timestamp()));
 proof := jsonb_set(proof,'{orderId}',to_jsonb(o.id::text));
 UPDATE package_payment_attempts SET state='VERIFIED',evidence=proof WHERE id=a.id;
 SELECT * INTO o FROM finalize_package_payment(o.id,ids[4],tokens[4],a.id);
 IF o.status<>'REJECTED' OR o.rejection_reason<>'DUPLICATE_TRANS_REF' OR (SELECT points FROM members WHERE id=ids[4])<>7 OR (SELECT state FROM package_payment_attempts WHERE id=a.id)<>'REJECTED' OR (SELECT count(*) FROM package_payment_resolution_audit WHERE order_id=o.id)<>1 THEN RAISE EXCEPTION 'Duplicate reference not terminal/audited'; END IF;
 PERFORM finalize_package_payment(o.id,ids[4],tokens[4],a.id);
 IF (SELECT count(*) FROM package_payment_resolution_audit WHERE order_id=o.id)<>1 THEN RAISE EXCEPTION 'Terminal retry duplicated audit'; END IF;

 SELECT * INTO o FROM create_package_payment_order(gen_random_uuid(),ids[5],tokens[5],gen_random_uuid(),quote,receiver);
 SELECT * INTO a FROM claim_package_payment_attempt(o.id,ids[5],tokens[5],gen_random_uuid(),repeat('6',64),false);
 proof := jsonb_set(proof,'{transRef}','"DISPOSABLE-SUSPENDED"');
 proof := jsonb_set(proof,'{orderId}',to_jsonb(o.id::text));
 UPDATE package_payment_attempts SET state='VERIFIED',evidence=proof WHERE id=a.id;
 UPDATE members SET status='SUSPENDED' WHERE id=ids[5];
 SELECT * INTO o FROM finalize_package_payment(o.id,ids[5],tokens[5],a.id);
 IF o.status<>'REJECTED' OR o.rejection_reason<>'MEMBER_SUSPENDED' OR (SELECT points FROM members WHERE id=ids[5])<>7 THEN RAISE EXCEPTION 'Suspended account not terminal'; END IF;

 -- Stale UNKNOWN requires OWNER + approved reconciliation, no manual paid benefits.
 started := clock_timestamp()-interval '1 hour';
 INSERT INTO package_payment_orders(id,member_id,request_key,package_snapshot,receiver_snapshot,subtotal_satang,discount_satang,amount_satang,points_earned,created_at,expires_at,upload_deadline)
 VALUES(gen_random_uuid(),ids[6],gen_random_uuid(),quote->'package',receiver,90000,0,90000,45,started,started+interval '15 minutes',started+interval '45 minutes') RETURNING * INTO o;
 INSERT INTO package_payment_attempts(id,order_id,image_sha256,lease_token,state,created_at,updated_at)
 VALUES(gen_random_uuid(),o.id,repeat('7',64),gen_random_uuid(),'UNKNOWN',started,started) RETURNING * INTO a;
 proof := '{"source":"BANK","outcome":"NO_TRANSFER_CONFIRMED","caseReference":"OFFLINE-CASE-1","summary":"Bank reconciliation confirmed no transfer","approved":true}';
 failed := false;
 BEGIN PERFORM reject_unresolved_package_payment(o.id,ids[1],tokens[1],'Reviewed reconciliation proof',proof); EXCEPTION WHEN OTHERS THEN failed := true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Member resolved owner-only order'; END IF;
 SELECT * INTO o FROM reject_unresolved_package_payment(o.id,ids[7],tokens[7],'Reviewed reconciliation proof',proof);
 IF o.status<>'REJECTED' OR (SELECT points FROM members WHERE id=ids[6])<>7 OR (SELECT count(*) FROM package_payment_resolution_audit WHERE order_id=o.id AND action='OWNER_REJECT')<>1 THEN RAISE EXCEPTION 'Owner resolution missing audit or changed benefits'; END IF;
 failed := false;
 BEGIN UPDATE package_payment_resolution_audit SET reason='tampered' WHERE order_id=o.id; EXCEPTION WHEN OTHERS THEN failed := true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Resolution audit mutable'; END IF;
 RAISE NOTICE 'Payment fixture assertions passed; rollback follows';
END $$;
ROLLBACK;
