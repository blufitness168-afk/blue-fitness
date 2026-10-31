// Isolated, synthetic UAT only. Never reads env files or connects to external services.
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
const catalog = load('../src/lib/mock-data.ts');
const { quotePackage, validateSlip } = load('../src/lib/payment-policy.ts', { './mock-data': catalog });
const { PGlite } = createRequire(new URL('../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite');
const migrations = ['20261009_real_package_payments.sql','20261010_payment_promptpay.sql','20261024_kiosk.sql','20261024_real_benefits_admin.sql','20261024_real_rewards.sql','20261024_real_frontdesk.sql','20261024_real_finance.sql','20261025_package_payment_benefits.sql'];
const db = new PGlite();
try {
 // Reuse the exact prerequisite schema contract, without importing/running its tests.
 const fixture = read('../src/lib/package-payment-benefits.test.mjs').match(/await db\.exec\(`([\s\S]*?)`\);/);
 assert.ok(fixture, 'benefits prerequisite schema must exist');
 await db.exec(fixture[1]);
 for (const file of migrations) await db.exec(read('../src/db/migrations/' + file));
 const finalizer = (await db.query("SELECT pg_get_functiondef('finalize_package_payment(uuid,integer,text,uuid)'::regprocedure) AS body")).rows[0].body;
 assert.match(finalizer, /mode = 'NORMAL'/);
 assert.match(finalizer, /a\.evidence->>'bankCode'='004'/);
 await db.exec(`INSERT INTO members(member_code,full_name,status,role,points,expire_date)
 SELECT 'UAT-'||i,'SYNTHETIC UAT','ACTIVE','MEMBER',17,now()+interval '10 days' FROM generate_series(1,2) i;
 INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'uat-token-'||id,now()+interval '1 day' FROM members;`);
 const receiver = { promptpay:'0890000000', bankCode:'002', bankAccount:'1234567890', name:'SYNTHETIC UAT' };
 const quote = quotePackage(3, '');
 assert.ok(quote.package.friendCoupons > 0 && quote.package.bonusDays > 0);
 const state = async order => {
  const member = (await db.query('SELECT * FROM members WHERE id=$1', [order.member_id])).rows[0];
  const current = (await db.query('SELECT * FROM package_payment_orders WHERE id=$1', [order.id])).rows[0];
  const counts = (await db.query(`SELECT
   (SELECT count(*)::int FROM checkins WHERE member_id=$1) AS checkins,
   (SELECT count(*)::int FROM coupons WHERE member_id=$1) AS coupons,
   (SELECT count(*)::int FROM package_payment_point_ledger WHERE member_id=$1) AS ledger,
   (SELECT count(*)::int FROM payment_transfer_refs WHERE source=$2) AS refs,
   (SELECT coalesce(sum(amount_satang),0)::text FROM package_payment_orders WHERE member_id=$1 AND status='PAID') AS paid_amount`, [order.member_id, 'PACKAGE_ORDER:' + order.id])).rows[0];
  return { member, current, counts };
 };
 for (const [index, matchingType] of ['BANK_ACCOUNT','PROMPTPAY'].entries()) {
  const member = index + 1, token = 'uat-token-' + member;
  const order = (await db.query('SELECT * FROM create_package_payment_order($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [randomUUID(),member,token,randomUUID(),JSON.stringify(quote),JSON.stringify(receiver)])).rows[0];
  assert.deepEqual(order.receiver_snapshot, receiver);
  const attempt = randomUUID();
  await db.query('SELECT * FROM claim_package_payment_attempt($1,$2,$3,$4,$5,false)', [order.id,member,token,attempt,'a'.repeat(64)]);
  const promptpay = matchingType === 'PROMPTPAY';
  const providerFixture = { success:true, data: { matchedAccount: { bank:{ code:promptpay ? 'PROMPTPAY' : '002' }, bankNumber:promptpay ? receiver.promptpay : receiver.bankAccount, name:receiver.name }, rawSlip: { transRef:randomUUID(), date:new Date().toISOString(), amount:{ amount:order.amount_satang / 100 }, receiver:{ bank:{ id:'002' }, account:{ bank:{ type:'BANKAC', account:receiver.bankAccount }, ...(promptpay ? { proxy:{ type:'MSISDN', account:receiver.promptpay } } : {}) } } } } };
  const evidence = validateSlip(providerFixture, { ...order, created_at:order.created_at.toISOString(), expires_at:order.expires_at.toISOString() });
  assert.equal(evidence.bankCode, '002');
  assert.equal(evidence.receiverIdentity.matchingType, matchingType);
  await db.query("UPDATE package_payment_attempts SET state='VERIFIED',evidence=$2::jsonb WHERE id=$1", [attempt,JSON.stringify(evidence)]);
  const before = await state(order);
  const finalize = () => db.query('SELECT * FROM finalize_package_payment($1,$2,$3,$4)', [order.id,member,token,attempt]);
  if (!promptpay) {
   // Detection assertion: throws only for the known defect, not arbitrary errors.
   await assert.rejects(finalize, error => error.message === 'Invalid payment evidence');
   assert.deepEqual(await state(order), before, 'rejected evidence must preserve amount, points, membership, checkins, coupons and refs');
   assert.equal(before.current.status, 'PENDING');
   assert.deepEqual(before.counts, { checkins:0,coupons:0,ledger:0,refs:0,paid_amount:'0' });
   assert.equal((await db.query('SELECT state FROM package_payment_attempts WHERE id=$1',[attempt])).rows[0].state,'VERIFIED');
   console.log('DETECTED EXPECTED DEFECT: Bangkok BANK_ACCOUNT passes TS, SQL throws Invalid payment evidence; all settlement effects unchanged (order PENDING, attempt VERIFIED).');
  } else {
   const paid = (await finalize()).rows[0];
   assert.equal(paid.status,'PAID');
   const after = await state(order);
   assert.equal(after.current.amount_satang,quote.amountSatang);
   assert.equal(after.counts.paid_amount,String(quote.amountSatang));
   assert.equal(after.member.points,before.member.points + quote.pointsEarned);
   assert.equal(after.member.expire_date.getTime()-before.member.expire_date.getTime(),quote.package.durationDays*86400000);
   assert.equal(after.counts.checkins,before.counts.checkins);
   assert.deepEqual([after.counts.coupons,after.counts.ledger,after.counts.refs],[2,1,1]);
   const coupons = (await db.query('SELECT * FROM coupons WHERE member_id=$1',[member])).rows;
   for (const c of coupons) {
    assert.equal(c.status,'AVAILABLE'); assert.equal(c.used_count,0);
    assert.equal(c.total_quota,c.type==='FRIEND_PASS' ? quote.package.friendCoupons : 1);
    assert.equal(c.bonus_days_value,c.type==='EXTRA_DAYS' ? quote.package.bonusDays : 0);
    assert.equal(c.expire_date.getTime(),paid.membership_expires_at.getTime());
   }
   await finalize();
   assert.deepEqual(await state(order),after,'replay must not repeat settlement');
   assert.deepEqual((await db.query('SELECT * FROM coupons WHERE member_id=$1',[member])).rows,coupons);
   console.log('PASS: Bangkok PROMPTPAY settles exact amount/points/membership/coupons once; checkins unchanged; replay identical.');
  }
 }
 const definition = async () => (await db.query("SELECT pg_get_functiondef('finalize_package_payment(uuid,integer,text,uuid)'::regprocedure) AS body")).rows[0].body;
 const acl = async () => (await db.query("SELECT proacl::text, proowner, prosecdef, proconfig FROM pg_proc WHERE oid='finalize_package_payment(uuid,integer,text,uuid)'::regprocedure")).rows;
 const snapshot = async () => {
  const result = {};
  for (const table of ['members','auth_sessions','package_payment_orders','package_payment_attempts','payment_transfer_refs','package_payment_point_ledger','coupons','checkins']) {
   result[table] = (await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
 };
 const oldGuard = "AND a.evidence->>'bankCode'='004'";
 const newGuard = "AND (o.receiver_snapshot->>'bankCode') ~ '^[0-9]{3}$'";
 assert.equal(finalizer.split(oldGuard).length - 1, 1, 'baseline must have exactly one obsolete guard');
 const rawData = await snapshot(), rawAcl = await acl();
 const migration = read('../src/db/migrations/20261031_payment_receiver_bank.sql');
 assert.match(finalizer, /SET search_path TO 'public', 'pg_temp'/);
 await assert.rejects(db.exec(migration), /Unexpected finalizer baseline; review before migration/);
 await db.exec('ROLLBACK');
 assert.equal(await definition(),finalizer);
 assert.deepEqual(await acl(),rawAcl);
 assert.deepEqual(await snapshot(),rawData,'raw pg_temp baseline rejection must not mutate data');
 console.log('PASS: raw pg_temp baseline rejected without function/ACL/data mutation.');
 // Reviewed deployment hardening from db-payments-incremental.mjs, not raw migration SQL.
 await db.exec(`ALTER FUNCTION public.finalize_package_payment(uuid,integer,text,uuid) SET search_path=public,pg_catalog;
 REVOKE ALL ON FUNCTION public.finalize_package_payment(uuid,integer,text,uuid) FROM PUBLIC;`);
 const deployedFinalizer = await definition();
 assert.match(deployedFinalizer, /mode = 'NORMAL' AND (s\.)?token_hash=p_session/);
 assert.match(deployedFinalizer, /SET search_path TO 'public', 'pg_catalog'/);
 const publicExecute = async () => (await db.query("SELECT count(*)::int AS n FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.finalize_package_payment(uuid,integer,text,uuid)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'")).rows[0].n;
 assert.equal(await publicExecute(),0,'kiosk deployment guard: no PUBLIC execute');
 const beforeMigration = await snapshot(), beforeAcl = await acl();
 try { await db.exec(migration); } catch (error) {
  console.error('MIGRATION BASELINE/GUARD FAILURE:', error.message);
  console.error('Installed search_path:', finalizer.match(/SET search_path[^\n]*/)?.[0]);
  await db.exec('ROLLBACK');
  assert.deepEqual(await snapshot(),beforeMigration,'failed migration must not mutate data');
  assert.equal(await definition(),deployedFinalizer);
  assert.deepEqual(await acl(),beforeAcl);
  throw new Error('Migration failed against actual baseline: '+error.message);
 }
 assert.equal(await definition(), deployedFinalizer.replace(oldGuard,() => newGuard), 'migration must change exactly one guard and nothing else');
 assert.match(await definition(), /mode = 'NORMAL' AND (s\.)?token_hash=p_session/);
 assert.equal(await publicExecute(),0);
 assert.deepEqual(await acl(),beforeAcl,'function ACL, owner, security and search path preserved');
 assert.deepEqual(await snapshot(),beforeMigration,'migration must not rewrite existing data');
 const migratedDefinition = await definition();
 await assert.rejects(db.exec(migration), /Unexpected finalizer baseline; review before migration/);
 await db.exec('ROLLBACK');
 assert.equal(await definition(),migratedDefinition);
 assert.deepEqual(await acl(),beforeAcl);
 assert.deepEqual(await snapshot(),beforeMigration,'failed rerun must leave all data unchanged');
 console.log('PASS: ninth actual migration changes exactly one guard, preserves NORMAL/ACL/data; rerun fails safely.');

 let nextMember = 3;
 const create = async (bank = '002') => {
  const member = nextMember++;
  await db.query("INSERT INTO members(id,member_code,full_name,status,role,points,expire_date) VALUES($1,$2,'SYNTHETIC UAT','ACTIVE','MEMBER',17,now()+interval '10 days')",[member,'UAT-'+member]);
  await db.query("INSERT INTO auth_sessions(member_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",[member,'uat-token-'+member]);
  const target = { ...receiver, bankCode:bank };
  if (bank === 'missing') delete target.bankCode;
  return (await db.query('SELECT * FROM create_package_payment_order($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[randomUUID(),member,'uat-token-'+member,randomUUID(),JSON.stringify(quote),JSON.stringify(target)])).rows[0];
 };
 const prepare = async (order, matchingType = 'BANK_ACCOUNT', transRef = randomUUID(), change = () => {}) => {
  const attempt = randomUUID();
  await db.query('SELECT * FROM claim_package_payment_attempt($1,$2,$3,$4,$5,false)',[order.id,order.member_id,'uat-token-'+order.member_id,attempt,'b'.repeat(64)]);
  const target = order.receiver_snapshot;
  const promptpay = matchingType === 'PROMPTPAY';
  const proof = validateSlip({ success:true,data:{ matchedAccount:{bank:{code:promptpay ? 'PROMPTPAY' : target.bankCode},bankNumber:promptpay ? target.promptpay : target.bankAccount,name:target.name},rawSlip:{transRef,date:new Date().toISOString(),amount:{amount:order.amount_satang/100},receiver:{bank:{id:target.bankCode},account:{bank:{type:'BANKAC',account:target.bankAccount},...(promptpay ? {proxy:{type:'MSISDN',account:target.promptpay}} : {})}}}}}, {...order,created_at:order.created_at.toISOString(),expires_at:order.expires_at.toISOString()});
  change(proof);
  await db.query("UPDATE package_payment_attempts SET state='VERIFIED',evidence=$2::jsonb WHERE id=$1",[attempt,JSON.stringify(proof)]);
  return {attempt,proof};
 };
 const finalize = (order,attempt) => db.query('SELECT * FROM finalize_package_payment($1,$2,$3,$4)',[order.id,order.member_id,'uat-token-'+order.member_id,attempt]);
 let settledRef;
 for (const [bank,type] of [['002','BANK_ACCOUNT'],['004','BANK_ACCOUNT'],['002','PROMPTPAY']]) {
  const order = await create(bank), {attempt,proof} = await prepare(order,type);
  const before = await state(order);
  assert.equal((await finalize(order,attempt)).rows[0].status,'PAID');
  const after = await state(order);
  assert.equal(after.member.points,before.member.points+quote.pointsEarned);
  assert.equal(after.member.expire_date.getTime()-before.member.expire_date.getTime(),quote.package.durationDays*86400000);
  assert.equal(after.current.amount_satang,quote.amountSatang);
  assert.deepEqual(after.counts,{checkins:0,coupons:2,ledger:1,refs:1,paid_amount:String(quote.amountSatang)});
  const allAfter = await snapshot();
  await finalize(order,attempt);
  assert.deepEqual(await snapshot(),allAfter,'replay must not mutate any settlement data');
  settledRef = proof.transRef;
  console.log(`PASS: ${bank} ${type} settles once and replay is mutation-free.`);
 }
 const cases = [
  ['wrong evidence bank', p => {p.bankCode='004';}],
  ['wrong identity bank', p => {p.receiverIdentity.bankCode='004';}],
  ['wrong full account', p => {p.receiverIdentity.bankAccount='9994567890';}],
  ['wrong receiver name', p => {p.receiverIdentity.name='WRONG PERSON';}],
  ['wrong expected name', p => {p.receiverIdentity.expectedName='WRONG PERSON';}],
  ['wrong normalized name', p => {p.receiverIdentity.normalizedName='WRONGPERSON';}],
  ['wrong order id', p => {p.orderId=randomUUID();}],
  ['wrong amount', p => {p.amountSatang++;}],
 ];
 for (const [label,change] of cases) {
  const order = await create(), {attempt} = await prepare(order,'BANK_ACCOUNT',randomUUID(),change);
  const before = await snapshot();
  await assert.rejects(finalize(order,attempt),/Invalid payment evidence/,label);
  assert.deepEqual(await snapshot(),before,label+' must not mutate anything');
 }
 for (const bank of ['02','ABC','',null,'missing']) {
  // Malformed snapshots are deliberately sent directly to SQL, bypassing TS validation.
  const order = await create();
  const {proof} = await prepare(order);
  // Use a separate member and the creation RPC, never disable order guards.
  const malformed = await create(bank);
  const malformedAttempt = randomUUID();
  await db.query('SELECT * FROM claim_package_payment_attempt($1,$2,$3,$4,$5,false)',[malformed.id,malformed.member_id,'uat-token-'+malformed.member_id,malformedAttempt,'c'.repeat(64)]);
  proof.orderId=malformed.id; proof.bankCode=bank; proof.receiverIdentity.bankCode=bank;
  if (bank==='missing') {delete proof.bankCode; delete proof.receiverIdentity.bankCode;}
  await db.query("UPDATE package_payment_attempts SET state='VERIFIED',evidence=$2::jsonb WHERE id=$1",[malformedAttempt,JSON.stringify(proof)]);
  const before = await snapshot();
  await assert.rejects(finalize(malformed,malformedAttempt),/Invalid payment evidence/,'invalid/missing snapshot bank');
  assert.deepEqual(await snapshot(),before);
 }
 const kiosk = await create(), kioskProof = await prepare(kiosk);
 await db.query("UPDATE auth_sessions SET mode='KIOSK',device_id='isolated' WHERE member_id=$1",[kiosk.member_id]);
 const beforeKiosk = await snapshot();
 await assert.rejects(finalize(kiosk,kioskProof.attempt),/Unauthorized/);
 assert.deepEqual(await snapshot(),beforeKiosk);
 const duplicate = await create(), duplicateProof = await prepare(duplicate,'BANK_ACCOUNT',settledRef);
 const beforeDuplicate = await state(duplicate);
 const duplicateResult = (await finalize(duplicate,duplicateProof.attempt)).rows[0];
 assert.equal(duplicateResult.status,'REJECTED');
 assert.equal(duplicateResult.rejection_reason,'DUPLICATE_TRANS_REF');
 const afterDuplicate = await state(duplicate);
 assert.deepEqual(afterDuplicate.member,beforeDuplicate.member);
 assert.deepEqual(afterDuplicate.counts,beforeDuplicate.counts);
 const rejectedState = await snapshot();
 await finalize(duplicate,duplicateProof.attempt);
 assert.deepEqual(await snapshot(),rejectedState,'duplicate replay must not award points/coupons');
 console.log('PASS: SQL refuses wrong bank/account/name/order/amount, malformed bank snapshots and KIOSK without mutation; global duplicate ref awards no points/coupons.');
 console.log('PASS: all 9 actual migrations tested in isolated in-memory PGlite; no live DB, secrets or provider calls.');
} finally { await db.close(); }
