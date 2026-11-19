// Offline in-memory PostgreSQL: no env loading, sockets or provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { Module } from 'node:module';
import ts from 'typescript';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); }
catch (e) {
 if (e.code !== 'MODULE_NOT_FOUND') throw e;
 ({ PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite'));
}
test('R7 isolated SQL chain preserves R3/R6 and pairs visits atomically', { timeout: 120000 }, async () => {
 const db = new PGlite();
 const rows = async (sql, args=[]) => (await db.query(sql,args)).rows;
 const one = async (sql,args=[]) => (await rows(sql,args))[0];
 const action = async (direction='IN',key=randomUUID(),token='r7-2',code='BLU-3') => (await one('SELECT r7_visit_action($1,$2,$3,$4,$5) AS r',[token,'R7-DESK',key,code,direction])).r;
 try {
  const fixture=read('./package-payment-benefits.test.mjs').match(/await db\.exec\(`([\s\S]*?)`\);/);
  assert.ok(fixture); await db.exec(fixture[1]);
  for (const name of ['20261009_real_package_payments','20261010_payment_promptpay','20261024_kiosk','20261024_real_benefits_admin','20261024_real_rewards','20261024_real_frontdesk','20261024_real_finance','20261025_package_payment_benefits']) await db.exec(read(`../db/migrations/${name}.sql`));
  await db.exec(`DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature); EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_catalog',f.signature); END LOOP; END $$;`);
  for (const name of ['20261031_payment_receiver_bank','20261031_payment_currency_recheck','20261031_package_catalog','20261031_package_catalog_order_guard','20261118_r3_package_catalog','20261118_r3_package_catalog_checkin','20261118_R6_time_supplement']) await db.exec(read(`../db/migrations/${name}.sql`));
  const before=await rows("SELECT pg_get_functiondef(oid) AS body FROM pg_proc WHERE proname IN ('kiosk_checkin','real_frontdesk_checkin') ORDER BY proname");
  await db.exec(read('../db/migrations/20261118_R7_visits.sql'));
  // The route uses the R2 card dispatcher, which delegates paired visits to installed R7.
  await db.exec(read('../db/migrations/20261118_R2_member_cards.sql'));
  assert.deepEqual(await rows("SELECT pg_get_functiondef(oid) AS body FROM pg_proc WHERE proname IN ('kiosk_checkin','real_frontdesk_checkin') ORDER BY proname"),before);
  await db.exec(`INSERT INTO members(member_code,full_name,status,role) SELECT 'BLU-'||i,'SYNTHETIC','EXPIRED',CASE WHEN i=1 THEN 'OWNER' WHEN i=2 THEN 'ADMIN' ELSE 'MEMBER' END FROM generate_series(1,4) i;
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'r7-'||id,now()+interval '1 day' FROM members;
   INSERT INTO checkins(member_id,scanner_type,points_awarded,notes) VALUES(3,'HARDWARE_USB',0,'legacy entry');`);
  assert.equal((await action('OUT')).reason,'NO_OPEN_VISIT');
  assert.equal((await one('SELECT count(*)::int n FROM r7_visits')).n,0);
  await assert.rejects(action('IN',randomUUID(),'r7-3'),/Normal staff/);
  assert.ok(['NO_ENTITLEMENT','CLOSED'].includes((await action()).reason));
  // Buy a real all-day synthetic package through the installed catalog chain.
  await db.query("SELECT package_catalog_action('r7-1','update',$1,$2::jsonb)",[randomUUID(),JSON.stringify({id:1,expectedVersion:1,timeSlot:'00:00-24:00'})]);
  const receiver={promptpay:'0890000000',bankCode:'002',bankAccount:'1234567890',name:'SYNTHETIC'};
  const payment=await one('SELECT * FROM create_catalog_package_payment_order($1,3,$2,$3,$4::jsonb,$5::jsonb)',[randomUUID(),'r7-3',randomUUID(),JSON.stringify({package:{id:1,catalogVersion:2}}),JSON.stringify(receiver)]);
  const attempt=randomUUID();
  await db.query('SELECT * FROM claim_package_payment_attempt($1,3,$2,$3,$4,false)',[payment.id,'r7-3',attempt,'a'.repeat(64)]);
  const evidence={transRef:randomUUID(),paidAt:new Date().toISOString(),amountSatang:payment.amount_satang,bankCode:'002',receiverEvidence:'REGISTERED_ACCOUNT_V2',providerStrategy:'EASYSLIP_V2_REGISTERED_ACCOUNT',orderId:payment.id,receiverIdentity:{matchingType:'BANK_ACCOUNT',bankCode:'002',bankAccount:'1234567890',name:'SYNTHETIC',expectedName:'SYNTHETIC',normalizedName:'SYNTHETIC'}};
  await db.query("UPDATE package_payment_attempts SET state='VERIFIED',evidence=$2::jsonb WHERE id=$1",[attempt,JSON.stringify(evidence)]);
  await db.query('SELECT * FROM finalize_package_payment($1,3,$2,$3)',[payment.id,'r7-3',attempt]);
  const balances=await rows('SELECT id,points,expire_date FROM members ORDER BY id');
  const key=randomUUID(), entry=await action('IN',key);
  assert.equal(entry.ok,true); assert.deepEqual(await action('IN',key),entry);
  await assert.rejects(action('OUT',key),/Request key reused/);
  assert.equal((await action()).reason,'ALREADY_IN');
  const snapshot=(await one('SELECT snapshot FROM r7_visits')).snapshot;
  assert.deepEqual(snapshot.package,(await one('SELECT package_snapshot FROM package_payment_orders WHERE id=$1',[payment.id])).package_snapshot);
  // Exit must not require a currently valid membership.
  await db.exec("UPDATE members SET status='EXPIRED' WHERE id=3");
  const outKey=randomUUID(), exit=await action('OUT',outKey);
  assert.equal(exit.ok,true); assert.deepEqual(await action('OUT',outKey),exit);
  assert.equal((await action('OUT')).reason,'NO_OPEN_VISIT');
  assert.equal((await one('SELECT exited_at>=entered_at AS ok FROM r7_visits')).ok,true);
  assert.deepEqual((await one('SELECT snapshot FROM r7_visits')).snapshot,snapshot);
  assert.deepEqual(await rows('SELECT id,points,expire_date FROM members ORDER BY id'),balances);
  assert.equal((await one('SELECT count(*)::int n FROM checkins c LEFT JOIN r7_visits v ON v.checkin_id=c.id WHERE v.id IS NULL')).n,1);
  // Failure after entitlement checkin rolls back all checkin/visit/request writes.
  await db.exec("UPDATE members SET status='ACTIVE' WHERE id=3; DELETE FROM kiosk_member_bounce; CREATE FUNCTION r7_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$; CREATE TRIGGER r7_fail BEFORE INSERT ON r7_visits FOR EACH ROW EXECUTE FUNCTION r7_fail();");
  const count=await one('SELECT count(*)::int n FROM checkins');
  const retryKey=randomUUID(); await assert.rejects(action('IN',retryKey),/injected failure/);
  assert.deepEqual(await one('SELECT count(*)::int n FROM checkins'),count);
  await db.exec('DROP TRIGGER r7_fail ON r7_visits');
  assert.equal((await action('IN',retryKey)).ok,true);
  assert.equal((await action('OUT')).ok,true);
  await assert.rejects(db.exec("UPDATE r7_visits SET snapshot='{}'"),/Only first paired exit/);
  await assert.rejects(db.exec('DELETE FROM r7_visit_requests'),/append-only/);
  // Supplement entry with actual unmodified R3/R6 functions and a fresh binding.
  const local=(await one("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::time::text t")).t;
  const offSlot=local<'12:00:00'?'12:00-12:01':'00:00-00:01';
  await db.exec('ALTER TABLE package_payment_orders DISABLE TRIGGER USER; DELETE FROM kiosk_member_bounce');
  await db.query("UPDATE package_payment_orders SET package_snapshot=jsonb_set(package_snapshot,'{timeSlot}',to_jsonb($1::text)) WHERE id=$2",[offSlot,payment.id]);
  await db.exec('ALTER TABLE package_payment_orders ENABLE TRIGGER USER');
  assert.equal((await action()).reason,'OFF_PEAK');
  const grant=(await one("SELECT time_supplement_action('r7-2','grant',$1,$2::jsonb) r",[randomUUID(),JSON.stringify({memberCode:'BLU-3',title:'Synthetic supplement',timeSlot:'00:00-24:00',reason:'R7 test'})])).r;
  await db.query("SELECT time_supplement_action('r7-3','activate',$1,$2::jsonb)",[randomUUID(),JSON.stringify({couponId:grant.couponId})]);
  assert.equal((await action()).ok,true);
  const supplement=(await one('SELECT snapshot FROM r7_visits ORDER BY id DESC LIMIT 1')).snapshot;
  assert.equal(supplement.mainTimeSlot,offSlot); assert.equal(supplement.usedTimeSlot,'00:00-24:00'); assert.equal(supplement.supplement.couponId,grant.couponId);
  assert.equal((await action('OUT')).ok,true);
  // Route-facing server -> actual SQL -> history response, entirely in memory.
  const cookie='a'.repeat(64), session=createHash('sha256').update(cookie).digest('hex');
  await db.query('UPDATE auth_sessions SET token_hash=$1 WHERE member_id=2',[session]);
  const filename=new URL('./real-checkin-server.ts',import.meta.url).pathname;
  const loaded=new Module(filename); loaded.filename=filename;
  loaded.require=name=>{
   if(name==='server-only') return {};
   if(name==='next/headers') return {cookies:async()=>({get:()=>({value:cookie})})};
   if(name==='@neondatabase/serverless') return {neon:()=>async(parts,...values)=>rows(parts.reduce((text,part,i)=>text+(i?'$'+i:'')+part,''),values)};
   if(name==='./auth/server') return {SESSION_COOKIE:'session',getCurrentMember:async()=>({role:'ADMIN'})};
   if(name==='./auth/http') return {readBody:async r=>r.json(),json:(body,status=200)=>({body,status})};
   return require(name);
  };
  loaded._compile(ts.transpileModule(read('./real-checkin-server.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  const env=process.env.DATABASE_URL; process.env.DATABASE_URL='IN_MEMORY_ONLY';
  const api=async(action,body)=>loaded.exports.realCheckinAction(new Request('http://offline.invalid/api/admin/checkin/'+action,{method:'POST',body:JSON.stringify(body)}),action);
  try {
   const requestKey=randomUUID(); await db.exec('DELETE FROM kiosk_member_bounce');
   const response=await api('scan',{code:'BLU-3',direction:'IN',requestKey});
   assert.equal(response.body.ok,true);
      assert.deepEqual((await api('scan',{code:'BLU-3',direction:'IN',requestKey})).body,response.body);
      assert.equal((await api('scan',{code:'BLU-3',direction:'OUT',requestKey:randomUUID()})).body.ok,true);
      await db.exec("INSERT INTO checkins(member_id,scanner_type,points_awarded,notes) SELECT 4,'HARDWARE_USB',0,'legacy' FROM generate_series(1,55)");
      const history=await api('history',{query:'BLU-4',page:1});
      assert.equal(history.status,200); assert.equal(history.body.records.length,50); assert.equal(history.body.hasMore,true);
      assert.equal(history.body.hourly.length,24);
      assert.equal(history.body.hourly.reduce((n,h)=>n+Number(h.entries),0),55);
      assert.equal((await api('history',{query:'BLU-4',page:2})).body.records.length,5);
      const filtered=await api('history',{query:'BLU-4',from:'2000-01-01T00:00:00+07:00',to:'2000-01-02T00:00:00+07:00'});
      assert.equal(filtered.body.records.length,0); assert.equal(filtered.body.hourly.every(h=>Number(h.entries)===0),true);
      await db.exec('UPDATE auth_sessions SET revoked_at=now() WHERE member_id=2');
      assert.equal((await api('history',{query:'',page:1})).body.records.length,0);
     } finally { if(env===undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL=env; }
    } finally { await db.close(); }
});
