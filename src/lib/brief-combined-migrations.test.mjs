// Offline only: installed runtime, synthetic schema/evidence, no env/server/provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
let PGlite;
for (const location of [import.meta.url, new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url)]) {
 try { ({ PGlite } = createRequire(location)('@electric-sql/pglite')); break; }
 catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}

test('combined actual legacy + R3/R4/R5/R6/R7 SQL, serial replay only', { timeout: 120000 }, async () => {
 assert.ok(PGlite, 'Installed offline PGlite required; do not download or skip');
 const db = new PGlite();
 const rows = async (sql, args=[]) => (await db.query(sql,args)).rows;
 const one = async (sql,args=[]) => (await rows(sql,args))[0];
 const apply = async name => { try { await db.exec(read(`../db/migrations/${name}.sql`)); } catch (e) { throw new Error(`Migration ${name}: ${e.message}`, { cause:e }); } };
 const action = async (token,verb,payload,key=randomUUID()) => (await one('SELECT time_supplement_action($1,$2,$3,$4::jsonb) r',[token,verb,key,JSON.stringify(payload)])).r;
 const visit = async (direction,key=randomUUID()) => (await one("SELECT r7_visit_action('combined-2','COMBINED',$1,'BLU-3',$2) r",[key,direction])).r;
 const receiver={promptpay:'0890000000',bankCode:'002',bankAccount:'1234567890',name:'SYNTHETIC'};
 const buy = async (member,version) => {
  const o=await one('SELECT * FROM create_catalog_package_payment_order($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[randomUUID(),member,`combined-${member}`,randomUUID(),JSON.stringify({package:{id:2,catalogVersion:version}}),JSON.stringify(receiver)]);
  const attempt=randomUUID();
  await db.query('SELECT * FROM claim_package_payment_attempt($1,$2,$3,$4,$5,false)',[o.id,member,`combined-${member}`,attempt,'a'.repeat(64)]);
  const proof={transRef:randomUUID(),paidAt:new Date(Date.now()-60000).toISOString(),amountSatang:o.amount_satang,bankCode:'002',receiverEvidence:'REGISTERED_ACCOUNT_V2',providerStrategy:'EASYSLIP_V2_REGISTERED_ACCOUNT',orderId:o.id,receiverIdentity:{matchingType:'BANK_ACCOUNT',bankCode:'002',bankAccount:'1234567890',name:'SYNTHETIC',expectedName:'SYNTHETIC',normalizedName:'SYNTHETIC'}};
  await db.query("UPDATE package_payment_attempts SET state='VERIFIED',evidence=$2::jsonb WHERE id=$1",[attempt,JSON.stringify(proof)]);
  const settle=()=>one('SELECT * FROM finalize_package_payment($1,$2,$3,$4)',[o.id,member,`combined-${member}`,attempt]);
  const paid=await settle(); assert.equal(paid.status,'PAID');
  return { paid, settle };
 };
 const effects = () => rows(`SELECT (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM members m) members,
  (SELECT jsonb_agg(to_jsonb(l) ORDER BY order_id) FROM package_payment_point_ledger l) ledger,
  (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM coupons c) coupons,
  (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM package_payment_orders o) orders`);
 const rollback = async fn => { await db.exec('BEGIN'); try { await fn(); } finally { await db.exec('ROLLBACK'); } };
 try {
  const fixture=read('./package-payment-benefits.test.mjs').match(/await db\.exec\(`([\s\S]*?)`\);/);
  assert.ok(fixture, 'Reviewed base schema fixture must exist'); await db.exec(fixture[1]);
  for (const name of ['20261009_real_package_payments','20261010_payment_promptpay','20261024_kiosk','20261024_real_benefits_admin','20261024_real_rewards','20261024_real_frontdesk','20261024_real_finance','20261025_package_payment_benefits']) await apply(name);
  // Same deployment-security fixture as existing R3/R6/R7 suites, not a live ACL rehearsal.
  await db.exec(`DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature); EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_catalog',f.signature); END LOOP; END $$;`);
  for (const name of ['20261031_payment_receiver_bank','20261031_payment_currency_recheck','20261031_package_catalog','20261031_package_catalog_order_guard']) await apply(name);
  await db.exec(`INSERT INTO members(member_code,full_name,status,role) SELECT 'BLU-'||i,'SYNTHETIC','EXPIRED',CASE WHEN i=1 THEN 'OWNER' WHEN i=2 THEN 'ADMIN' ELSE 'MEMBER' END FROM generate_series(1,5) i;
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'combined-'||id,now()+interval '1 day' FROM members;
   INSERT INTO checkins(member_id,scanner_type,points_awarded,notes) VALUES(4,'HARDWARE_USB',0,'legacy unknown exit');`);
  const legacy=await buy(4,1), before=await effects();
  for (const name of ['20261118_r3_package_catalog','20261118_r3_package_catalog_checkin','20261118_R4_online_provenance','20261118_R5_finance','20261118_R6_time_supplement','20261118_R7_visits']) await apply(name);
  assert.deepEqual(await effects(),before);
  assert.equal((await one('SELECT count(*)::int n FROM entitlement_online_observations')).n,0);
  await legacy.settle(); assert.deepEqual(await effects(),before);
  const local=(await one("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::time::text t")).t;
  const offSlot=local<'12:00:00'?'12:00-12:01':'00:00-00:01';
  await db.query("SELECT package_catalog_action('combined-1','update',$1,$2::jsonb)",[randomUUID(),JSON.stringify({id:2,expectedVersion:1,timeSlot:offSlot})]);
  const fresh=await buy(3,2), paid=fresh.paid;
  const settled=await effects(); await fresh.settle(); assert.deepEqual(await effects(),settled);
  const observation=await one('SELECT * FROM entitlement_online_observations WHERE order_id=$1',[paid.id]);
  assert.deepEqual(observation.package_snapshot,paid.package_snapshot);
  assert.equal(observation.point_ledger_order_id,paid.id);
  const ledger=await one('SELECT * FROM package_payment_point_ledger WHERE order_id=$1',[paid.id]);
  assert.equal(observation.points_delta,ledger.delta); assert.equal(observation.points_balance_after,ledger.balance_after);
  assert.equal(observation.confirmed_at.getTime(),paid.confirmed_at.getTime());
  for (const sql of ["UPDATE package_payment_orders SET package_snapshot='{}' WHERE status='PAID'",'UPDATE entitlement_online_observations SET points_delta=0','DELETE FROM entitlement_online_observations','TRUNCATE entitlement_online_observations']) await assert.rejects(db.exec(sql),/immutable|append-only/i);
  await db.query("SELECT package_catalog_action('combined-1','update',$1,$2::jsonb)",[randomUUID(),JSON.stringify({id:2,expectedVersion:2,timeSlot:'00:00-24:00'})]);
  assert.deepEqual((await one('SELECT package_snapshot FROM package_payment_orders WHERE id=$1',[paid.id])).package_snapshot,observation.package_snapshot);
  const finance=(await one("SELECT real_finance_action('combined-1','read',NULL,'{}') r")).r;
  assert.equal(finance.records.length,2); assert.equal(finance.unconfirmedPaidCount,0);
  const income=finance.records.find(r=>r.id===`package:${paid.id}`);
  assert.equal(income.amount,paid.amount_satang/100);
  assert.equal(income.date,(await one("SELECT (confirmed_at AT TIME ZONE 'Asia/Bangkok')::date::text d FROM package_payment_orders WHERE id=$1",[paid.id])).d);
  assert.notEqual(paid.confirmed_at.getTime(),paid.paid_at.getTime());
  const grantPayload={memberCode:'BLU-3',title:'Combined supplement',timeSlot:'00:00-24:00',reason:'Offline integration'};
  await assert.rejects(action('combined-3','grant',grantPayload),/Staff required/);
  await assert.rejects(action('combined-2','grant',{...grantPayload,price:0}),/Invalid grant/);
  await assert.rejects(action('combined-2','grant',{...grantPayload,memberCode:'BLU-5'}),/Proven active/);
  await rollback(async()=>{await db.exec("UPDATE members SET expire_date=expire_date+interval '1 day' WHERE id=3"); await assert.rejects(action('combined-2','grant',grantPayload),/Proven active/);});
  assert.equal((await visit('IN')).reason,'OFF_PEAK');
  const key=randomUUID(), grant=await action('combined-2','grant',grantPayload,key);
  assert.deepEqual(await action('combined-2','grant',grantPayload,key),grant);
  await assert.rejects(action('combined-2','grant',{...grantPayload,title:'changed'},key),/Request key reused/);
  await assert.rejects(action('combined-3','activate',{couponId:grant.couponId,at:'2020-01-01'}),/Invalid activation/);
  const activationKey=randomUUID(), activation=await action('combined-3','activate',{couponId:grant.couponId},activationKey);
  assert.deepEqual(await action('combined-3','activate',{couponId:grant.couponId},activationKey),activation);
  assert.deepEqual(await action('combined-3','activate',{couponId:grant.couponId}),activation);
  const entryKey=randomUUID(), entry=await visit('IN',entryKey); assert.equal(entry.ok,true);
  assert.deepEqual(await visit('IN',entryKey),entry); assert.equal((await visit('IN')).reason,'ALREADY_IN');
  const snapshot=(await one('SELECT snapshot FROM r7_visits WHERE id=$1',[entry.visitId])).snapshot;
  assert.deepEqual(snapshot.package,observation.package_snapshot); assert.equal(snapshot.mainTimeSlot,offSlot);
  assert.equal(snapshot.usedTimeSlot,'00:00-24:00'); assert.equal(snapshot.supplement.couponId,grant.couponId);
  const exitKey=randomUUID(), exit=await visit('OUT',exitKey); assert.equal(exit.ok,true);
  assert.deepEqual(await visit('OUT',exitKey),exit); assert.equal((await visit('OUT')).reason,'NO_OPEN_VISIT');
  await assert.rejects(db.exec("UPDATE r7_visits SET snapshot='{}'"),/Only first paired exit/);
  assert.equal((await one('SELECT count(*)::int n FROM r7_visits WHERE exited_at>=entered_at')).n,1);
  assert.equal((await one('SELECT count(*)::int n FROM checkins c LEFT JOIN r7_visits v ON v.checkin_id=c.id WHERE v.id IS NULL')).n,1);
  assert.equal((await one('SELECT used_count FROM coupons WHERE id=$1',[grant.couponId])).used_count,1);
  assert.equal((await one('SELECT count(*)::int n FROM time_supplement_activations')).n,1);
  assert.equal((await one('SELECT count(*)::int n FROM entitlement_online_observations')).n,1);

  // Compare JSON snapshots so timestamp serialization is identical to effects().
  const after=await effects();
  for (const field of ['members','ledger','orders']) assert.deepEqual(after[0][field],settled[0][field]);
  assert.deepEqual(after[0].coupons.filter(c=>c.type!=='CUSTOM'),settled[0].coupons);
  for (const table of ['time_supplement_grants','time_supplement_activations','time_supplement_requests','r7_visit_requests']) {
   await assert.rejects(db.exec(`DELETE FROM ${table}`),/append-only/);
   await assert.rejects(db.exec(`TRUNCATE ${table} CASCADE`),/append-only/);
  }
  // Fail the R4 hook during real settlement: every other module must roll back too.
  const atomicBefore=await effects();
  await db.exec("CREATE FUNCTION combined_fail_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'combined observation failure'; END $$; CREATE TRIGGER combined_fail_observation BEFORE INSERT ON entitlement_online_observations FOR EACH ROW EXECUTE FUNCTION combined_fail_observation();");
  await assert.rejects(buy(5,3),/combined observation failure/);
  await db.exec('DROP TRIGGER combined_fail_observation ON entitlement_online_observations');
  const atomicAfter=await effects();
  for (const field of ['members','ledger','coupons']) assert.deepEqual(atomicAfter[0][field],atomicBefore[0][field]);
  assert.equal((await one("SELECT count(*)::int n FROM package_payment_orders WHERE member_id=5 AND status='PAID'")).n,0);
  assert.equal((await one('SELECT count(*)::int n FROM entitlement_online_observations')).n,1);
  await rollback(async()=>{await buy(3,3); assert.equal((await one('SELECT time_supplement_allows(3,clock_timestamp()) ok')).ok,false); await assert.rejects(action('combined-2','grant',grantPayload),/Proven active/);});
 } finally { await db.close(); }
});
