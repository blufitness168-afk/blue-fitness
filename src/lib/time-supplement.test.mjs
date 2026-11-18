// Offline, synthetic in-memory SQL only. No env loading, network or providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); }
catch (e) {
 if (e.code !== 'MODULE_NOT_FOUND') throw e;
 ({ PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite'));
}
test('R6 actual SQL: standalone main, one-shot grants, retry, windows and R3 checkin integration', { timeout: 120000 }, async () => {
 const db = new PGlite();
 const rows = async (sql,args=[]) => (await db.query(sql,args)).rows;
 const one = async (sql,args=[]) => (await rows(sql,args))[0];
 const action = async (token,verb,payload,key=randomUUID()) => (await one('SELECT time_supplement_action($1,$2,$3,$4::jsonb) AS r',[token,verb,key,JSON.stringify(payload)])).r;
 const rollback = async fn => { await db.exec('BEGIN'); try { await fn(); } finally { await db.exec('ROLLBACK'); } };
 try {
  const fixture=read('./package-payment-benefits.test.mjs').match(/await db\.exec\(`([\s\S]*?)`\);/);
  assert.ok(fixture); await db.exec(fixture[1]);
  for (const name of ['20261009_real_package_payments','20261010_payment_promptpay','20261024_kiosk',
   '20261024_real_benefits_admin','20261024_real_rewards','20261024_real_frontdesk','20261024_real_finance','20261025_package_payment_benefits'])
   await db.exec(read(`../db/migrations/${name}.sql`));
  await db.exec(`DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature); EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_catalog',f.signature); END LOOP; END $$;`);
  for (const name of ['20261031_payment_receiver_bank','20261031_payment_currency_recheck','20261031_package_catalog','20261031_package_catalog_order_guard',
   '20261118_r3_package_catalog','20261118_r3_package_catalog_checkin']) await db.exec(read(`../db/migrations/${name}.sql`));
  await db.exec(`INSERT INTO members(member_code,full_name,status,role)
   SELECT 'TS-'||i,'SYNTHETIC','EXPIRED',CASE WHEN i=1 THEN 'OWNER' WHEN i=2 THEN 'ADMIN' ELSE 'MEMBER' END FROM generate_series(1,7) i;
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'ts-'||id,now()+interval '1 day' FROM members;`);
  const receiver={promptpay:'0890000000',bankCode:'002',bankAccount:'1234567890',name:'SYNTHETIC'};
  const buy=async member => {
   const payment=await one('SELECT * FROM create_catalog_package_payment_order($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
    [randomUUID(),member,`ts-${member}`,randomUUID(),JSON.stringify({package:{id:1,catalogVersion:1}}),JSON.stringify(receiver)]);
   const attempt=randomUUID();
   await db.query('SELECT * FROM claim_package_payment_attempt($1,$2,$3,$4,$5,false)',[payment.id,member,`ts-${member}`,attempt,'a'.repeat(64)]);
   const evidence={transRef:randomUUID(),paidAt:new Date().toISOString(),amountSatang:payment.amount_satang,
    bankCode:'002',receiverEvidence:'REGISTERED_ACCOUNT_V2',providerStrategy:'EASYSLIP_V2_REGISTERED_ACCOUNT',orderId:payment.id,
    receiverIdentity:{matchingType:'BANK_ACCOUNT',bankCode:'002',bankAccount:'1234567890',name:'SYNTHETIC',expectedName:'SYNTHETIC',normalizedName:'SYNTHETIC'}};
   await db.query("UPDATE package_payment_attempts SET state='VERIFIED',evidence=$2::jsonb WHERE id=$1",[attempt,JSON.stringify(evidence)]);
   return one('SELECT * FROM finalize_package_payment($1,$2,$3,$4)',[payment.id,member,`ts-${member}`,attempt]);
  };
  const paid=await buy(3); await buy(4); await buy(5); await buy(5);
  // Catalog edits cannot change the paid snapshot used by the main/checkin reader.
  await db.query("SELECT package_catalog_action('ts-1','update',$1,$2::jsonb)",[randomUUID(),JSON.stringify({id:1,expectedVersion:1,timeSlot:'00:00-24:00'})]);
  const before=await rows('SELECT * FROM package_payment_orders ORDER BY id');
  const membersBefore=await rows('SELECT * FROM members ORDER BY id');
  const migration=read('../db/migrations/20261118_R6_time_supplement.sql');
  // Source drift is rejected, not silently patched.
  const upgrade=migration.match(/DO \$upgrade\$[\s\S]*?END \$upgrade\$;/)[0];
  await rollback(async () => {
   const body=(await one("SELECT pg_get_functiondef('real_frontdesk_checkin(text,text,uuid,text)'::regprocedure) AS body")).body;
   await db.exec(body.replace("IF package_catalog_slot_allows(slot,local_time)","IF public.package_catalog_slot_allows(slot,local_time)"));
   await assert.rejects(db.exec(upgrade),/Unexpected R6 checkin source/);
  });
  await db.exec(migration);
  assert.deepEqual(await rows('SELECT * FROM package_payment_orders ORDER BY id'),before);
  assert.deepEqual(await rows('SELECT * FROM members ORDER BY id'),membersBefore);
  assert.equal((await one('SELECT count(*)::int AS n FROM time_supplement_grants')).n,0);
  const grantPayload={memberCode:'TS-3',title:'ช่วงเวลาเสริม',timeSlot:'00:00-24:00',reason:'Synthetic grant'};
  for (const token of ['ts-3','invalid']) await assert.rejects(action(token,'grant',grantPayload),/Staff required|Normal session/);
  for (const change of ["UPDATE auth_sessions SET mode='KIOSK',device_id='test' WHERE member_id=2", "UPDATE auth_sessions SET revoked_at=now() WHERE member_id=2", "UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE member_id=2", "UPDATE members SET status='SUSPENDED' WHERE id=2"])
   await rollback(async () => { await db.exec(change); await assert.rejects(action('ts-2','grant',grantPayload),/Normal session/); });
  for (const patch of [{timeSlot:'23:00-01:00'},{timeSlot:'24:00-24:00'},{price:1},{bonusDays:1},{timeSlot:null},{reason:''}])
   await assert.rejects(action('ts-2','grant',{...grantPayload,...patch}));
  for (const memberCode of ['TS-5','TS-6','missing']) await assert.rejects(action('ts-2','grant',{...grantPayload,memberCode}),/Proven active/);
  for (const change of ["UPDATE members SET status='EXPIRED' WHERE id=3", "UPDATE members SET expire_date=now()-interval '1 second' WHERE id=3", "UPDATE members SET expire_date=expire_date+interval '1 day' WHERE id=3"])
   await rollback(async () => { await db.exec(change); await assert.rejects(action('ts-2','grant',grantPayload),/Proven active/); });
  const grantKey=randomUUID(), g=await action('ts-2','grant',grantPayload,grantKey);
  assert.deepEqual(await action('ts-2','grant',grantPayload,grantKey),g);
  await assert.rejects(action('ts-2','grant',{...grantPayload,title:'different'},grantKey),/Request key reused/);
  const g2=await action('ts-1','grant',grantPayload);
  const localAtGrant=(await one("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::time::text AS t")).t;
  const outsideSlot=localAtGrant<'12:00:00'?'12:00-12:01':'00:00-00:01';
  const off=await action('ts-2','grant',{...grantPayload,timeSlot:outsideSlot});
  await assert.rejects(action('ts-3','activate',{couponId:off.couponId}),/Outside Bangkok window/);
  await rollback(async () => {
   await db.query("UPDATE coupons SET expire_date=now()-interval '1 second' WHERE id=$1",[g.couponId]);
   await assert.rejects(action('ts-3','activate',{couponId:g.couponId}),/Coupon unavailable/);
  });
  await assert.rejects(db.query("SELECT real_benefits_admin_action('ts-2','consume',$1,$2::jsonb)",[randomUUID(),JSON.stringify({couponId:g.couponId,guestReference:'Test'})]),/Coupon unavailable/);
  await assert.rejects(action('ts-4','activate',{couponId:g.couponId}),/Coupon unavailable/);
  await assert.rejects(action('ts-3','activate',{couponId:g.couponId,at:'2026-01-01'}),/Invalid activation/);
  const main=await one('SELECT * FROM time_supplement_main(3,clock_timestamp())');
  assert.equal(main.id,paid.id); assert.equal(main.package_snapshot.timeSlot,paid.package_snapshot.timeSlot);
  assert.notEqual(main.package_snapshot.timeSlot,'00:00-24:00');
  // Deterministic helper boundaries, including Bangkok date crossing UTC and 24:00.
  const end=async (slot,at,expiry='2027-01-01T00:00:00Z') => (await one('SELECT time_supplement_window_end($1,$2,$3)::text AS e',[slot,at,expiry])).e;
  assert.equal(await end('14:00-22:00','2026-11-18T06:59:59.999Z'),null);
  assert.ok(await end('14:00-22:00','2026-11-18T07:00:00Z'));
  assert.equal(await end('14:00-22:00','2026-11-18T15:00:00Z'),null);
  assert.ok(await end('14:00-22:00','2026-11-18T14:59:59.999Z'));
  assert.equal(new Date(await end('00:00-24:00','2026-11-18T17:00:00Z')).toISOString(),'2026-11-19T17:00:00.000Z');
  assert.equal(new Date(await end('00:00-24:00','2026-11-18T17:00:00Z','2026-11-18T17:00:01Z')).toISOString(),'2026-11-18T17:00:01.000Z');
  // Inject failure after coupon consumption: every mutation must roll back.
  await db.exec("CREATE FUNCTION ts_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$; CREATE TRIGGER ts_fail BEFORE INSERT ON time_supplement_activations FOR EACH ROW EXECUTE FUNCTION ts_fail();");
  await assert.rejects(action('ts-3','activate',{couponId:g.couponId}),/injected failure/);
  assert.equal((await one('SELECT used_count FROM coupons WHERE id=$1',[g.couponId])).used_count,0);
  await db.exec('DROP TRIGGER ts_fail ON time_supplement_activations');
  const activationKey=randomUUID(), a=await action('ts-3','activate',{couponId:g.couponId},activationKey);
  assert.deepEqual(await action('ts-3','activate',{couponId:g.couponId},activationKey),a);
  assert.deepEqual(await action('ts-3','activate',{couponId:g.couponId}),a);
  const concurrent=await Promise.all(Array.from({length:8},(_,i)=>action('ts-3','activate',{couponId:i%2?g.couponId:g2.couponId})));
  for (const value of concurrent) assert.deepEqual(value,a);
  assert.equal((await one('SELECT count(*)::int AS n FROM time_supplement_activations')).n,1);
  assert.equal((await one('SELECT used_count FROM coupons WHERE id=$1',[g2.couponId])).used_count,0);
  assert.equal((await one('SELECT sum(used_count)::int AS n FROM coupons WHERE source LIKE $1',['TIME_SUPPLEMENT:%'])).n,1);
  assert.equal((await one('SELECT time_supplement_allows(3,$1) AS ok',[a.activatedAt])).ok,true);
  assert.equal((await one('SELECT time_supplement_allows(3,$1) AS ok',[a.expiresAt])).ok,false);
  assert.equal((await one('SELECT time_supplement_allows(3,$1) AS ok',[new Date(new Date(a.activatedAt).getTime()-1).toISOString()])).ok,false);
  const list=await action('ts-3','list',{},null); assert.equal(list.length,3);
  assert.deepEqual(await action('ts-4','list',{},null),[]);
  assert.equal(list.find(x=>x.couponId===g2.couponId).active,false);
  // Actual checkin wrapper, real runtime clock; deterministic snapshot gate made OFF_PEAK
  // in a rollback-only fixture, preserving terminal guards outside the fixture.
  await rollback(async () => {
   await db.exec('ALTER TABLE package_payment_orders DISABLE TRIGGER USER');
   const local=(await one("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::time::text AS t")).t;
   const offSlot=local<'12:00:00'?'12:00-12:01':'00:00-00:01';
   await db.query("UPDATE package_payment_orders SET package_snapshot=jsonb_set(package_snapshot,'{timeSlot}',to_jsonb($1::text)) WHERE id=$2",[offSlot,paid.id]);
   // Old main binding invalidates supplement: no stale grant on changed snapshot.
   assert.equal((await one('SELECT time_supplement_allows(3,clock_timestamp()) AS ok')).ok,false);
   let r=(await one("SELECT real_frontdesk_checkin('ts-2','ts-desk',$1,'TS-3') AS r",[randomUUID()])).r;
   assert.equal(r.reason,'OFF_PEAK');
   // Match synthetic grant snapshot solely inside this rollback-only fixture.
   await db.exec('ALTER TABLE time_supplement_grants DISABLE TRIGGER USER');
   await db.query('UPDATE time_supplement_grants SET main_snapshot=(SELECT package_snapshot FROM package_payment_orders WHERE id=$1) WHERE member_id=3',[paid.id]);
   const key=randomUUID(); r=(await one("SELECT real_frontdesk_checkin('ts-2','ts-desk',$1,'TS-3') AS r",[key])).r;
   assert.equal(r.ok,true); assert.equal(r.reason,'PAID_ENTRY');
   assert.deepEqual((await one("SELECT real_frontdesk_checkin('ts-2','ts-desk',$1,'TS-3') AS r",[key])).r,r);
   assert.equal((await one("SELECT real_frontdesk_checkin('ts-2','ts-desk',$1,'TS-3') AS r",[randomUUID()])).r.reason,'BOUNCE');
   await db.exec("UPDATE auth_sessions SET mode='KIOSK',device_id='ts-kiosk' WHERE member_id=2");
   const k=(await one("SELECT kiosk_checkin('ts-2','ts-kiosk',$1,'TS-3') AS r",[randomUUID()])).r;
   assert.equal(k.ok,true); assert.equal(k.reason,'PAID_ENTRY');
   assert.equal((await one('SELECT sum(points_awarded)::int AS n FROM checkins')).n,0);
  });
  // Status/aggregate changes invalidate an activated supplement without consuming more.
  for (const change of ["UPDATE members SET status='SUSPENDED' WHERE id=3", "UPDATE members SET expire_date=expire_date+interval '1 day' WHERE id=3"])
   await rollback(async () => { await db.exec(change); assert.equal((await one('SELECT time_supplement_allows(3,clock_timestamp()) AS ok')).ok,false); });
  for (const table of ['time_supplement_grants','time_supplement_activations','time_supplement_requests']) {
   await assert.rejects(db.exec(`DELETE FROM ${table}`),/append-only/);
   await assert.rejects(db.exec(`TRUNCATE ${table} CASCADE`),/append-only/);
  }
  const acl=await rows("SELECT c.relname, x.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x WHERE c.relname IN ('time_supplement_grants','time_supplement_activations','time_supplement_requests') AND x.grantee=0");
  assert.deepEqual(acl,[]);
  assert.deepEqual(await rows('SELECT * FROM package_payment_orders ORDER BY id'),before);
  assert.deepEqual(await rows('SELECT * FROM members ORDER BY id'),membersBefore);
 } finally { await db.close(); }
});
