// Live installed functions only; all fixture and catalog writes must roll back.
import { client, protect, local, save, stamp, safeFailure } from './db-safety.mjs';
import path from 'node:path';

const statement = `DO $uat$
#variable_conflict use_variable
DECLARE
 owner_id integer; second_owner_id integer; member_id integer; admin_id integer;
 owner_token text:=repeat(md5(gen_random_uuid()::text),2);
 second_token text:=repeat(md5(gen_random_uuid()::text),2);
 member_token text:=repeat(md5(gen_random_uuid()::text),2);
 admin_token text:=repeat(md5(gen_random_uuid()::text),2);
 kiosk_token text:=repeat(md5(gen_random_uuid()::text),2);
 marker text:='CAT_UAT_'||gen_random_uuid();
 original package_catalog; edited package_catalog;
 edit_key uuid:=gen_random_uuid(); order_key uuid:=gen_random_uuid(); order_id uuid:=gen_random_uuid();
 payload jsonb; quote jsonb; r jsonb; again jsonb; order_row jsonb; expected_snapshot jsonb;
 receiver jsonb:='{"promptpay":"0890000000","bankCode":"002","bankAccount":"1234567890","name":"SYNTHETIC UAT"}';
 denied boolean; caught_message text; rolled_back boolean:=false;
 checks text[]:=ARRAY[]::text[]; originals jsonb:='{}'; tab record; h text; table_count integer:=0;
 audit_hash text; old_audit_hash text; verb text; token text; role_name text;
BEGIN
 PERFORM set_config('lock_timeout','4s',true);
 PERFORM set_config('statement_timeout','60s',true);
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'off' THEN
  RAISE EXCEPTION 'Read-write RepeatableRead required'; END IF;
 FOR tab IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM public.%I t',tab.tablename) INTO h;
  originals:=originals||jsonb_build_object(tab.tablename,h); table_count:=table_count+1;
 END LOOP;
 IF table_count<>32 THEN RAISE EXCEPTION 'Expected exactly 32 public tables'; END IF;
 audit_hash:=originals->>'package_catalog_audit';
 BEGIN
  INSERT INTO members(phone,full_name,member_code,status,role,points)
   VALUES(substr(md5(owner_token),1,18),marker,'CAT-'||gen_random_uuid(),'PENDING','OWNER',0) RETURNING id INTO owner_id;
  INSERT INTO members(phone,full_name,member_code,status,role,points)
   VALUES(substr(md5(second_token),1,18),marker,'CAT-'||gen_random_uuid(),'PENDING','OWNER',0) RETURNING id INTO second_owner_id;
  INSERT INTO members(phone,full_name,member_code,status,role,points)
   VALUES(substr(md5(member_token),1,18),marker,'CAT-'||gen_random_uuid(),'PENDING','MEMBER',0) RETURNING id INTO member_id;
  INSERT INTO members(phone,full_name,member_code,status,role,points)
   VALUES(substr(md5(admin_token),1,18),marker,'CAT-'||gen_random_uuid(),'PENDING','ADMIN',0) RETURNING id INTO admin_id;
  INSERT INTO auth_sessions(member_id,token_hash,expires_at) VALUES
   (owner_id,owner_token,clock_timestamp()+interval '1 hour'),
   (second_owner_id,second_token,clock_timestamp()+interval '1 hour'),
   (member_id,member_token,clock_timestamp()+interval '1 hour'),
   (admin_id,admin_token,clock_timestamp()+interval '1 hour');
  INSERT INTO auth_sessions(member_id,token_hash,expires_at,mode,device_id)
   VALUES(owner_id,kiosk_token,clock_timestamp()+interval '1 hour','KIOSK','CAT_UAT_STATION');

  SELECT * INTO STRICT original FROM package_catalog WHERE is_active ORDER BY id LIMIT 1;
  r:=package_catalog_action(owner_token,'list',NULL,'{}');
  IF jsonb_array_length(r)<>(SELECT count(*) FROM package_catalog) OR NOT r @> jsonb_build_array(jsonb_build_object('id',original.id,'catalogVersion',original.version)) THEN
   RAISE EXCEPTION 'Pending OWNER list/version capture'; END IF;
  checks:=array_append(checks,'pending_owner_list_current_version');
  payload:=jsonb_build_object('id',original.id,'expectedVersion',original.version,'priceSatang',CASE WHEN original.price_satang=123456 THEN 123457 ELSE 123456 END,'friendCoupons',7,'bonusDays',12);
  r:=package_catalog_action(owner_token,'update',edit_key,payload);
  SELECT * INTO STRICT edited FROM package_catalog WHERE id=original.id;
  IF edited.version<>original.version+1 OR edited.price_satang<>(payload->>'priceSatang')::integer OR edited.friend_quota<>7 OR edited.bonus_days<>12 OR
   NOT r @> jsonb_build_object('version',edited.version,'catalogVersion',edited.version,'priceSatang',edited.price_satang,'friendCoupons',7,'bonusDays',12) THEN
   RAISE EXCEPTION 'Custom update/version'; END IF;
  checks:=array_append(checks,'custom_price_friends7_bonus12_version_increment');
  IF (SELECT count(*) FROM package_catalog_audit WHERE actor_id IN(owner_id,second_owner_id))<>1 OR NOT EXISTS(
   SELECT 1 FROM package_catalog_audit a WHERE a.actor_id=owner_id AND a.request_key=edit_key AND a.payload=payload AND a.before_snapshot=to_jsonb(original) AND a.result=r) THEN
   RAISE EXCEPTION 'Single update audit'; END IF;
  checks:=array_append(checks,'single_audit_before_and_result');
  again:=package_catalog_action(owner_token,'update',edit_key,payload);
  IF again IS DISTINCT FROM r OR (SELECT count(*) FROM package_catalog_audit WHERE actor_id IN(owner_id,second_owner_id))<>1 OR
   (SELECT to_jsonb(c) FROM package_catalog c WHERE id=original.id) IS DISTINCT FROM to_jsonb(edited) THEN RAISE EXCEPTION 'Update replay changed data'; END IF;
  checks:=array_append(checks,'same_uuid_replay_equal_no_extra_audit_or_version');
  denied:=false;
  BEGIN PERFORM package_catalog_action(second_token,'update',gen_random_uuid(),payload);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS caught_message=MESSAGE_TEXT; IF caught_message<>'Stale catalog version' THEN RAISE; END IF; denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Second owner stale accepted'; END IF;
  checks:=array_append(checks,'second_owner_stale_rejected');

  quote:=jsonb_build_object('package',jsonb_build_object('id',original.id,'catalogVersion',edited.version));
  SELECT to_jsonb(o) INTO STRICT order_row FROM create_catalog_package_payment_order(order_id,member_id,member_token,order_key,quote,receiver) o;
  expected_snapshot:=jsonb_build_object('id',edited.id,'name',edited.name,'label',edited.label,'description',edited.description,
   'price',edited.price_satang::numeric/100,'priceSatang',edited.price_satang,'durationDays',edited.duration_days,'timeSlot',edited.time_slot,
   'friendCoupons',7,'bonusDays',12,'isActive',true,'catalogVersion',edited.version,'snapshotVersion',2);
  IF order_row->'package_snapshot' IS DISTINCT FROM expected_snapshot OR NOT order_row @> jsonb_build_object(
   'id',order_id,'member_id',member_id,'request_key',order_key,'status','PENDING','subtotal_satang',edited.price_satang,
   'discount_satang',0,'amount_satang',edited.price_satang,'points_earned',edited.price_satang/2000,'receiver_snapshot',receiver) THEN
   RAISE EXCEPTION 'Authoritative pending quote'; END IF;
  checks:=array_append(checks,'pending_order_exact_authoritative_price_benefit_snapshot');
  denied:=false;
  BEGIN PERFORM create_catalog_package_payment_order(gen_random_uuid(),member_id,member_token,gen_random_uuid(),
   jsonb_build_object('package',jsonb_build_object('id',original.id,'catalogVersion',original.version)),receiver);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS caught_message=MESSAGE_TEXT; IF caught_message<>'Stale catalog version' THEN RAISE; END IF; denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Stale new order accepted'; END IF;
  checks:=array_append(checks,'stale_new_order_rejected_while_active');
  r:=package_catalog_action(owner_token,'update',gen_random_uuid(),jsonb_build_object('id',original.id,'expectedVersion',edited.version,'priceSatang',55555,'friendCoupons',2,'bonusDays',3,'isActive',false));
  IF NOT r @> jsonb_build_object('version',edited.version+1,'priceSatang',55555,'friendCoupons',2,'bonusDays',3,'isActive',false) OR
   EXISTS(SELECT 1 FROM package_catalog_public WHERE id=original.id) THEN RAISE EXCEPTION 'Edit/pause failed'; END IF;
  checks:=array_append(checks,'edit_pause_version_and_public_visibility');
  SELECT to_jsonb(o) INTO STRICT again FROM create_catalog_package_payment_order(gen_random_uuid(),member_id,member_token,order_key,quote,receiver) o;
  IF again IS DISTINCT FROM order_row OR (SELECT count(*) FROM package_payment_orders o WHERE o.member_id=member_id)<>1 THEN
   RAISE EXCEPTION 'Original quote replay after pause changed order'; END IF;
  checks:=array_append(checks,'original_quote_same_order_replay_preserved_after_edit_pause');
  denied:=false;
  BEGIN PERFORM create_catalog_package_payment_order(gen_random_uuid(),member_id,member_token,gen_random_uuid(),quote,receiver);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS caught_message=MESSAGE_TEXT; IF caught_message<>'Package unavailable' THEN RAISE; END IF; denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Paused new order accepted'; END IF;
  checks:=array_append(checks,'paused_new_order_rejected');

  FOR token,role_name IN SELECT * FROM (VALUES(admin_token,'admin'),(member_token,'member'),(kiosk_token,'kiosk')) v(t,n) LOOP
   FOREACH verb IN ARRAY ARRAY['list','update'] LOOP
    denied:=false;
    BEGIN PERFORM package_catalog_action(token,verb,gen_random_uuid(),payload);
    EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
    IF NOT denied THEN RAISE EXCEPTION 'Unauthorized catalog access'; END IF;
    checks:=array_append(checks,role_name||'_'||verb||'_denied');
   END LOOP;
  END LOOP;
  SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY to_jsonb(a)::text)::text,'[]')) INTO old_audit_hash
   FROM package_catalog_audit a WHERE actor_id NOT IN(owner_id,second_owner_id);
  IF old_audit_hash IS DISTINCT FROM audit_hash OR (SELECT count(*) FROM package_catalog_audit WHERE actor_id IN(owner_id,second_owner_id))<>2 THEN
   RAISE EXCEPTION 'Old audit changed or unexpected new audit'; END IF;
  checks:=array_append(checks,'preexisting_audit_hash_unchanged_two_test_edits_only');
  IF EXISTS(SELECT 1 FROM package_payment_orders o WHERE o.member_id=member_id AND o.status<>'PENDING') OR
   EXISTS(SELECT 1 FROM package_payment_attempts a WHERE a.order_id=order_id) OR
   EXISTS(SELECT 1 FROM coupons c WHERE c.member_id IN(owner_id,second_owner_id,member_id,admin_id)) OR
   (SELECT to_jsonb(o) FROM package_payment_orders o WHERE o.id=order_id) IS DISTINCT FROM order_row THEN
   RAISE EXCEPTION 'Unexpected payment/benefit side effect'; END IF;
  checks:=array_append(checks,'pending_only_no_attempts_or_issued_coupons');
  RAISE SQLSTATE 'Z0001' USING MESSAGE='SUCCESS_ROLLBACK_ALL_CATALOG_TEST_ROWS';
 EXCEPTION WHEN SQLSTATE 'Z0001' THEN
  GET STACKED DIAGNOSTICS caught_message=MESSAGE_TEXT;
  IF caught_message<>'SUCCESS_ROLLBACK_ALL_CATALOG_TEST_ROWS' OR cardinality(checks)<>18 THEN RAISE; END IF;
  rolled_back:=true;
 END;
 IF NOT rolled_back THEN RAISE EXCEPTION 'Rollback sentinel not reached'; END IF;
 FOR tab IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM public.%I t',tab.tablename) INTO h;
  IF h IS DISTINCT FROM originals->>tab.tablename THEN RAISE EXCEPTION 'Rollback hash mismatch'; END IF;
 END LOOP;
 PERFORM set_config('blu.uat_result',jsonb_build_object('checksPassed',cardinality(checks),'checks',checks,
  'tableHashesPassed',table_count,'allTablesUnchanged',true,'preexistingAuditUnchanged',true,'rollback','verified',
  'providersCalled',false,'smsCalled',false,'authLoginCalled',false,'existingSessionsTouched',false,'paidOrdersCreated',0)::text,true);
END $uat$`;

async function main() {
 protect();
 const sql=client();
 const result=await sql.transaction([
  sql.query(statement),
  sql.query("SELECT current_setting('blu.uat_result')::jsonb AS result"),
 ],{isolationLevel:'RepeatableRead',readOnly:false});
 const report={...result[1][0].result,limits:[
  'One RepeatableRead connection; sequential second-owner stale check is not a concurrency proof',
  'Only temporary fixture sessions; no login, provider, SMS, PAID transition or benefit issuance',
  'All 32 public table row hashes unchanged after subtransaction rollback; sequences may advance',
 ]};
 if(report.checksPassed!==18 || report.tableHashesPassed!==32 || report.rollback!=='verified') throw new Error('Incomplete UAT');
 save(path.join(local,'package-catalog-live-rollback-'+stamp()+'.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
main().catch(safeFailure);
