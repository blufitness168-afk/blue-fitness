// Synthetic in-memory PostgreSQL only: no env loading, network or real DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const { PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('R2 actual additive profile SQL', { timeout: 120000 }, async t => {
 const db = new PGlite();
 const rows = async (sql, args=[]) => (await db.query(sql,args)).rows;
 const one = async (sql, args=[]) => (await rows(sql,args))[0];
 const snap = async (id=3) => (await one('SELECT admin_member_profile_snapshot(m) AS p FROM members m WHERE id=$1',[id])).p;
 const count = async () => (await one('SELECT count(*)::int AS n FROM admin_member_profile_audit')).n;
 const action = async (payload,key=randomUUID(),token='token-2') => (await one('SELECT admin_member_profile_update($1,$2,$3::jsonb) AS r',[token,key,JSON.stringify(payload)])).r;
 const rollback = async fn => { await db.exec('BEGIN'); try { await fn(); } finally { await db.exec('ROLLBACK'); } };
 const payload = async (id=3) => ({ memberCode:`R2-${id}`,expected:await snap(id),reason:'Synthetic correction',profile:{
  fullName:'Synthetic Updated',nickname:'New',gender:'FEMALE',birthDay:29,birthMonth:2,
  emergencyName:'Synthetic Contact',emergencyPhone:'0812345678',emergencyRelation:'Sibling',
 }});
 try {
  // Columns/types mirror current schema; unrelated values intentionally populated to detect drift.
  await db.exec(`
   CREATE TYPE member_role AS ENUM ('MEMBER','ADMIN','OWNER');
   CREATE TYPE member_status AS ENUM ('PENDING','ACTIVE','EXPIRED','SUSPENDED');
   CREATE TYPE profile_gender AS ENUM ('MALE','FEMALE','OTHER');
   CREATE TABLE members(id serial PRIMARY KEY,member_code varchar(50) UNIQUE NOT NULL,full_name text NOT NULL,
    nickname text,gender profile_gender NOT NULL DEFAULT 'OTHER',birth_day integer,birth_month integer,
    emergency_name text,emergency_phone varchar(20),emergency_relation text,
    phone varchar(20) UNIQUE NOT NULL,password_hash text,avatar_url text,avatar_changed boolean NOT NULL DEFAULT false,
    role member_role NOT NULL,status member_status NOT NULL,expire_date timestamptz,points integer NOT NULL DEFAULT 0,
    line_user_id varchar(100),is_first_registration boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
   CREATE TABLE auth_sessions(id serial PRIMARY KEY,member_id integer REFERENCES members(id),token_hash text UNIQUE,
    mode text NOT NULL DEFAULT 'NORMAL',device_id text,expires_at timestamptz,revoked_at timestamptz);
   CREATE TABLE synthetic_finance(id integer PRIMARY KEY,amount_satang integer,payload jsonb);
   INSERT INTO members(member_code,full_name,phone,password_hash,role,status,points,expire_date,avatar_url)
    SELECT 'R2-'||i,'Synthetic Original','080000000'||i,'SECRET_SENTINEL',
     (CASE WHEN i=1 THEN 'OWNER' WHEN i IN (2,4) THEN 'ADMIN' ELSE 'MEMBER' END)::member_role,
     'ACTIVE',77,'2027-01-01','https://offline.invalid/avatar' FROM generate_series(1,5) i;
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'token-'||id,now()+interval '1 day' FROM members;
   INSERT INTO synthetic_finance VALUES(1,123456,'{"provider":"SECRET_FINANCE"}');
  `);
  const original = await rows('SELECT * FROM members ORDER BY id');
  const finance = await rows('SELECT * FROM synthetic_finance');
  await db.exec(read('../db/migrations/20261118_R2_admin_member_profile.sql'));
  await t.test('migration is additive: existing profiles and finance unchanged, audit empty',async()=>{
   assert.deepEqual(await rows('SELECT * FROM members ORDER BY id'),original);
   assert.deepEqual(await rows('SELECT * FROM synthetic_finance'),finance);
   assert.equal(await count(),0);
  });
  await t.test('SQL rejects missing/member sessions, revoked/expired/KIOSK/suspended/demoted actor',async()=>{
   const p=await payload();
   for(const token of ['missing','token-3']) await assert.rejects(action(p,randomUUID(),token),{code:'42501'});
   for(const change of [
    "UPDATE auth_sessions SET mode='KIOSK',device_id='offline' WHERE member_id=2",
    "UPDATE auth_sessions SET revoked_at=now() WHERE member_id=2",
    "UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE member_id=2",
    "UPDATE members SET status='SUSPENDED' WHERE id=2",
    "UPDATE members SET role='MEMBER' WHERE id=2",
   ]) await rollback(async()=>{await db.exec(change);await assert.rejects(action(p),{code:'42501'});});
   assert.equal(await count(),0);
  });
  await t.test('ADMIN only MEMBER, OWNER MEMBER/ADMIN but never OWNER; no role escalation',async()=>{
   for(const id of [1,2,4]) await assert.rejects(action(await payload(id)),{code:'42501'});
   await assert.rejects(action(await payload(1),randomUUID(),'token-1'),{code:'42501'});
   await assert.rejects(action({...await payload(),memberCode:'missing'}),{code:'42501'});
   for(const [id,token] of [[3,'token-2'],[3,'token-1'],[4,'token-1']]) await rollback(async()=>{
    assert.deepEqual(await action(await payload(id),randomUUID(),token),{ok:true});
    assert.equal((await one('SELECT role FROM members WHERE id=$1',[id])).role,id===4?'ADMIN':'MEMBER');
   });
  });
  await t.test('SQL rejects spoofed/unknown fields at every level, no phone/role/expiry/year/finance',async()=>{
   const p=await payload();
   for(const [key,value] of Object.entries({phone:'0899999999',role:'OWNER',expireDate:'2099-01-01',points:999,
    email:'x@offline.invalid',person_type:'staff',password:'x',avatar:'x',card:'x',birthYear:2000,amount:1,actorId:1})) {
    for(const body of [{...p,[key]:value},{...p,profile:{...p.profile,[key]:value}},{...p,expected:{...p.expected,[key]:value}}])
     await assert.rejects(action(body),{code:'22023'});
   }
   for(const body of [{...p,profile:null},{...p,expected:[]},{...p,reason:''},{...p,reason:' '.repeat(3)},
    {...p,reason:'x'.repeat(241)},{...p,profile:{...p.profile,fullName:'X'}},{...p,profile:{...p.profile,gender:'UNKNOWN'}}])
    await assert.rejects(action(body),{code:'22023'});
   assert.equal(await count(),0);
  });
  await t.test('dates: leap day accepted without year; impossible/fractional/null/string dates rejected',async()=>{
   const p=await payload();
   for(const [birthDay,birthMonth] of [[31,4],[30,2],[0,1],[32,1],[1,0],[1,13],[1.5,2],[null,2],['29',2]])
    await assert.rejects(action({...p,profile:{...p.profile,birthDay,birthMonth}}),{code:'22023'});
   await rollback(async()=>{
    await action(p);
    const after=await snap(); assert.equal(after.birthDay,29);assert.equal(after.birthMonth,2);
    assert.deepEqual(Object.keys(after).sort(),Object.keys(p.profile).sort());
   });
  });
  await t.test('emergency phone optional empty, valid 9/10 digits only; registration text limits',async()=>{
   const p=await payload();
   for(const emergencyPhone of ['123456789','+66812345678','081-234-5678','08123456','08123456789'])
    await assert.rejects(action({...p,profile:{...p.profile,emergencyPhone}}),{code:'22023'});
   for(const [field,max] of [['fullName',100],['nickname',50],['emergencyName',100],['emergencyRelation',50]])
    await assert.rejects(action({...p,profile:{...p.profile,[field]:'x'.repeat(max+1)}}),{code:'22023'});
   for(const emergencyPhone of ['','021234567','0812345678']) await rollback(async()=>{
    await action({...p,profile:{...p.profile,emergencyPhone}});assert.equal((await snap()).emergencyPhone,emergencyPhone);
   });
  });
  await t.test('stale comparison exact/null-aware, winner preserved; changes unrelated to profile do not cause stale',async()=>{
   const p=await payload();
   await rollback(async()=>{
    await db.exec("UPDATE members SET nickname='' WHERE id=3");
    await assert.rejects(action(p),/Stale profile/);
   });
   await rollback(async()=>{
    await db.exec('UPDATE members SET points=78 WHERE id=3');
    await action(p);assert.equal((await one('SELECT points FROM members WHERE id=3')).points,78);
   });
   await rollback(async()=>{
    await action(p);await assert.rejects(action({...p,profile:{...p.profile,nickname:'Loser'}}),/Stale profile/);
   });
  });
  await t.test('same UUID same payload replay once; changed reason/profile/expected/target conflicts; revoked replay denied',async()=>{
   const p=await payload(), key=randomUUID();
   const result=await action(p,key);assert.deepEqual(result,{ok:true});
   const after=await rows('SELECT * FROM members ORDER BY id');
   for(let i=0;i<3;i++) assert.deepEqual(await action(p,key),result);
   assert.deepEqual(await rows('SELECT * FROM members ORDER BY id'),after);assert.equal(await count(),1);
   for(const body of [{...p,reason:'Different'},{...p,profile:{...p.profile,nickname:'Other'}},
    {...p,expected:{...p.expected,nickname:''}},{...p,memberCode:'R2-5'}])
    await assert.rejects(action(body,key),/Request key conflict/);
   const audit=await one('SELECT * FROM admin_member_profile_audit');
   assert.equal(audit.actor_id,2);assert.equal(audit.actor_role,'ADMIN');assert.equal(audit.member_id,3);
   assert.equal(audit.request_key,key);assert.equal(audit.reason,p.reason);assert.match(audit.payload_hash,/^[a-f0-9]{64}$/);
   assert.deepEqual(audit.before_profile,p.expected);assert.deepEqual(audit.after_profile,p.profile);
   assert.doesNotMatch(JSON.stringify(audit),/SECRET|token-|password|phone_hash|provider/);
   await rollback(async()=>{await db.exec('UPDATE auth_sessions SET revoked_at=now() WHERE member_id=2');await assert.rejects(action(p,key),{code:'42501'});});
   await rollback(async()=>{await db.exec("UPDATE members SET role='ADMIN' WHERE id=3");await assert.rejects(action(p,key),{code:'42501'});});
  });
  await t.test('audit append-only UPDATE/DELETE/TRUNCATE and denied PUBLIC ACL',async()=>{
   for(const sql of ["UPDATE admin_member_profile_audit SET reason='changed'",'DELETE FROM admin_member_profile_audit','TRUNCATE admin_member_profile_audit'])
    await assert.rejects(db.exec(sql),/append-only/);
   const acl=await one("SELECT relacl::text AS acl FROM pg_class WHERE oid='admin_member_profile_audit'::regclass");
   assert.doesNotMatch(acl.acl,/[,\{]=/);
   const fn=await one("SELECT prosecdef,proacl::text AS acl FROM pg_proc WHERE oid='admin_member_profile_update(text,uuid,jsonb)'::regprocedure");
   assert.equal(fn.prosecdef,false);assert.doesNotMatch(fn.acl,/[,\{]=/);
  });
  await t.test('failure inserting audit rolls back member update and request; explicit transaction rollback too',async()=>{
   const before=await rows('SELECT * FROM members ORDER BY id'), n=await count(), p=await payload(), key=randomUUID();
   await db.exec("CREATE FUNCTION r2_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$; CREATE TRIGGER r2_fail BEFORE INSERT ON admin_member_profile_audit FOR EACH ROW EXECUTE FUNCTION r2_fail();");
   await assert.rejects(action(p,key),/injected audit failure/);
   assert.deepEqual(await rows('SELECT * FROM members ORDER BY id'),before);assert.equal(await count(),n);
   await db.exec('DROP TRIGGER r2_fail ON admin_member_profile_audit; DROP FUNCTION r2_fail()');
   await rollback(async()=>{await action(p,key);assert.equal(await count(),n+1);});
   assert.deepEqual(await rows('SELECT * FROM members ORDER BY id'),before);assert.equal(await count(),n);
  });
  await t.test('only allowed profile fields + updated_at changed; other members and finance remain identical',async()=>{
   const after=await rows('SELECT * FROM members ORDER BY id');
   const allowed=new Set(['full_name','nickname','gender','birth_day','birth_month','emergency_name','emergency_phone','emergency_relation','updated_at']);
   for(let i=0;i<original.length;i++) for(const key of Object.keys(original[i]))
    if(i!==2 || !allowed.has(key)) assert.deepEqual(after[i][key],original[i][key],`member ${i+1} ${key}`);
   assert.deepEqual(await rows('SELECT * FROM synthetic_finance'),finance);
   assert.equal(await count(),1);
  });
 } finally { await db.close(); }
});

test('R2 alongside actual existing payment/finance/R3-R7 migrations: no financial or entitlement mutations', {timeout:120000},async()=>{
 const db=new PGlite();
 const rows=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const one=async(sql,args=[]) => (await rows(sql,args))[0];
 try {
  const fixture=read('./package-payment-benefits.test.mjs').match(/await db\.exec\(`([\s\S]*?)`\);/);
  assert.ok(fixture);await db.exec(fixture[1]);
  await db.exec(`CREATE TYPE profile_gender AS ENUM ('MALE','FEMALE','OTHER');
   ALTER TABLE members ADD COLUMN nickname text, ADD COLUMN gender profile_gender NOT NULL DEFAULT 'OTHER',
   ADD COLUMN birth_day integer, ADD COLUMN birth_month integer, ADD COLUMN emergency_name text,
   ADD COLUMN emergency_phone varchar(20), ADD COLUMN emergency_relation text;`);
  for(const name of ['20261009_real_package_payments','20261010_payment_promptpay','20261024_kiosk',
   '20261024_real_benefits_admin','20261024_real_rewards','20261024_real_frontdesk','20261024_real_finance','20261025_package_payment_benefits'])
   await db.exec(read(`../db/migrations/${name}.sql`));
  await db.exec(`DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature); EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_catalog',f.signature); END LOOP; END $$;`);
  for(const name of ['20261031_payment_receiver_bank','20261031_payment_currency_recheck','20261031_package_catalog','20261031_package_catalog_order_guard',
   '20261118_r3_package_catalog','20261118_r3_package_catalog_checkin','20261118_R4_online_provenance','20261118_R5_finance','20261118_R6_time_supplement','20261118_R7_visits'])
   await db.exec(read(`../db/migrations/${name}.sql`));
  await db.exec(`INSERT INTO members(member_code,full_name,status,role) SELECT 'R2-'||i,'SYNTHETIC','EXPIRED',CASE WHEN i=1 THEN 'OWNER' WHEN i=2 THEN 'ADMIN' ELSE 'MEMBER' END FROM generate_series(1,3) i;
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'r2-chain-'||id,now()+interval '1 day' FROM members;`);
  const receiver={promptpay:'0890000000',bankCode:'002',bankAccount:'1234567890',name:'SYNTHETIC'};
  const order=await one('SELECT * FROM create_catalog_package_payment_order($1,3,$2,$3,$4::jsonb,$5::jsonb)',
   [randomUUID(),'r2-chain-3',randomUUID(),JSON.stringify({package:{id:2,catalogVersion:1}}),JSON.stringify(receiver)]);
  const attempt=randomUUID();
  await db.query('SELECT * FROM claim_package_payment_attempt($1,3,$2,$3,$4,false)',[order.id,'r2-chain-3',attempt,'a'.repeat(64)]);
  const proof={transRef:randomUUID(),paidAt:new Date(Date.now()-60000).toISOString(),amountSatang:order.amount_satang,
   bankCode:'002',receiverEvidence:'REGISTERED_ACCOUNT_V2',providerStrategy:'EASYSLIP_V2_REGISTERED_ACCOUNT',orderId:order.id,
   receiverIdentity:{matchingType:'BANK_ACCOUNT',bankCode:'002',bankAccount:'1234567890',name:'SYNTHETIC',expectedName:'SYNTHETIC',normalizedName:'SYNTHETIC'}};
  await db.query("UPDATE package_payment_attempts SET state='VERIFIED',evidence=$2::jsonb WHERE id=$1",[attempt,JSON.stringify(proof)]);
  assert.equal((await one('SELECT * FROM finalize_package_payment($1,3,$2,$3)',[order.id,'r2-chain-3',attempt])).status,'PAID');
  await db.query("SELECT real_finance_action('r2-chain-1','create',$1,$2::jsonb)",[randomUUID(),JSON.stringify({date:'2026-11-18',type:'EXPENSE',category:'เงินเดือน',amountSatang:10000,note:'Synthetic fixture'})]);
  const tables=['package_payment_orders','package_payment_attempts','package_payment_point_ledger','coupons','entitlement_online_observations',
   'finance_entries','finance_action_requests','finance_audit','time_supplement_grants','time_supplement_activations','time_supplement_requests','r7_visits','checkins','auth_sessions'];
  const effects=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,await rows(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)])));
  const before=await effects(), members=await rows('SELECT * FROM members ORDER BY id');
  await db.exec(read('../db/migrations/20261118_R2_admin_member_profile.sql'));
  assert.deepEqual(await effects(),before);assert.deepEqual(await rows('SELECT * FROM members ORDER BY id'),members);
  const expected=(await one('SELECT admin_member_profile_snapshot(m) p FROM members m WHERE id=3')).p;
  const profile={fullName:'SYNTHETIC Corrected',nickname:'',gender:'MALE',birthDay:29,birthMonth:2,emergencyName:'',emergencyPhone:'',emergencyRelation:''};
  const key=randomUUID(), payload={memberCode:'R2-3',expected,profile,reason:'Offline regression'};
  for(let i=0;i<2;i++) assert.deepEqual((await one("SELECT admin_member_profile_update('r2-chain-2',$1,$2::jsonb) r",[key,JSON.stringify(payload)])).r,{ok:true});
  assert.deepEqual(await effects(),before);
  const after=await rows('SELECT * FROM members ORDER BY id');
  assert.deepEqual(after.slice(0,2),members.slice(0,2));
  for(const field of ['phone','role','status','expire_date','points','avatar_url'])assert.deepEqual(after[2][field],members[2][field],field);
  assert.equal((await one('SELECT count(*)::int n FROM admin_member_profile_audit')).n,1);
 } finally {await db.close();}
});
