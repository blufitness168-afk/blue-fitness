// Actual new SQL on isolated PGlite; no env, network, production DB or providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const { PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite');
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

test('R2 contact email: actual additive migration and atomic actions', { timeout: 120000 }, async t => {
 const db = new PGlite();
 const rows = async (s,a=[]) => (await db.query(s,a)).rows;
 const one = async (s,a=[]) => (await rows(s,a))[0];
 const payload = (patch={}) => ({memberCode:'CE-3',email:'contact@example.com',expectedVersion:0,reason:'Synthetic correction',...patch});
 const action = async (p=payload(),key=randomUUID(),token='s2') => (await one('SELECT member_contact_email_update($1,$2,$3::jsonb) AS r',[token,key,JSON.stringify(p)])).r;
 const contact = async (code='CE-3',token='s2') => (await one('SELECT member_contact_email_read($1,$2) AS r',[token,code])).r;
 const rollback = async fn => { await db.exec('BEGIN');try { await fn(); } finally { await db.exec('ROLLBACK'); } };
 const count = async () => (await one('SELECT count(*)::int AS n FROM member_contact_email_audit')).n;
 try {
  // Reuse the installed real-module harness schema (same members/session types as profile slice).
  const profileTest = read('./admin-member-profile.test.mjs');
  const fixture = profileTest.slice(profileTest.indexOf('CREATE TYPE member_role'),profileTest.indexOf('  `);'));
  await db.exec(fixture.replaceAll('R2-','CE-').replaceAll('token-','s'));
  const beforeMembers = await rows('SELECT * FROM members ORDER BY id');
  const beforeSessions = await rows('SELECT * FROM auth_sessions ORDER BY id');
  const beforeMoney = await rows('SELECT * FROM synthetic_finance');
  await db.exec(read('../db/migrations/20261118_R2_member_contact_email.sql'));
  await t.test('absent contact = null/version 0, no backfill or existing mutations',async()=>{
   assert.deepEqual(await contact(),{email:null,version:0});assert.equal(await count(),0);
   assert.deepEqual(await rows('SELECT * FROM members ORDER BY id'),beforeMembers);
  });
  await t.test('live persisted NORMAL staff guard for both read and write',async()=>{
   for(const token of ['missing','s3']) {
    await assert.rejects(action(payload(),randomUUID(),token),{code:'42501'});
    await assert.rejects(contact('CE-3',token),{code:'42501'});
   }
   for(const sql of ["UPDATE auth_sessions SET mode='KIOSK' WHERE member_id=2",
    'UPDATE auth_sessions SET revoked_at=now() WHERE member_id=2',
    "UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE member_id=2",
    'UPDATE auth_sessions SET expires_at=NULL WHERE member_id=2',
    "UPDATE members SET status='SUSPENDED' WHERE id=2","UPDATE members SET role='MEMBER' WHERE id=2"])
    await rollback(async()=>{await db.exec(sql);await assert.rejects(action(),{code:'42501'});});
  });
  await t.test('ADMIN -> MEMBER; OWNER -> MEMBER/ADMIN only, same rules for reads',async()=>{
   for(const code of ['CE-1','CE-2','CE-4','missing']) {
    await assert.rejects(action(payload({memberCode:code})),{code:'42501'});
    await assert.rejects(contact(code),{code:'42501'});
   }
   await assert.rejects(contact('CE-1','s1'),{code:'42501'});
   for(const code of ['CE-3','CE-4'])await rollback(async()=>{
    assert.deepEqual(await action(payload({memberCode:code}),randomUUID(),'s1'),{ok:true});
    assert.equal((await contact(code,'s1')).email,'contact@example.com');
   });
  });
  await t.test('strict SQL payload/email validation, ASCII canonical only, no spoofed actor/auth/finance',async()=>{
   for(const field of ['actorId','role','phone','password','personType','amount','verified','version'])
    await assert.rejects(action(payload({[field]:'spoof'})),{code:'22023'});
   for(const email of ['', ' Mixed@example.com ', 'Mixed@example.com','a..b@example.com','.a@example.com',
    'a.@example.com','a@b','a@bad_domain.com','a@-bad.com','อีเมล@example.com','a@example.com\n',42,{},'x'.repeat(255)+'@example.com'])
    await assert.rejects(action(payload({email})),{code:'22023'});
   for(const patch of [{expectedVersion:-1},{expectedVersion:0.5},{expectedVersion:'0'},
    {expectedVersion:2147483647},{reason:''},{reason:'x'.repeat(241)},{email:undefined}])
    await assert.rejects(action(payload(patch)),{code:'22023'});
   await assert.rejects(action(payload(),null),{code:'22023'});
  });
  await t.test('same UUID same canonical payload replays, conflict/stale rejected; audit immutable',async()=>{
   const p=payload(),key=randomUUID();
   assert.deepEqual(await action(p,key),{ok:true});
   assert.deepEqual(await action(p,key),{ok:true});assert.equal(await count(),1);
   await assert.rejects(action({...p,reason:'different'},key),{code:'P0001'});
   await assert.rejects(action(p),{code:'P0001'});
   const audit=await one('SELECT * FROM member_contact_email_audit');
   assert.equal(audit.before_email,null);assert.equal(audit.after_email,p.email);
   assert.equal(audit.before_version,0);assert.equal(audit.after_version,1);assert.equal(audit.actor_id,2);
   assert.doesNotMatch(JSON.stringify(audit),/SECRET|scrypt|token_hash|password_hash|provider/);
   for(const sql of ['UPDATE member_contact_email_audit SET reason=\'changed\'','DELETE FROM member_contact_email_audit','TRUNCATE member_contact_email_audit'])
    await assert.rejects(db.exec(sql),/append-only/);
  });
  await t.test('shared canonical email keeps member updates, versions, replay and audit independent',async()=>{
   const n=await count(),p=payload({memberCode:'CE-5'}),key=randomUUID();
   assert.deepEqual(await action(p,key),{ok:true});
   assert.deepEqual(await contact(),{email:p.email,version:1});
   assert.deepEqual(await contact('CE-5'),{email:p.email,version:1});
   await assert.rejects(action({...p,memberCode:'CE-3'},key),{code:'P0001'});
   await action({...p,email:'other@example.com',expectedVersion:1});
   await action({...p,email:null,expectedVersion:2});
   await action({...p,expectedVersion:3});
   assert.deepEqual(await action(p,key),{ok:true});
   assert.deepEqual(await contact('CE-5'),{email:p.email,version:4});
   assert.deepEqual(await contact(),{email:p.email,version:1});
   await assert.rejects(action({...p,expectedVersion:1}),{code:'P0001'});
   assert.equal(await count(),n+4);
   const audit=await rows('SELECT member_id,before_email,after_email,before_version,after_version FROM member_contact_email_audit WHERE member_id=5 ORDER BY id');
   assert.deepEqual(audit,[
    {member_id:5,before_email:null,after_email:p.email,before_version:0,after_version:1},
    {member_id:5,before_email:p.email,after_email:'other@example.com',before_version:1,after_version:2},
    {member_id:5,before_email:'other@example.com',after_email:null,before_version:2,after_version:3},
    {member_id:5,before_email:null,after_email:p.email,before_version:3,after_version:4},
   ]);
  });
  await t.test('null allowed across members, increments revision even A -> null -> A',async()=>{
   await action(payload({email:null,expectedVersion:1}));
   await action(payload({memberCode:'CE-5',email:null,expectedVersion:4}));
   await action(payload({expectedVersion:2}));
   assert.deepEqual(await contact(),{email:'contact@example.com',version:3});
   await assert.rejects(action(payload({expectedVersion:1})),{code:'P0001'});
  });
  await t.test('audit insertion failure rolls back contact row/version and key remains retryable',async()=>{
   await db.exec("CREATE FUNCTION synthetic_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER synthetic_fail BEFORE INSERT ON member_contact_email_audit FOR EACH ROW EXECUTE FUNCTION synthetic_fail_audit();");
   const p=payload({email:'new@example.com',expectedVersion:3}),key=randomUUID(),n=await count();
   await assert.rejects(action(p,key),/synthetic audit failure/);
   assert.deepEqual(await contact(),{email:'contact@example.com',version:3});assert.equal(await count(),n);
   await db.exec('DROP TRIGGER synthetic_fail ON member_contact_email_audit');
   await action(p,key);assert.equal((await contact()).version,4);
  });
  await t.test('no auth/session/member/financial changes; PUBLIC has no new access',async()=>{
   assert.deepEqual(await rows('SELECT * FROM members ORDER BY id'),beforeMembers);
   assert.deepEqual(await rows('SELECT * FROM auth_sessions ORDER BY id'),beforeSessions);
   assert.deepEqual(await rows('SELECT * FROM synthetic_finance'),beforeMoney);
   const acl=await rows("SELECT relacl::text AS acl FROM pg_class WHERE relname IN ('member_contact_details','member_contact_email_audit')");
   for(const r of acl)assert.doesNotMatch(r.acl ?? '',/(^|,)=[^,]*[rawdDxt]/);
  });
 } finally { await db.close(); }
});

test('contact SQL alongside actual payment/finance/R3-R7/profile/password migrations', {timeout:120000}, async()=>{
 const db=new PGlite();
 const rows=async(s,a=[]) => (await db.query(s,a)).rows;
 const one=async(s,a=[]) => (await rows(s,a))[0];
 try {
  const fixture=read('./package-payment-benefits.test.mjs').match(/await db\.exec\(`([\s\S]*?)`\);/);
  assert.ok(fixture);await db.exec(fixture[1]);
  await db.exec(`CREATE TYPE profile_gender AS ENUM ('MALE','FEMALE','OTHER');
   ALTER TABLE members ADD COLUMN nickname text, ADD COLUMN gender profile_gender NOT NULL DEFAULT 'OTHER',
   ADD COLUMN birth_day integer, ADD COLUMN birth_month integer, ADD COLUMN emergency_name text,
   ADD COLUMN emergency_phone varchar(20), ADD COLUMN emergency_relation text,
      ADD COLUMN password_hash text;
      CREATE TABLE auth_otp_challenges(id serial PRIMARY KEY,phone text,purpose text,consumed_at timestamptz);
      CREATE TABLE auth_password_tickets(id serial PRIMARY KEY,phone text,purpose text,consumed_at timestamptz);`);
  for(const name of ['20261009_real_package_payments','20261010_payment_promptpay','20261024_kiosk',
   '20261024_real_benefits_admin','20261024_real_rewards','20261024_real_frontdesk','20261024_real_finance','20261025_package_payment_benefits'])
   await db.exec(read(`../db/migrations/${name}.sql`));
  await db.exec(`DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature); EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_catalog',f.signature); END LOOP; END $$;`);
  for(const name of ['20261031_payment_receiver_bank','20261031_payment_currency_recheck','20261031_package_catalog','20261031_package_catalog_order_guard',
   '20261118_r3_package_catalog','20261118_r3_package_catalog_checkin','20261118_R4_online_provenance','20261118_R5_finance','20261118_R6_time_supplement','20261118_R7_visits',
   '20261118_R2_admin_member_profile','20261118_R2_admin_member_password'])
   await db.exec(read(`../db/migrations/${name}.sql`));
  await db.exec(`INSERT INTO members(member_code,full_name,status,role) SELECT 'CE-'||i,'SYNTHETIC','EXPIRED',CASE WHEN i=1 THEN 'OWNER' WHEN i=2 THEN 'ADMIN' ELSE 'MEMBER' END FROM generate_series(1,3) i;
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'ce-chain-'||id,now()+interval '1 day' FROM members;`);
  const receiver={promptpay:'0890000000',bankCode:'002',bankAccount:'1234567890',name:'SYNTHETIC'};
  const order=await one('SELECT * FROM create_catalog_package_payment_order($1,3,$2,$3,$4::jsonb,$5::jsonb)',
   [randomUUID(),'ce-chain-3',randomUUID(),JSON.stringify({package:{id:2,catalogVersion:1}}),JSON.stringify(receiver)]);
  const attempt=randomUUID();
  await db.query('SELECT * FROM claim_package_payment_attempt($1,3,$2,$3,$4,false)',[order.id,'ce-chain-3',attempt,'a'.repeat(64)]);
  const proof={transRef:randomUUID(),paidAt:new Date(Date.now()-60000).toISOString(),amountSatang:order.amount_satang,
   bankCode:'002',receiverEvidence:'REGISTERED_ACCOUNT_V2',providerStrategy:'EASYSLIP_V2_REGISTERED_ACCOUNT',orderId:order.id,
   receiverIdentity:{matchingType:'BANK_ACCOUNT',bankCode:'002',bankAccount:'1234567890',name:'SYNTHETIC',expectedName:'SYNTHETIC',normalizedName:'SYNTHETIC'}};
  await db.query("UPDATE package_payment_attempts SET state='VERIFIED',evidence=$2::jsonb WHERE id=$1",[attempt,JSON.stringify(proof)]);
  assert.equal((await one('SELECT * FROM finalize_package_payment($1,3,$2,$3)',[order.id,'ce-chain-3',attempt])).status,'PAID');
  await db.query("SELECT real_finance_action('ce-chain-1','create',$1,$2::jsonb)",[randomUUID(),JSON.stringify({date:'2026-11-18',type:'EXPENSE',category:'เงินเดือน',amountSatang:10000,note:'Synthetic fixture'})]);
  const tables=['members','auth_sessions','auth_otp_challenges','auth_password_tickets','admin_member_profile_audit','admin_member_password_audit',
   'package_payment_orders','package_payment_attempts','package_payment_point_ledger','coupons','entitlement_online_observations',
   'finance_entries','finance_action_requests','finance_audit','time_supplement_grants','time_supplement_activations','time_supplement_requests','r7_visits','checkins'];
  const effects=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,await rows(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)])));
  const before=await effects();
  await db.exec(read('../db/migrations/20261118_R2_member_contact_email.sql'));
  assert.deepEqual(await effects(),before);
  const p={memberCode:'CE-3',expectedVersion:0,email:'contact@example.com',reason:'Offline regression'},key=randomUUID();
  for(let i=0;i<2;i++)assert.deepEqual((await one("SELECT member_contact_email_update('ce-chain-2',$1,$2::jsonb) r",[key,JSON.stringify(p)])).r,{ok:true});
  assert.deepEqual(await effects(),before);
  assert.equal((await one('SELECT count(*)::int n FROM member_contact_email_audit')).n,1);
 } finally {await db.close();}
});
