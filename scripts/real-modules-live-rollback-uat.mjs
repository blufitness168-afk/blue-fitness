// Real installed functions and real schema; ALL test rows roll back in a PL/pgSQL subtransaction.
import { client, protect, local, save, stamp, safeFailure } from './db-safety.mjs';
import path from 'node:path';
const statement = `DO $uat$
#variable_conflict use_variable
DECLARE owner_id integer; staff_id integer; member_id integer; other_id integer;
 owner_token text:=repeat(md5(gen_random_uuid()::text),2); staff_token text:=repeat(md5(gen_random_uuid()::text),2);
 member_token text:=repeat(md5(gen_random_uuid()::text),2); other_token text:=repeat(md5(gen_random_uuid()::text),2);
 marker text:='ROLLBACK_UAT_'||gen_random_uuid(); k uuid; k2 uuid; r jsonb; again jsonb; grant_row jsonb; definition jsonb;
 rid integer; cid integer; before_expiry timestamptz; denied boolean; checks integer:=0; hours_open boolean;
 originals jsonb:='{}'::jsonb; after_hash text; tab record; snapshot_hash text; scan_result jsonb;
BEGIN
 PERFORM set_config('lock_timeout','4s',true); PERFORM set_config('statement_timeout','45s',true);
 FOR tab IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
   EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM public.%I t',tab.tablename) INTO snapshot_hash;
   originals:=originals||jsonb_build_object(tab.tablename,snapshot_hash);
 END LOOP;
 BEGIN
  INSERT INTO members(phone,full_name,member_code,status,role,points) VALUES(left(owner_token,18),marker,'TEMP-'||gen_random_uuid(),'PENDING','OWNER',0) RETURNING id INTO owner_id;
  INSERT INTO members(phone,full_name,member_code,status,role,points) VALUES(left(staff_token,18),marker,'TEMP-'||gen_random_uuid(),'PENDING','ADMIN',0) RETURNING id INTO staff_id;
  INSERT INTO members(phone,full_name,member_code,status,role,points,expire_date) VALUES(left(member_token,18),marker,'TEMP-'||gen_random_uuid(),'ACTIVE','MEMBER',100,clock_timestamp()+interval '2 days') RETURNING id,expire_date INTO member_id,before_expiry;
  INSERT INTO members(phone,full_name,member_code,status,role,points) VALUES(left(other_token,18),marker,'TEMP-'||gen_random_uuid(),'PENDING','MEMBER',0) RETURNING id INTO other_id;
  INSERT INTO auth_sessions(member_id,token_hash,expires_at) VALUES(owner_id,owner_token,clock_timestamp()+interval '1 hour'),(staff_id,staff_token,clock_timestamp()+interval '1 hour'),(member_id,member_token,clock_timestamp()+interval '1 hour'),(other_id,other_token,clock_timestamp()+interval '1 hour');

  k:=gen_random_uuid(); r:=real_rewards_action(staff_token,'save',k,jsonb_build_object('title',marker,'description',NULL,'imageUrl',NULL,'pointCost',30,'stock',1,'isActive',true)); rid:=(r->>'id')::integer;
  IF real_rewards_action(staff_token,'save',k,jsonb_build_object('title',marker,'description',NULL,'imageUrl',NULL,'pointCost',30,'stock',1,'isActive',true))<>r THEN RAISE EXCEPTION 'Reward create replay'; END IF; checks:=checks+1;
  k:=gen_random_uuid(); r:=real_rewards_action(member_token,'redeem',k,jsonb_build_object('rewardId',rid)); again:=real_rewards_action(member_token,'redeem',k,jsonb_build_object('rewardId',rid));
  IF r<>again OR (SELECT points FROM members WHERE id=member_id)<>70 OR (SELECT stock FROM rewards WHERE id=rid)<>0 OR (SELECT count(*) FROM reward_point_spend_ledger l WHERE l.member_id=member_id AND redemption_id=(r->>'id')::integer)<>1 THEN RAISE EXCEPTION 'Reward atomic debit/replay'; END IF; checks:=checks+1;
  denied:=false; BEGIN PERFORM real_rewards_action(member_token,'redeem',gen_random_uuid(),jsonb_build_object('rewardId',rid)); EXCEPTION WHEN SQLSTATE 'P0001' THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Stock overspent'; END IF; checks:=checks+1;
  denied:=false; BEGIN PERFORM real_rewards_action(member_token,'redeem',k,jsonb_build_object('rewardId',rid+1)); EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Reward key payload mismatch accepted'; END IF; checks:=checks+1;
  k2:=gen_random_uuid(); again:=real_rewards_action(staff_token,'deliver',k2,jsonb_build_object('rewardCode',r->>'rewardCode'));
  IF again->>'status'<>'COMPLETED' OR real_rewards_action(staff_token,'deliver',k2,jsonb_build_object('rewardCode',r->>'rewardCode'))<>again THEN RAISE EXCEPTION 'Delivery replay'; END IF; checks:=checks+1;
  denied:=false; BEGIN PERFORM real_rewards_action(other_token,'admin',NULL,'{}'); EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Member reward administration'; END IF; checks:=checks+1;

  k:=gen_random_uuid(); definition:=jsonb_build_object('date',current_date::text,'type','EXPENSE','category','อุปกรณ์','amountSatang',12345,'note',marker);
  r:=real_finance_action(owner_token,'create',k,definition);
  IF real_finance_action(owner_token,'create',k,definition)<>r OR (SELECT count(*) FROM finance_audit WHERE actor_id=owner_id)<>1 THEN RAISE EXCEPTION 'Finance create replay'; END IF; checks:=checks+1;
  definition:=definition||jsonb_build_object('id',r->>'id','version',1,'amountSatang',20000);
  again:=real_finance_action(owner_token,'update',gen_random_uuid(),definition);
  IF (again->>'version')::integer<>2 THEN RAISE EXCEPTION 'Finance update version'; END IF; checks:=checks+1;
  denied:=false; BEGIN PERFORM real_finance_action(owner_token,'update',gen_random_uuid(),definition); EXCEPTION WHEN SQLSTATE 'P0001' THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Stale finance overwrite'; END IF; checks:=checks+1;
  k:=gen_random_uuid(); definition:=jsonb_build_object('id',r->>'id','version',2,'reason',marker); again:=real_finance_action(owner_token,'delete',k,definition);
  IF real_finance_action(owner_token,'delete',k,definition)<>again OR NOT EXISTS(SELECT 1 FROM finance_entries WHERE id=(r->>'id')::uuid AND deleted_at IS NOT NULL AND version=3) OR (SELECT count(*) FROM finance_audit WHERE actor_id=owner_id)<>3 THEN RAISE EXCEPTION 'Finance cancellation/audit'; END IF; checks:=checks+1;
  denied:=false; BEGIN PERFORM real_finance_action(staff_token,'read',NULL,'{}'); EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Staff finance exposure'; END IF; checks:=checks+1;

  definition:=real_benefits_admin_action(staff_token,'create',gen_random_uuid(),jsonb_build_object('kind','COUPON','title',marker,'couponType','FRIEND_PASS','quota',1,'bonusDays',0,'expiresAt',clock_timestamp()+interval '1 day'));
  k:=gen_random_uuid(); r:=jsonb_build_object('definitionId',definition->'id','memberCode',(SELECT member_code FROM members WHERE id=member_id));
  grant_row:=real_benefits_admin_action(staff_token,'grant',k,r); cid:=(grant_row->>'coupon_id')::integer;
  IF real_benefits_admin_action(staff_token,'grant',k,r)<>grant_row THEN RAISE EXCEPTION 'Coupon grant replay'; END IF; checks:=checks+1;
  denied:=false; BEGIN PERFORM real_benefits_admin_action(staff_token,'consume',gen_random_uuid(),jsonb_build_object('couponId',cid,'guestReference','')); EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Missing guest reference allowed'; END IF; checks:=checks+1;
  k:=gen_random_uuid(); r:=jsonb_build_object('couponId',cid,'guestReference',marker); again:=real_benefits_admin_action(staff_token,'consume',k,r);
  IF real_benefits_admin_action(staff_token,'consume',k,r)<>again OR (SELECT used_count FROM coupons WHERE id=cid)<>1 OR (SELECT count(*) FROM benefit_consumptions WHERE coupon_id=cid)<>1 THEN RAISE EXCEPTION 'Friend consume replay'; END IF; checks:=checks+1;
  denied:=false; BEGIN PERFORM real_benefits_admin_action(staff_token,'consume',gen_random_uuid(),r); EXCEPTION WHEN SQLSTATE 'P0001' THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Friend coupon over quota'; END IF; checks:=checks+1;
  denied:=false; BEGIN DELETE FROM benefit_consumptions WHERE coupon_id=cid; EXCEPTION WHEN SQLSTATE 'P0001' THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Consumption audit deletable'; END IF; checks:=checks+1;
  definition:=real_benefits_admin_action(staff_token,'create',gen_random_uuid(),jsonb_build_object('kind','COUPON','title',marker,'couponType','EXTRA_DAYS','quota',1,'bonusDays',5,'expiresAt',clock_timestamp()+interval '1 day'));
  grant_row:=real_benefits_admin_action(staff_token,'grant',gen_random_uuid(),jsonb_build_object('definitionId',definition->'id','memberCode',(SELECT member_code FROM members WHERE id=member_id)));
  k:=gen_random_uuid(); r:=jsonb_build_object('couponId',grant_row->'coupon_id','guestReference',''); again:=real_benefits_admin_action(staff_token,'consume',k,r);
  IF real_benefits_admin_action(staff_token,'consume',k,r)<>again OR (SELECT expire_date FROM members WHERE id=member_id)<>before_expiry+interval '5 days' THEN RAISE EXCEPTION 'Bonus extension duplicated'; END IF; checks:=checks+1;
  definition:=real_benefits_admin_action(staff_token,'create',gen_random_uuid(),jsonb_build_object('kind','COUPON','title',marker,'couponType','FRIEND_PASS','quota',1,'bonusDays',0,'expiresAt',clock_timestamp()+interval '1 day'));
  grant_row:=real_benefits_admin_action(staff_token,'grant',gen_random_uuid(),jsonb_build_object('definitionId',definition->'id','memberCode',(SELECT member_code FROM members WHERE id=other_id)));
  PERFORM real_benefits_admin_action(staff_token,'cancel',gen_random_uuid(),jsonb_build_object('assignmentId',grant_row->'id'));
  IF (SELECT status FROM coupons WHERE id=(grant_row->>'coupon_id')::integer)<>'EXPIRED' THEN RAISE EXCEPTION 'Coupon cancellation'; END IF; checks:=checks+1;
  PERFORM real_benefits_admin_action(staff_token,'deactivate',gen_random_uuid(),jsonb_build_object('definitionId',definition->'id'));
  denied:=false; BEGIN PERFORM real_benefits_admin_action(staff_token,'grant',gen_random_uuid(),jsonb_build_object('definitionId',definition->'id','memberCode',(SELECT member_code FROM members WHERE id=owner_id))); EXCEPTION WHEN SQLSTATE 'P0001' THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Inactive definition grants'; END IF; checks:=checks+1;

  UPDATE auth_sessions SET mode='KIOSK',device_id='ROLLBACK_STATION' WHERE token_hash=staff_token;
  denied:=false; BEGIN PERFORM real_rewards_action(staff_token,'admin',NULL,'{}'); EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Kiosk normal rewards access'; END IF; checks:=checks+1;
  denied:=false; BEGIN PERFORM real_benefits_admin_action(staff_token,'list',NULL,'{}'); EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Kiosk normal benefits access'; END IF; checks:=checks+1;
  UPDATE auth_sessions SET mode='NORMAL',device_id=NULL WHERE token_hash=staff_token;
  UPDATE members SET status='SUSPENDED' WHERE id=member_id;
  denied:=false; BEGIN PERFORM real_rewards_action(member_token,'member',NULL,'{}'); EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Suspended rewards access'; END IF; checks:=checks+1;
  UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE token_hash=owner_token;
  denied:=false; BEGIN PERFORM real_finance_action(owner_token,'read',NULL,'{}'); EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Revoked finance session'; END IF; checks:=checks+1;
  RAISE SQLSTATE 'Z0001' USING MESSAGE='SUCCESS_ROLLBACK_ALL_TEST_ROWS';
 EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
 END;
 FOR tab IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
   EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM public.%I t',tab.tablename) INTO after_hash;
   IF after_hash IS DISTINCT FROM originals->>tab.tablename THEN RAISE EXCEPTION 'UAT left data in table %',tab.tablename; END IF;
 END LOOP;
 PERFORM set_config('blu.uat_result',jsonb_build_object('checks',checks,'allTablesUnchanged',true,'rollback','verified','providersCalled',false)::text,true);
END $uat$`;
async function main(){
 protect(); const sql=client();
 const r=await sql.transaction([sql.query(statement),sql.query("SELECT current_setting('blu.uat_result')::jsonb AS result")],{isolationLevel:'RepeatableRead'});
 const report={...r[1][0].result,limits:['Real installed schema/functions in one connection; not a concurrency proof','Temporary test points/expiry exist only in rollback subtransaction, no PAID orders or real transfers','Sequences may advance; every public table row verified unchanged']};
 save(path.join(local,'real-modules-live-rollback-'+stamp()+'.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
}
main().catch(safeFailure);
