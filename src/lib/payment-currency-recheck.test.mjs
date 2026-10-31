// In-memory PostgreSQL only: synthetic sessions and mock provider evidence, no network.
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
const { quotePackage, validateSlip } = load('./payment-policy.ts', { './mock-data': load('./mock-data.ts') });
const { PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite');

test('currency retry: authorization, shared budget, atomic audit, original image, bounded settlement and replay', { timeout: 120000 }, async () => {
 const db = new PGlite();
 try {
  await db.exec(read('./package-payment-benefits.test.mjs').match(/await db\.exec\(`([\s\S]*?)`\);/)[1]);
  for (const name of ['20261009_real_package_payments','20261010_payment_promptpay','20261024_kiosk','20261024_real_benefits_admin','20261024_real_rewards','20261024_real_frontdesk','20261024_real_finance','20261025_package_payment_benefits']) await db.exec(read('../db/migrations/' + name + '.sql'));
  // Match deployment ACL/search-path hardening before the bank-fix migration.
  await db.exec(`DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature); EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_catalog',f.signature); END LOOP; END $$;`);
  await db.exec(read('../db/migrations/20261031_payment_receiver_bank.sql'));
  const originals = async () => (await db.query("SELECT oid::text,pg_get_functiondef(oid) AS body,proacl::text FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY oid")).rows;
  const beforeFunctions = await originals();
  await db.exec(read('../db/migrations/20261031_payment_currency_recheck.sql'));
  assert.deepEqual((await originals()).filter(f => beforeFunctions.some(b => b.oid === f.oid)), beforeFunctions);
  const meta = (await db.query("SELECT prosecdef,proconfig,has_function_privilege('public','prepare_owner_payment_currency_recheck(uuid,integer,text)','EXECUTE') AS public_execute FROM pg_proc WHERE proname='prepare_owner_payment_currency_recheck'")).rows[0];
  assert.equal(meta.prosecdef, false);
  assert.deepEqual(meta.proconfig, ['search_path=public, pg_catalog']);
  assert.equal(meta.public_execute, false);
  const receiver = { promptpay:'0890000000', bankCode:'002', bankAccount:'1234567890', name:'SYNTHETIC UAT' };
  let n = 0;
  async function fixture() {
   const member = (await db.query("INSERT INTO members(member_code,full_name,status,role,points,expire_date) VALUES($1,'SYNTHETIC','ACTIVE','OWNER',17,now()+interval '10 days') RETURNING id", ['CUR-' + ++n])).rows[0].id;
   const token = 'currency-' + member;
   await db.query("INSERT INTO auth_sessions(member_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')", [member,token]);
   const order = (await db.query('SELECT * FROM create_package_payment_order($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [randomUUID(),member,token,randomUUID(),JSON.stringify(quotePackage(3,'')),JSON.stringify(receiver)])).rows[0];
   const id = randomUUID(), hash = 'a'.repeat(64);
   await db.query('SELECT * FROM claim_package_payment_attempt($1,$2,$3,$4,$5,false)', [order.id,member,token,id,hash]);
   await db.query("UPDATE package_payment_attempts SET state='REJECTED',rejection_reason='PROVIDER_VALIDATION_FAILED' WHERE id=$1", [id]);
   return { member,token,order,id,hash };
  }
  const prepare = (f, name='prepare_owner_payment_currency_recheck') => db.query(`SELECT * FROM ${name}($1,$2,$3)`, [f.order.id,f.member,f.token]);
  const snapshot = async () => (await db.query(`SELECT jsonb_build_object('members',(SELECT jsonb_agg(m) FROM members m),'orders',(SELECT jsonb_agg(o) FROM package_payment_orders o),'attempts',(SELECT jsonb_agg(a) FROM package_payment_attempts a),'audit',(SELECT jsonb_agg(r) FROM package_payment_resolution_audit r),'ledger',(SELECT jsonb_agg(l) FROM package_payment_point_ledger l),'coupons',(SELECT jsonb_agg(c) FROM coupons c),'refs',(SELECT jsonb_agg(t) FROM payment_transfer_refs t)) AS state`)).rows[0].state;
  for (const change of ["UPDATE members SET role='MEMBER' WHERE id=$1", "UPDATE members SET status='SUSPENDED' WHERE id=$1", "UPDATE auth_sessions SET mode='KIOSK',device_id='synthetic-station' WHERE member_id=$1", "UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE member_id=$1", "UPDATE auth_sessions SET revoked_at=now() WHERE member_id=$1"]) {
   const f = await fixture(); await db.query(change,[f.member]);
   const before = await snapshot(); await assert.rejects(prepare(f), /OWNER session required/); assert.deepEqual(await snapshot(),before);
  }
  const f = await fixture(), other = await fixture();
  for (const invalid of [{...f,member:other.member,token:other.token},{...f,token:'invalid'}]) {
   const before = await snapshot(); await assert.rejects(prepare(invalid), /OWNER session required/); assert.deepEqual(await snapshot(),before);
  }
  // A caller rollback must undo both audit and reopening.
  const before = await snapshot();
  await db.exec('BEGIN'); await prepare(f); await db.exec('ROLLBACK'); assert.deepEqual(await snapshot(),before);
  // A trigger failure after audit insertion must roll back the audit as well.
  await db.exec(`CREATE FUNCTION currency_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic update failure'; END $$; CREATE TRIGGER currency_test_fail BEFORE UPDATE ON package_payment_attempts FOR EACH ROW EXECUTE FUNCTION currency_test_fail();`);
  await assert.rejects(prepare(f), /synthetic update failure/); assert.deepEqual(await snapshot(),before);
  await db.exec('DROP TRIGGER currency_test_fail ON package_payment_attempts; DROP FUNCTION currency_test_fail();');
  // Seed historical timestamps in the isolated fixture only; restore every production
  // trigger before calling the function under test (no live database is involved).
  await db.exec('ALTER TABLE package_payment_orders DISABLE TRIGGER USER; ALTER TABLE package_payment_attempts DISABLE TRIGGER USER;');
  await db.query("UPDATE package_payment_orders SET created_at=created_at-interval '1 hour',expires_at=expires_at-interval '1 hour',upload_deadline=upload_deadline-interval '1 hour' WHERE id=$1",[f.order.id]);
  await db.query("UPDATE package_payment_attempts SET created_at=created_at-interval '1 hour' WHERE id=$1",[f.id]);
  await db.exec('ALTER TABLE package_payment_orders ENABLE TRIGGER USER; ALTER TABLE package_payment_attempts ENABLE TRIGGER USER;');
  const original = (await db.query('SELECT * FROM package_payment_attempts WHERE id=$1',[f.id])).rows[0];
  const orderBefore = (await db.query('SELECT * FROM package_payment_orders WHERE id=$1',[f.order.id])).rows[0];
  const memberBefore = (await db.query('SELECT * FROM members WHERE id=$1',[f.member])).rows[0];
  const reopened = (await prepare(f)).rows[0];
  assert.equal(reopened.state,'UNKNOWN'); assert.equal(reopened.rejection_reason,null);
  for (const key of Object.keys(original).filter(k => !['state','rejection_reason','updated_at'].includes(k))) assert.deepEqual(reopened[key],original[key]);
  assert.deepEqual((await db.query('SELECT * FROM package_payment_orders WHERE id=$1',[f.order.id])).rows[0],orderBefore);
  assert.deepEqual((await db.query('SELECT * FROM members WHERE id=$1',[f.member])).rows[0],memberBefore);
  const audit = (await db.query("SELECT * FROM package_payment_resolution_audit WHERE order_id=$1",[f.order.id])).rows[0];
  assert.equal(audit.reason_code,'THB_NUMERIC_CURRENCY_FIX'); assert.match(audit.reason,/764/);
  assert.equal(audit.reconciliation_evidence.imageSha256,f.hash); assert.match(audit.reconciliation_evidence.transactionId,/^\d+$/);
  for (const name of ['prepare_owner_payment_currency_recheck','prepare_owner_payment_recheck']) await assert.rejects(prepare(f,name), /unavailable or consumed/);
  const old = await fixture(); await prepare(old,'prepare_owner_payment_recheck'); await assert.rejects(prepare(old), /unavailable or consumed/);
  const lease = randomUUID();
  const claim = () => db.query('SELECT * FROM claim_package_payment_attempt($1,$2,$3,$4,$5,true)',[f.order.id,f.member,f.token,lease,f.hash]);
  const claimed = (await claim()).rows[0]; assert.equal(claimed.id,f.id); assert.equal(claimed.provider_calls,2); assert.equal(claimed.lease_token,lease);
  assert.equal((await claim()).rows[0].provider_calls,2);
  await db.query("UPDATE package_payment_attempts SET updated_at=clock_timestamp()-interval '3 minutes',state='UNKNOWN' WHERE id=$1",[f.id]);
  assert.equal((await claim()).rows[0].state,'UNKNOWN');
  await assert.rejects(db.query('SELECT * FROM claim_package_payment_attempt($1,$2,$3,$4,$5,true)',[f.order.id,f.member,f.token,randomUUID(),'b'.repeat(64)]), /Upload deadline elapsed/);

  // Settlement is exercised on a fresh legitimately claimed second lease.
  const paid = await fixture(); await prepare(paid);
  await db.query('SELECT * FROM claim_package_payment_attempt($1,$2,$3,$4,$5,true)',[paid.order.id,paid.member,paid.token,randomUUID(),paid.hash]);
  const provider = { success:true,data:{ matchedAccount:{bank:{code:'002'},bankNumber:receiver.bankAccount,name:receiver.name},rawSlip:{transRef:randomUUID(),date:new Date().toISOString(),amount:{amount:paid.order.amount_satang/100,currency:764},receiver:{bank:{id:'002'},account:{bank:{type:'BANKAC',account:receiver.bankAccount}}}}}};
  const evidence = validateSlip(provider,{...paid.order,created_at:paid.order.created_at.toISOString(),expires_at:paid.order.expires_at.toISOString()});
  await db.query("UPDATE package_payment_attempts SET state='VERIFIED',evidence=$2::jsonb WHERE id=$1",[paid.id,JSON.stringify(evidence)]);
  const finalize = () => db.query('SELECT * FROM finalize_package_payment($1,$2,$3,$4)',[paid.order.id,paid.member,paid.token,paid.id]);
  assert.equal((await finalize()).rows[0].status,'PAID');
  const settled = await snapshot(); assert.equal((await finalize()).rows[0].status,'PAID'); assert.deepEqual(await snapshot(),settled);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM package_payment_point_ledger WHERE order_id=$1',[paid.order.id])).rows[0].n,1);
 } finally { await db.close(); }
});
