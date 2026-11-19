// Offline only. SQL regression requires an existing local PGlite; never downloads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(read('./package-catalog.ts'), {
 compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, require: () => { throw Error('Catalog helper must not import runtime dependencies'); } });
const { packageCatalogDailySlot } = exports;
const valid = ['00:00-24:00', '00:00-00:01', '23:59-24:00', '07:00-14:00', '07:00-22:00', '12:34-18:56'];
const invalid = [null, undefined, 7, {}, '', '24:00-24:00', '24:00-01:00', '23:00-01:00', '07:00-07:00',
 '00:00-24:01', '00:00-25:00', '07:60-08:00', '7:00-14:00', '07:00 - 14:00', ' 07:00-14:00',
 '07:00-14:00\n', '07:00-14:00\r', '07:00-14:00Z', '07:00:00-14:00:00', '０７:00-14:00'];
test('daily slot: canonical single same-day interval, 24:00 closing only', () => {
 for (const slot of valid) assert.ok(packageCatalogDailySlot(slot), slot);
 for (const slot of invalid) assert.equal(packageCatalogDailySlot(slot), null, String(slot));
 assert.equal(JSON.stringify(packageCatalogDailySlot('00:00-24:00')), '{"startMinute":0,"endMinute":1440}');
 assert.equal(JSON.stringify(packageCatalogDailySlot('23:59-24:00')), '{"startMinute":1439,"endMinute":1440}');
});
test('daily slot: every canonical minute endpoint pair uses strictly increasing bounds', () => {
 for (let minute=0; minute<1440; minute++) {
  const time = `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  assert.equal(packageCatalogDailySlot(`${time}-${time}`), null);
  const slot = packageCatalogDailySlot(`${time}-24:00`);
  assert.equal(slot.startMinute, minute);
  assert.equal(slot.endMinute, 1440);
  if (minute>0) assert.equal(packageCatalogDailySlot(`${time}-00:00`), null);
 }
});
let PGlite;
try {
 ({ PGlite } = require('@electric-sql/pglite'));
} catch (error) {
 if (error.code !== 'MODULE_NOT_FOUND') throw error;
 try {
  ({ PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite'));
 } catch (localError) {
  if (localError.code !== 'MODULE_NOT_FOUND') throw localError;
 }
}
test('R3 SQL chain: catalog ACL/audit/replay, immutable quote/settlement and kiosk/frontdesk daily slots', {
 timeout: 120000,
}, async () => {
 assert.ok(PGlite, 'PGlite must already be installed locally to run required SQL regression; no automatic install');
 const db = new PGlite();
 try {
  // Reuse the existing synthetic schema only, without executing that test module.
  const fixture = read('./package-payment-benefits.test.mjs').match(/await db\.exec\(`([\s\S]*?)`\);/);
  assert.ok(fixture, 'existing isolated schema fixture must be available');
  await db.exec(fixture[1]);
  for (const name of ['20261009_real_package_payments','20261010_payment_promptpay','20261024_kiosk',
   '20261024_real_benefits_admin','20261024_real_rewards','20261024_real_frontdesk','20261024_real_finance',
   '20261025_package_payment_benefits']) await db.exec(read(`../db/migrations/${name}.sql`));
  await db.exec(`DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature); EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_catalog',f.signature); END LOOP; END $$;`);
  for (const name of ['20261031_payment_receiver_bank','20261031_payment_currency_recheck',
   '20261031_package_catalog','20261031_package_catalog_order_guard']) await db.exec(read(`../db/migrations/${name}.sql`));
  const rows = async (sql,args=[]) => (await db.query(sql,args)).rows;
  const one = async (sql,args=[]) => (await rows(sql,args))[0];
  await db.exec(`INSERT INTO members(member_code,full_name,status,role,expire_date)
   SELECT 'R3-'||i,'SYNTHETIC','ACTIVE',CASE WHEN i=1 THEN 'OWNER' WHEN i=2 THEN 'ADMIN' ELSE 'MEMBER' END,now()+interval '10 days' FROM generate_series(1,8) i;
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'r3-'||id,now()+interval '1 day' FROM members;`);
  const action = async (verb,payload,key=randomUUID(),token='r3-1') => (await one('SELECT package_catalog_action($1,$2,$3,$4::jsonb) AS result',[token,verb,key,JSON.stringify(payload)])).result;
  const receiver = { promptpay:'0890000000',bankCode:'002',bankAccount:'1234567890',name:'SYNTHETIC' };
  const order = async (pkg,member=3,key=randomUUID(),extra={}) => one('SELECT * FROM create_catalog_package_payment_order($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
   [randomUUID(),member,`r3-${member}`,key,JSON.stringify({package:{id:pkg.id,catalogVersion:pkg.version},...extra}),JSON.stringify(receiver)]);
  const settle = async payment => {
   const attempt=randomUUID();
   await db.query('SELECT * FROM claim_package_payment_attempt($1,$2,$3,$4,$5,false)',[payment.id,payment.member_id,`r3-${payment.member_id}`,attempt,'a'.repeat(64)]);
   const evidence={transRef:randomUUID(),paidAt:new Date().toISOString(),amountSatang:payment.amount_satang,
    bankCode:'002',receiverEvidence:'REGISTERED_ACCOUNT_V2',providerStrategy:'EASYSLIP_V2_REGISTERED_ACCOUNT',orderId:payment.id,
    receiverIdentity:{matchingType:'BANK_ACCOUNT',bankCode:'002',bankAccount:receiver.bankAccount,name:receiver.name,expectedName:receiver.name,normalizedName:'SYNTHETIC'}};
   await db.query("UPDATE package_payment_attempts SET state='VERIFIED',evidence=$2::jsonb WHERE id=$1",[attempt,JSON.stringify(evidence)]);
   const finalized=await one('SELECT * FROM finalize_package_payment($1,$2,$3,$4)',[payment.id,payment.member_id,`r3-${payment.member_id}`,attempt]);
   assert.equal(finalized.status,'PAID');
   assert.deepEqual(await one('SELECT * FROM finalize_package_payment($1,$2,$3,$4)',[payment.id,payment.member_id,`r3-${payment.member_id}`,attempt]),finalized);
   return finalized;
  };
  const catalogBefore = await action('list',{},null);
  const original = catalogBefore[0];
  const oldPaid=await settle(await order(original,6));
  await settle(await order(catalogBefore.find(pkg=>pkg.timeSlot==='07:00-22:00'),5));
  const pendingKey=randomUUID(), pending=await order(original,3,pendingKey);
  const historicalRows=await rows('SELECT * FROM package_payment_orders ORDER BY id');
  const originalCatalog=await rows('SELECT * FROM package_catalog ORDER BY id');
  await db.exec(read('../db/migrations/20261118_r3_package_catalog.sql'));
  const checkinMigration=read('../db/migrations/20261118_r3_package_catalog_checkin.sql');
  const upgrade=checkinMigration.match(/DO \$upgrade\$[\s\S]*?END \$upgrade\$;/)[0];
  const originalFrontdesk=(await one("SELECT pg_get_functiondef('real_frontdesk_checkin(text,text,uuid,text)'::regprocedure) AS body")).body;
  await db.exec('BEGIN');
  await db.exec(originalFrontdesk.replace("local_time>time '14:00'","local_time>time '15:00'"));
  await assert.rejects(db.exec(upgrade),/Unexpected R3 checkin source/);
  await db.exec('ROLLBACK');
  const previousFunctions=await rows("SELECT oid::text,proname,proacl::text,proconfig,prosecdef,pg_get_functiondef(oid) AS body FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY oid");
  await db.exec(checkinMigration);
  const afterFunctions=await rows("SELECT oid::text,proname,proacl::text,proconfig,prosecdef,pg_get_functiondef(oid) AS body FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY oid");
  for (const before of previousFunctions) {
   const after=afterFunctions.find(f=>f.oid===before.oid);
   assert.ok(after);
   assert.deepEqual(['kiosk_checkin','real_frontdesk_checkin','guard_package_catalog_order_insert'].includes(before.proname)?{...after,body:before.body}:after,before);
  }
  assert.deepEqual(await rows('SELECT * FROM package_catalog ORDER BY id'),originalCatalog);
  assert.deepEqual(await rows('SELECT * FROM package_payment_orders ORDER BY id'),historicalRows);
  assert.equal(oldPaid.package_snapshot.r3HalfOpenTimeSlot,undefined);
  for (const slot of [...valid,...invalid.filter(s=>typeof s==='string')]) {
   const value = await one('SELECT package_catalog_daily_slot_valid($1) AS valid',[slot]);
   assert.equal(value.valid, packageCatalogDailySlot(slot)!==null, slot);
  }
  const payload={name:'R3 custom',label:'17 days',description:'Synthetic',priceSatang:12345,durationDays:17,
   timeSlot:'00:00-24:00',friendCoupons:2,bonusDays:3,isActive:true};
  const key=randomUUID(), created=await action('create',payload,key,'r3-2');
  assert.equal(created.id,11); assert.equal(created.version,1); assert.equal(created.price,123.45);
  const adminList=await action('list',{},null,'r3-2');
  assert.equal(adminList.length,11);
  const catalogKeys=['id','name','label','description','priceSatang','price','durationDays','timeSlot','friendCoupons','bonusDays','version','catalogVersion','isActive'].sort();
  for (const item of adminList) assert.deepEqual(Object.keys(item).sort(),catalogKeys);
  assert.deepEqual(await action('create',payload,key,'r3-2'),created);
  await assert.rejects(action('create',{...payload,priceSatang:12346},key,'r3-2'),/Request key reused/);
  await assert.rejects(action('update',payload,key,'r3-2'),/Request key reused/);
  for (const token of ['r3-3','invalid']) for (const verb of ['list','create','update'])
   await assert.rejects(action(verb,payload,randomUUID(),token),/OWNER\/ADMIN session required/);
  for (const change of ["UPDATE auth_sessions SET mode='KIOSK',device_id='synthetic' WHERE member_id=2",
   "UPDATE auth_sessions SET revoked_at=now() WHERE member_id=2", "UPDATE auth_sessions SET expires_at=now()-interval '1 day' WHERE member_id=2",
   "UPDATE members SET status='SUSPENDED' WHERE id=2"]) {
   await db.exec('BEGIN'); await db.exec(change);
   await assert.rejects(action('create',payload,key,'r3-2'),/OWNER\/ADMIN session required/);
   await db.exec('ROLLBACK');
  }
  for (const patch of [{id:12},{expectedVersion:1},{priceSatang:0},{priceSatang:'12345'}, {priceSatang:1.5},
   {bonusDays:null},{friendCoupons:101},{durationDays:0},{isActive:'true'},{unknown:1},
   ...invalid.filter(s=>typeof s==='string').map(timeSlot=>({timeSlot}))])
   await assert.rejects(action('create',{...payload,...patch}));
  const { name: omitted, ...incomplete }=payload; assert.ok(omitted);
  await assert.rejects(action('create',incomplete));
  const boughtKey=randomUUID(), bought=await order(created,4,boughtKey,{amountSatang:1,subtotalSatang:1,pointsEarned:999});
  assert.equal(bought.amount_satang,12345); assert.equal(bought.subtotal_satang,12345); assert.equal(bought.points_earned,6);
  assert.equal(bought.package_snapshot.timeSlot,'00:00-24:00'); assert.equal(bought.package_snapshot.catalogVersion,1);
  // Even low-level creators cannot bypass the existing authoritative insert guard.
  const forged={package:{...bought.package_snapshot,price:0.01,priceSatang:1},subtotalSatang:1,amountSatang:1,discountSatang:0,pointsEarned:0,promo:null};
  await assert.rejects(db.query('SELECT * FROM create_package_payment_order($1,7,$2,$3,$4::jsonb,$5::jsonb)',
   [randomUUID(),'r3-7',randomUUID(),JSON.stringify(forged),JSON.stringify(receiver)]),/snapshot does not match/);
  const update={id:created.id,expectedVersion:1,priceSatang:55555,timeSlot:'12:34-18:56',isActive:false};
  const updateKey=randomUUID(), closed=await action('update',update,updateKey,'r3-2');
  assert.equal(closed.version,2); assert.equal(closed.isActive,false);
  assert.deepEqual(await action('update',update,updateKey,'r3-2'),closed);
  await assert.rejects(action('update',update),/Stale catalog version/);
  await assert.rejects(order(closed,5),/Package unavailable/);
  await db.exec('BEGIN');
  const reopened=await action('update',{id:closed.id,expectedVersion:2,isActive:true});
  await db.exec('SAVEPOINT expected_stale');
  await assert.rejects(order(created,5),/Stale catalog version/);
  await db.exec('ROLLBACK TO SAVEPOINT expected_stale');
  const repriced=await order(reopened,5);
  assert.equal(repriced.amount_satang,55555); assert.equal(repriced.package_snapshot.timeSlot,'12:34-18:56');
  assert.equal(repriced.package_snapshot.catalogVersion,3);
  await db.exec('ROLLBACK');
  assert.deepEqual(await order(created,4,boughtKey),bought);
  // Closing/editing catalog does not prevent an already quoted order settling.
  const paidCustom=await settle(bought);
  assert.deepEqual(paidCustom.package_snapshot,bought.package_snapshot);
  const coupons=await rows('SELECT * FROM coupons WHERE member_id=4 ORDER BY type');
  assert.equal(coupons.length,2);
  assert.equal(coupons.find(c=>c.type==='FRIEND_PASS').total_quota,2);
  assert.equal(coupons.find(c=>c.type==='EXTRA_DAYS').bonus_days_value,3);
  assert.deepEqual(await order(created,4,boughtKey),paidCustom);
  assert.deepEqual(await one('SELECT * FROM package_payment_orders WHERE id=$1',[oldPaid.id]),oldPaid);
  await action('update',{id:original.id,expectedVersion:1,isActive:false});
  assert.deepEqual(await order(original,3,pendingKey),pending);
  assert.equal((await rows('SELECT * FROM package_catalog_public WHERE id=$1',[created.id])).length,0);
  // Boundary semantics use Bangkok local time and an exclusive closing bound.
  for (const [slot,time,allowed] of [
   ['00:00-24:00','00:00:00',true],['00:00-24:00','23:59:59.999999',true],
   ['12:34-18:56','12:33:59.999999',false],['12:34-18:56','12:34:00',true],
   ['12:34-18:56','18:55:59.999999',true],['12:34-18:56','18:56:00',false],
   ['23:59-24:00','23:59:00',true],['23:59-24:00','00:00:00',false],
   ['07:00-14:00','06:59:59',false],['07:00-14:00','14:00:00',false],
   ['23:00-01:00','23:30:00',false],['bad','12:00:00',false],[null,'12:00:00',false],
  ]) assert.equal((await one('SELECT package_catalog_slot_allows($1,$2::time) AS allowed',[slot,time])).allowed,allowed,`${slot} ${time}`);
  // Freeze only test copies of deployed functions, never introduce a client clock.
  const checkinDefinitions=await rows("SELECT proname,pg_get_functiondef(oid) AS body FROM pg_proc WHERE proname IN ('kiosk_checkin','real_frontdesk_checkin')");
  await db.exec("UPDATE members SET status='ACTIVE',expire_date='2027-12-31' WHERE id IN (4,5,6); INSERT INTO auth_sessions(member_id,token_hash,expires_at,mode,device_id) VALUES(2,'r3-kiosk',now()+interval '1 day','KIOSK','R3-STATION')");
  for (const def of checkinDefinitions) {
   assert.match(def.body,/package_catalog_slot_allows\(slot,local_time\)/);
   const token=def.proname==='kiosk_checkin'?'r3-kiosk':'r3-2';
   const scan = async (code,key=randomUUID(),session=token) => (await one(`SELECT ${def.proname}($1,'R3-STATION',$2,$3) AS result`,[session,key,code])).result;
   for (const [instant,ok] of [['2026-11-18 00:00:00+07',true],['2026-11-18 23:59:59.999999+07',true]]) {
    await db.exec(def.body.replace('t:=clock_timestamp()',`t:=timestamptz '${instant}'`));
    await db.exec('DELETE FROM kiosk_member_bounce');
    const key=randomUUID(), scanned=await scan('R3-4',key);
    assert.equal(scanned.ok,ok); assert.equal(scanned.reason,'PAID_ENTRY');
    assert.deepEqual(await scan('R3-4',key),scanned);
    await assert.rejects(scan('R3-6',key),/Request key reused/);
    assert.equal((await scan('R3-4')).reason,'BOUNCE');
    await assert.rejects(scan('R3-4',randomUUID(),'r3-3'),/required/);
   }
   for (const [time,short,full] of [
    ['06:59:59.999999','CLOSED','CLOSED'],['07:00:00','PAID_ENTRY','PAID_ENTRY'],
    ['14:00:00','PAID_ENTRY','PAID_ENTRY'],['14:00:00.000001','OFF_PEAK','PAID_ENTRY'],
    ['22:00:00','OFF_PEAK','PAID_ENTRY'],['22:00:00.000001','CLOSED','CLOSED'],
   ]) {
    await db.exec(def.body.replace('t:=clock_timestamp()',`t:=timestamptz '2026-11-18 ${time}+07'`));
    await db.exec('DELETE FROM kiosk_member_bounce');
    for (const [code,reason] of [['R3-6',short],['R3-5',full]]) {
     const result=await scan(code);
     assert.equal(result.reason,reason,`${def.proname} ${code} ${time}`);
     assert.equal(result.ok,reason==='PAID_ENTRY');
     assert.equal(result.checkinId!==null,result.ok);
    }
   }
   await db.exec("UPDATE members SET status='EXPIRED',expire_date='2026-11-17' WHERE id=4; DELETE FROM kiosk_member_bounce");
   assert.equal((await scan('R3-4')).ok,false);
   await db.exec("UPDATE members SET status='SUSPENDED' WHERE id=4");
   assert.equal((await scan('R3-4')).reason,'SUSPENDED');
   await db.exec("UPDATE members SET status='ACTIVE',expire_date='2027-12-31' WHERE id=4");
   await db.exec(def.body);
  }
  // A non-legacy interval exercises the actual entrypoints, not only the helper.
  await db.exec('BEGIN');
  const narrow=await action('create',{...payload,timeSlot:'12:34-18:56'});
  await settle(await order(narrow,7));
  const sameSlot = await action('create',{...payload,timeSlot:'07:00-14:00'});
  const newPaid = await settle(await order(sameSlot,5));
  assert.equal(newPaid.package_snapshot.r3HalfOpenTimeSlot,true);
  await db.exec("UPDATE members SET status='ACTIVE',expire_date='2027-12-31' WHERE id IN (5,7); INSERT INTO coupons(member_id,type,source,title,total_quota,used_count,created_at,expire_date) VALUES(8,'FREE_ENTRY','WELCOME_REGISTRATION','Synthetic welcome',1,0,'2026-11-17','2026-12-01')");
  for (const def of checkinDefinitions) {
   const token=def.proname==='kiosk_checkin'?'r3-kiosk':'r3-2';
   const scan=async code=>(await one(`SELECT ${def.proname}($1,'R3-STATION',$2,$3) AS result`,[token,randomUUID(),code])).result;
   for (const [time,ok] of [['12:33:59.999999',false],['12:34:00',true],['18:55:59.999999',true],['18:56:00',false]]) {
    await db.exec(def.body.replace('t:=clock_timestamp()',`t:=timestamptz '2026-11-18 ${time}+07'`));
    await db.exec('DELETE FROM kiosk_member_bounce');
    assert.equal((await scan('R3-7')).ok,ok,`${def.proname} ${time}`);
   }
   await db.exec(def.body.replace('t:=clock_timestamp()',"t:=timestamptz '2026-11-18 01:00:00+07'"));
   assert.equal((await scan('R3-5')).reason,'OFF_PEAK');
   assert.equal((await scan('R3-8')).reason,'CLOSED');
   await db.exec(def.body.replace('t:=clock_timestamp()',"t:=timestamptz '2026-11-18 14:00:00+07'"));
   assert.equal((await scan('R3-5')).reason,'OFF_PEAK');
   assert.equal((await one('SELECT used_count FROM coupons WHERE member_id=8')).used_count,0);
   await db.exec(def.body.replace('t:=clock_timestamp()',"t:=timestamptz '2026-11-18 07:00:00+07'"));
   assert.equal((await scan('R3-8')).reason,'FREE_ENTRY');
   assert.equal((await one('SELECT used_count FROM coupons WHERE member_id=8')).used_count,1);
   await db.exec("UPDATE coupons SET used_count=0,status='AVAILABLE' WHERE member_id=8; DELETE FROM kiosk_member_bounce");
  }
  await db.exec('ROLLBACK');
  assert.deepEqual(await one('SELECT * FROM package_payment_orders WHERE id=$1',[oldPaid.id]),oldPaid);
  assert.deepEqual(await one('SELECT * FROM package_payment_orders WHERE id=$1',[paidCustom.id]),paidCustom);
  const audits=await rows('SELECT * FROM package_catalog_audit WHERE actor_id=2 ORDER BY created_at');
  assert.equal(audits.length,2); assert.deepEqual(audits[0].before_snapshot,{});
  assert.equal(audits[1].before_snapshot.price_satang,12345);
  await db.exec('BEGIN'); await action('create',payload); await db.exec('ROLLBACK');
  assert.equal((await rows('SELECT * FROM package_catalog')).length,11);
  await db.exec(`CREATE FUNCTION r3_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$;
   CREATE TRIGGER r3_fail_audit BEFORE INSERT ON package_catalog_audit FOR EACH ROW EXECUTE FUNCTION r3_fail_audit();`);
  await assert.rejects(action('create',payload),/synthetic audit failure/);
  assert.equal((await rows('SELECT * FROM package_catalog')).length,11);
  for (const sql of ['DELETE FROM package_catalog','TRUNCATE package_catalog','UPDATE package_catalog_audit SET payload=payload','DELETE FROM package_catalog_audit','TRUNCATE package_catalog_audit']) await assert.rejects(db.exec(sql));
  for (const f of await rows("SELECT prosecdef,has_function_privilege('public',oid,'EXECUTE') AS allowed FROM pg_proc WHERE proname IN ('package_catalog_action','package_catalog_daily_slot_valid','package_catalog_slot_allows','kiosk_checkin','real_frontdesk_checkin')")) {
   assert.equal(f.prosecdef,false); assert.equal(f.allowed,false);
  }
 } finally { await db.close(); }
});
