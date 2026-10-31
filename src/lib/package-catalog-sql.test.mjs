// In-memory PostgreSQL only. No environment credentials, network or provider calls.
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
const migration = read('../db/migrations/20261031_package_catalog.sql');

test('catalog SQL: exact seed, OWNER edits, immutable replay, authoritative orders and paid benefits', { timeout: 120000 }, async () => {
 const db = new PGlite();
 try {
  await db.exec(read('./package-payment-benefits.test.mjs').match(/await db\.exec\(`([\s\S]*?)`\);/)[1]);
  for (const name of ['20261009_real_package_payments','20261010_payment_promptpay','20261024_kiosk','20261024_real_benefits_admin','20261024_real_rewards','20261024_real_frontdesk','20261024_real_finance','20261025_package_payment_benefits']) await db.exec(read('../db/migrations/' + name + '.sql'));
  await db.exec(`DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature); EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_catalog',f.signature); END LOOP; END $$;`);
  await db.exec(read('../db/migrations/20261031_payment_receiver_bank.sql'));
  await db.exec(read('../db/migrations/20261031_payment_currency_recheck.sql'));
  const rows = async (sql, args=[]) => (await db.query(sql,args)).rows;
  const one = async (sql,args=[]) => (await rows(sql,args))[0];
  const functions = () => rows("SELECT oid::text,proname,pg_get_functiondef(oid) AS body,proacl::text FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY oid");
  await db.exec(`INSERT INTO members(member_code,full_name,status,role,expire_date)
   SELECT 'CAT-'||i,'SYNTHETIC','ACTIVE',CASE WHEN i=1 THEN 'OWNER' WHEN i=2 THEN 'ADMIN' ELSE 'MEMBER' END,now()+interval '10 days' FROM generate_series(1,20) i;
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'token-'||id,now()+interval '1 day' FROM members;`);
  const receiver = { promptpay:'0890000000',bankCode:'002',bankAccount:'1234567890',name:'SYNTHETIC UAT' };
  const settle = async order => {
   const attempt = randomUUID();
   await db.query('SELECT * FROM claim_package_payment_attempt($1,$2,$3,$4,$5,false)',[order.id,order.member_id,`token-${order.member_id}`,attempt,'a'.repeat(64)]);
   const proof = { transRef:randomUUID(),paidAt:new Date().toISOString(),amountSatang:order.amount_satang,bankCode:'002',receiverEvidence:'REGISTERED_ACCOUNT_V2',providerStrategy:'EASYSLIP_V2_REGISTERED_ACCOUNT',orderId:order.id,receiverIdentity:{matchingType:'BANK_ACCOUNT',bankCode:'002',bankAccount:receiver.bankAccount,name:receiver.name,expectedName:receiver.name,normalizedName:'SYNTHETICUAT'} };
   await db.query("UPDATE package_payment_attempts SET state='VERIFIED',evidence=$2::jsonb WHERE id=$1",[attempt,JSON.stringify(proof)]);
   const finalize = () => one('SELECT * FROM finalize_package_payment($1,$2,$3,$4)',[order.id,order.member_id,`token-${order.member_id}`,attempt]);
   const paid = await finalize(); assert.equal(paid.status,'PAID'); assert.deepEqual(await finalize(),paid); return paid;
  };
  const legacy = await one('SELECT * FROM create_package_payment_order($1,3,$2,$3,$4::jsonb,$5::jsonb)',[randomUUID(),'token-3',randomUUID(),JSON.stringify(quotePackage(3,'')),JSON.stringify(receiver)]);
  await settle(legacy);
  const beforePaid = await one('SELECT * FROM package_payment_orders WHERE id=$1',[legacy.id]);
  const beforeCoupons = await rows('SELECT * FROM coupons ORDER BY id');
  const beforeFunctions = await functions();
  await db.exec(migration);
  assert.deepEqual(await one('SELECT * FROM package_payment_orders WHERE id=$1',[legacy.id]),beforePaid);
  assert.deepEqual(await rows('SELECT * FROM coupons ORDER BY id'),beforeCoupons);
  assert.deepEqual((await functions()).filter(f => beforeFunctions.some(b => b.oid===f.oid) && f.proname!=='issue_paid_package_benefits'),beforeFunctions.filter(f => f.proname!=='issue_paid_package_benefits'));
  for (const row of await rows('SELECT * FROM package_catalog_public ORDER BY id')) {
   const { priceSatang,version,catalogVersion,...mock }=row;
   assert.deepEqual({...mock,price:Number(mock.price)},catalog.mockPackages[row.id-1]); assert.equal(priceSatang,Number(mock.price)*100); assert.equal(version,1); assert.equal(catalogVersion,1);
  }
  assert.equal((await rows('SELECT * FROM package_catalog')).length,10);
  const action = async (payload, key=randomUUID(), token='token-1', verb='update') => (await one('SELECT package_catalog_action($1,$2,$3,$4::jsonb) AS result',[token,verb,key,JSON.stringify(payload)])).result;
  assert.equal((await action({},null,'token-1','list')).length,10);
  for (const token of ['token-2','token-3','invalid']) for (const verb of ['list','update']) await assert.rejects(action({id:3,expectedVersion:1},randomUUID(),token,verb),/OWNER session required/);
  for (const change of ["UPDATE auth_sessions SET mode='KIOSK',device_id='synthetic' WHERE member_id=1","UPDATE auth_sessions SET revoked_at=now() WHERE member_id=1","UPDATE auth_sessions SET expires_at=now()-interval '1 day' WHERE member_id=1","UPDATE members SET status='SUSPENDED' WHERE id=1"]) {
   for (const verb of ['list','update']) {
    await db.exec('BEGIN'); await db.exec(change);
    await assert.rejects(action({id:2,expectedVersion:1,bonusDays:12},randomUUID(),'token-1',verb),/OWNER session required/);
    await db.exec('ROLLBACK');
   }
  }
  for (const status of ['PENDING','EXPIRED']) {
   await db.exec('BEGIN');
   await db.query("UPDATE members SET status=$1,expire_date=now()-interval '1 day' WHERE id=1",[status]);
   assert.equal((await action({},null,'token-1','list')).length,10);
   const payload={id:2,expectedVersion:1,bonusDays:12}, key=randomUUID();
   const updated=await action(payload,key);
   assert.equal(updated.bonusDays,12); assert.equal(updated.version,2);
   assert.deepEqual(await action(payload,key),updated);
   await db.exec('ROLLBACK');
  }
  for (const patch of [{priceSatang:0},{priceSatang:100000001},{durationDays:0},{durationDays:3661},{friendCoupons:101},{bonusDays:366},{bonusDays:1.5},{friendCoupons:'7'},{priceSatang:null},{timeSlot:'OTHER'},{isActive:'true'},{unknown:1}]) await assert.rejects(action({id:3,expectedVersion:1,...patch}));
  const edit = {id:3,expectedVersion:1,priceSatang:123456,friendCoupons:7,bonusDays:12};
  const editKey=randomUUID(), edited=await action(edit,editKey);
  assert.equal(edited.version,2); assert.equal(edited.price,1234.56); assert.deepEqual(await action(edit,editKey),edited);
  await assert.rejects(action({...edit,bonusDays:13},editKey),/Request key reused/);
  await assert.rejects(action(edit),/Stale catalog version/);
  const create = (member=4,key=randomUUID(),version=2,pkg=3,promo='',extra={}) => one('SELECT * FROM create_catalog_package_payment_order($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[randomUUID(),member,`token-${member}`,key,JSON.stringify({package:{id:pkg,catalogVersion:version},promo:{code:promo},...extra}),JSON.stringify(receiver)]);
  await assert.rejects(create(4,randomUUID(),1),e=>e.code==='P0001' && /Stale catalog version/.test(e.message));
  await assert.rejects(create(4,randomUUID(),undefined,3,'',{package:{id:3}}),/catalogVersion required/);
  // Discounts still come from assigned DB definitions, not the browser quote.
  await db.exec(`INSERT INTO benefit_definitions(kind,title,code,discount_type,discount_value,usage_limit,expires_at,created_by)
   VALUES('PROMO','Synthetic discount','CATPROMO','FIXED',1234,10,now()+interval '1 day',1);
   INSERT INTO benefit_assignments(definition_id,member_id,granted_by) SELECT id,6,1 FROM benefit_definitions WHERE code='CATPROMO';`);
  const promoKey=randomUUID(), promoOrder=await create(6,promoKey,2,3,' catpromo ');
  assert.equal(promoOrder.amount_satang,122222); assert.equal(promoOrder.discount_satang,1234); assert.equal(promoOrder.promo_code,'CATPROMO');
  assert.deepEqual(await create(6,promoKey,1,3,'CATPROMO'),promoOrder);
  assert.equal((await rows('SELECT * FROM benefit_promo_reservations WHERE order_id=$1',[promoOrder.id])).length,1);
  await assert.rejects(create(7,randomUUID(),2,3,'CATPROMO'),/Promo unavailable/);
  // Failure and explicit rollback cannot leave an audit entry or changed version.
  await db.exec('BEGIN'); await action({id:2,expectedVersion:1,bonusDays:12}); await db.exec('ROLLBACK');
  assert.equal((await one('SELECT version FROM package_catalog WHERE id=2')).version,1);
  await db.exec(`CREATE FUNCTION catalog_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$;
   CREATE TRIGGER catalog_test_fail BEFORE INSERT ON package_catalog_audit FOR EACH ROW EXECUTE FUNCTION catalog_test_fail();`);
  await assert.rejects(action({id:2,expectedVersion:1,bonusDays:12}),/synthetic audit failure/);
  assert.equal((await one('SELECT version FROM package_catalog WHERE id=2')).version,1);
  await db.exec('DROP TRIGGER catalog_test_fail ON package_catalog_audit; DROP FUNCTION catalog_test_fail();');
  const key=randomUUID();
  const order=await create(4,key,2,3,'',{amountSatang:1,subtotalSatang:1,discountSatang:999999,pointsEarned:99999});
  assert.equal(order.amount_satang,123456); assert.equal(order.subtotal_satang,123456); assert.equal(order.discount_satang,0); assert.equal(order.points_earned,61);
  assert.deepEqual(order.package_snapshot,{...catalog.mockPackages[2],price:1234.56,priceSatang:123456,friendCoupons:7,bonusDays:12,catalogVersion:2,snapshotVersion:2});
  await action({id:3,expectedVersion:2,priceSatang:55555,isActive:false});
  assert.deepEqual(await create(4,key,1),order);
  await assert.rejects(create(4,key,2,2),/Request key reused/);
  await assert.rejects(create(4,key,2,3,' DIFFERENT '),/Request key reused/);
  await assert.rejects(create(5),/Package unavailable/);
  assert.equal((await rows('SELECT * FROM package_catalog_public')).length,9);
  assert.equal((await action({},null,'token-1','list')).length,10);
  const paid=await settle(order);
  const coupons=await rows('SELECT * FROM coupons WHERE member_id=4 ORDER BY type');
  assert.equal(coupons.length,2);
  assert.equal(coupons.find(c=>c.type==='FRIEND_PASS').total_quota,7);
  assert.equal(coupons.find(c=>c.type==='EXTRA_DAYS').bonus_days_value,12);
  assert.equal(coupons[0].expire_date.getTime(),paid.membership_expires_at.getTime());
  assert.deepEqual(await create(4,key,1),paid);
  assert.equal((await one('SELECT count(*)::int AS n FROM package_payment_point_ledger WHERE order_id=$1',[order.id])).n,1);
  assert.deepEqual(await one('SELECT * FROM package_payment_orders WHERE id=$1',[legacy.id]),beforePaid);
  for (const sql of ['UPDATE package_catalog_audit SET payload=payload','DELETE FROM package_catalog_audit','TRUNCATE package_catalog_audit','DELETE FROM package_catalog','TRUNCATE package_catalog','UPDATE package_catalog SET id=10 WHERE id=1']) await assert.rejects(db.exec(sql),/append-only|cannot be deleted|identity\/version/);
  assert.equal((await rows('SELECT * FROM package_catalog_audit')).length,2);
  // Request authentication is rechecked even for an otherwise valid replay.
  await db.exec("UPDATE auth_sessions SET mode='KIOSK',device_id='synthetic' WHERE member_id=4");
  await assert.rejects(create(4,key),/Unauthorized/);
  await db.exec("UPDATE auth_sessions SET mode='NORMAL',device_id=NULL WHERE member_id=4");
  // A legacy pending snapshot keeps the old whitelist, even after this migration.
  const malformed=await one('SELECT * FROM create_package_payment_order($1,8,$2,$3,$4::jsonb,$5::jsonb)',[randomUUID(),'token-8',randomUUID(),JSON.stringify({...quotePackage(3,''),package:{...quotePackage(3,'').package,friendCoupons:7,bonusDays:12}}),JSON.stringify(receiver)]);
  await assert.rejects(settle(malformed),/Invalid package benefit snapshot/);
  assert.equal((await one('SELECT status FROM package_payment_orders WHERE id=$1',[malformed.id])).status,'PENDING');
  assert.equal((await rows('SELECT * FROM coupons WHERE member_id=8')).length,0);
  const validLegacy=await one('SELECT * FROM create_package_payment_order($1,9,$2,$3,$4::jsonb,$5::jsonb)',[randomUUID(),'token-9',randomUUID(),JSON.stringify(quotePackage(3,'')),JSON.stringify(receiver)]);
  await settle(validLegacy);
  assert.equal((await one("SELECT total_quota FROM coupons WHERE member_id=9 AND type='FRIEND_PASS'")).total_quota,5);
  assert.equal((await one("SELECT bonus_days_value FROM coupons WHERE member_id=9 AND type='EXTRA_DAYS'")).bonus_days_value,15);
  for (const [index,patch] of [{friendCoupons:101},{bonusDays:366},{friendCoupons:1.5},{bonusDays:-1},{bonusDays:12.5},{bonusDays:'12'},{bonusDays:null},{bonusDays:'invalid'},{bonusDays:2147483648},{bonusDays:{value:12}}].entries()) {
   const member=10+index;
   const invalid=await one('SELECT * FROM create_package_payment_order($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[randomUUID(),member,`token-${member}`,randomUUID(),JSON.stringify({...quotePackage(3,''),package:{...quotePackage(3,'').package,snapshotVersion:2,...patch}}),JSON.stringify(receiver)]);
   await assert.rejects(settle(invalid),/Invalid package benefit snapshot|invalid input syntax|out of range/);
   assert.equal((await one('SELECT status FROM package_payment_orders WHERE id=$1',[invalid.id])).status,'PENDING');
   assert.equal((await rows('SELECT * FROM coupons WHERE member_id=$1',[member])).length,0);
  }
  // All bounded custom bonuses, including zero and the upper limit, settle once.
  for (const bonusDays of [0,1,12,365]) {
   await db.exec('BEGIN');
   const custom=await one('SELECT * FROM create_package_payment_order($1,20,$2,$3,$4::jsonb,$5::jsonb)',[randomUUID(),'token-20',randomUUID(),JSON.stringify({...quotePackage(3,''),package:{...quotePackage(3,'').package,snapshotVersion:2,friendCoupons:100,bonusDays}}),JSON.stringify(receiver)]);
   await settle(custom);
   const issued=await rows('SELECT * FROM coupons WHERE member_id=20');
   assert.equal(issued.find(c=>c.type==='FRIEND_PASS').total_quota,100);
   assert.equal(issued.length,bonusDays===0 ? 1 : 2);
   if (bonusDays>0) assert.equal(issued.find(c=>c.type==='EXTRA_DAYS').bonus_days_value,bonusDays);
   await db.exec('ROLLBACK');
  }
  // Fail closed if the installed issuance body has drifted before deployment.
  const guard=migration.match(/DO \$guard\$[\s\S]*?END \$guard\$;/)[0];
  await db.exec('BEGIN');
  await db.exec(`CREATE OR REPLACE FUNCTION issue_paid_package_benefits() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`);
  await assert.rejects(db.exec(guard),/Unexpected issue_paid_package_benefits source/);
  await db.exec('ROLLBACK');
  const acl = await rows("SELECT proname,prosecdef,has_function_privilege('public',oid,'EXECUTE') AS allowed FROM pg_proc WHERE proname IN ('package_catalog_action','create_catalog_package_payment_order','issue_paid_package_benefits')");
  assert.equal(acl.length,3); for (const f of acl) { assert.equal(f.allowed,false); assert.equal(f.prosecdef,false); }
 } finally { await db.close(); }
});
