// Isolated PostgreSQL only: no credentials, network, or live PAID writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
 const filename = new URL(path, import.meta.url).pathname;
 const mod = new Module(filename);
 mod.require = name => dependencies[name] ?? require(name);
 mod._compile(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
 return mod.exports;
}
const catalog = load('./mock-data.ts');
const { quotePackage } = load('./payment-policy.ts', { './mock-data': catalog });
const { PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite');
const migration = read('../db/migrations/20261031_package_catalog_order_guard.sql');

test('insert guard: actual migration chain, legacy compatibility, authoritative catalog and immutable settlement', { timeout: 120000 }, async () => {
 const db = new PGlite();
 try {
  await db.exec(read('./package-payment-benefits.test.mjs').match(/await db\.exec\(`([\s\S]*?)`\);/)[1]);
  for (const name of ['20261009_real_package_payments','20261010_payment_promptpay','20261024_kiosk','20261024_real_benefits_admin','20261024_real_rewards','20261024_real_frontdesk','20261024_real_finance','20261025_package_payment_benefits']) await db.exec(read('../db/migrations/' + name + '.sql'));
  await db.exec(`DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature); EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_catalog',f.signature); END LOOP; END $$;`);
  for (const name of ['20261031_payment_receiver_bank','20261031_payment_currency_recheck','20261031_package_catalog']) await db.exec(read('../db/migrations/' + name + '.sql'));
  const rows = async (sql,args=[]) => (await db.query(sql,args)).rows;
  const one = async (sql,args=[]) => (await rows(sql,args))[0];
  await db.exec(`INSERT INTO members(member_code,full_name,status,role,expire_date) SELECT 'GUARD-'||i,'SYNTHETIC','ACTIVE',CASE WHEN i=1 THEN 'OWNER' ELSE 'MEMBER' END,now()+interval '10 days' FROM generate_series(1,8) i;
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'token-'||id,now()+interval '1 day' FROM members;`);
  const receiver = { promptpay:'0890000000',bankCode:'002',bankAccount:'1234567890',name:'SYNTHETIC UAT' };
  const legacy = (member=2,quote=quotePackage(3,''),key=randomUUID()) => one('SELECT * FROM create_package_payment_order($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[randomUUID(),member,`token-${member}`,key,JSON.stringify(quote),JSON.stringify(receiver)]);
  const create = (key=randomUUID(),version=2,member=5) => one('SELECT * FROM create_catalog_package_payment_order($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[randomUUID(),member,`token-${member}`,key,JSON.stringify({package:{id:3,catalogVersion:version}}),JSON.stringify(receiver)]);
  const edit = async patch => {
   const {version} = await one('SELECT version FROM package_catalog WHERE id=3');
   return one('SELECT package_catalog_action($1,$2,$3,$4::jsonb)', ['token-1','update',randomUUID(),JSON.stringify({id:3,expectedVersion:version,...patch})]);
  };
  const settle = async order => {
   const attempt=randomUUID();
   await db.query('SELECT * FROM claim_package_payment_attempt($1,$2,$3,$4,$5,false)',[order.id,order.member_id,`token-${order.member_id}`,attempt,'a'.repeat(64)]);
   const proof={transRef:randomUUID(),paidAt:new Date().toISOString(),amountSatang:order.amount_satang,bankCode:'002',receiverEvidence:'REGISTERED_ACCOUNT_V2',providerStrategy:'EASYSLIP_V2_REGISTERED_ACCOUNT',orderId:order.id,receiverIdentity:{matchingType:'BANK_ACCOUNT',bankCode:'002',bankAccount:receiver.bankAccount,name:receiver.name,expectedName:receiver.name,normalizedName:'SYNTHETICUAT'}};
   await db.query("UPDATE package_payment_attempts SET state='VERIFIED',evidence=$2::jsonb WHERE id=$1",[attempt,JSON.stringify(proof)]);
   return one('SELECT * FROM finalize_package_payment($1,$2,$3,$4)',[order.id,order.member_id,`token-${order.member_id}`,attempt]);
  };
  const paid=await settle(await legacy(3));
  const pending=await legacy(4);
  const functions=await rows("SELECT oid,pg_get_functiondef(oid) AS body FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY oid");
  const historical=await rows('SELECT * FROM package_payment_orders ORDER BY id');
  await db.exec(migration);
  assert.deepEqual(await rows('SELECT * FROM package_payment_orders ORDER BY id'),historical);
  assert.deepEqual(await rows("SELECT oid,pg_get_functiondef(oid) AS body FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname<>'guard_package_catalog_order_insert' ORDER BY oid"),functions);
  assert.equal((await legacy()).status,'PENDING');
  const base=quotePackage(3,'');
  // Every common field must be present, typed, and equal, not merely price/id.
  for (const field of ['id','name','label','description','price','durationDays','timeSlot','friendCoupons','bonusDays','isActive']) {
   for (const value of [undefined,null,typeof base.package[field]==='number' ? String(base.package[field]) : 'STALE']) {
    const quote={...base,package:{...base.package,[field]:value}};
    await assert.rejects(legacy(6,quote),/Package unavailable|snapshot does not match/);
   }
  }
  await assert.rejects(legacy(6,{...base,subtotalSatang:base.subtotalSatang+1,amountSatang:base.amountSatang+1}),/snapshot does not match/);
  const versioned={...base,package:{...base.package,snapshotVersion:2,catalogVersion:1,priceSatang:base.subtotalSatang}};
  await db.exec('BEGIN');
  assert.equal((await legacy(6,versioned)).status,'PENDING');
  await db.exec('ROLLBACK');
  for (const patch of [{snapshotVersion:null},{snapshotVersion:1},{snapshotVersion:'2'},{catalogVersion:0},{catalogVersion:'1'},{catalogVersion:undefined},{priceSatang:1}]) await assert.rejects(legacy(6,{...versioned,package:{...versioned.package,...patch}}),/snapshot version/);
  const before=await rows('SELECT * FROM members ORDER BY id');
  const orderCount=(await one('SELECT count(*)::int AS n FROM package_payment_orders')).n;
  const ledger=await rows('SELECT * FROM package_payment_point_ledger ORDER BY order_id');
  await edit({priceSatang:123456});
  await assert.rejects(legacy(7),/snapshot does not match/);
  assert.equal((await one('SELECT count(*)::int AS n FROM package_payment_orders')).n,orderCount);
  assert.deepEqual(await rows('SELECT * FROM members ORDER BY id'),before);
  assert.deepEqual(await rows('SELECT * FROM package_payment_point_ledger ORDER BY order_id'),ledger);
  const key=randomUUID(), current=await create(key);
  assert.equal(current.subtotal_satang,123456);
  assert.equal(current.package_snapshot.catalogVersion,2);
  // Rollback each OWNER edit to independently prove stale descriptions/benefits
  // and other fields are blocked even when the seed price has not changed.
  for (const patch of [{description:'Edited'},{name:'Edited'},{label:'Edited'},{friendCoupons:7},{bonusDays:12},{durationDays:31},{timeSlot:'07:00-22:00'},{isActive:false}]) {
   await db.exec('BEGIN');
   await edit({priceSatang:base.subtotalSatang,...patch});
   await assert.rejects(legacy(7),/Package unavailable|snapshot does not match/);
   await db.exec('ROLLBACK');
  }
  await edit({priceSatang:55555,friendCoupons:7,bonusDays:12,isActive:false});
  assert.deepEqual(await create(key,1),current);
  await assert.rejects(create(),/Package unavailable/);
  assert.deepEqual(await one('SELECT * FROM package_payment_orders WHERE id=$1',[pending.id]),pending);
  assert.deepEqual(await one('SELECT * FROM package_payment_orders WHERE id=$1',[paid.id]),paid);
  assert.equal((await settle(pending)).status,'PAID');
  assert.equal((await settle(current)).status,'PAID');
  const coupons=await rows("SELECT * FROM coupons WHERE member_id=4 ORDER BY type");
  assert.equal(coupons.find(c=>c.type==='FRIEND_PASS').total_quota,5);
  assert.equal(coupons.find(c=>c.type==='EXTRA_DAYS').bonus_days_value,15);

  const security=await one("SELECT prosecdef,proconfig,has_function_privilege('public',oid,'EXECUTE') AS allowed FROM pg_proc WHERE proname='guard_package_catalog_order_insert'");
  assert.equal(security.prosecdef,false); assert.equal(security.allowed,false);
  assert.deepEqual(security.proconfig,['search_path=public, pg_catalog']);
  assert.match(migration,/FOR SHARE/);
  assert.doesNotMatch(migration,/BEFORE UPDATE|CREATE OR REPLACE FUNCTION/); 
 } finally { await db.close(); }
});
