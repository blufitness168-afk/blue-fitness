// Isolated PostgreSQL WASM only: no production database, SMS or payment provider.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../.local-db/payment-sql-tests/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
try {
 await db.exec(`
 CREATE TABLE members(id serial PRIMARY KEY,member_code text UNIQUE, full_name text,avatar_url text,phone text,status text,role text,expire_date timestamptz,points integer DEFAULT 0);
 CREATE TABLE auth_sessions(id serial PRIMARY KEY,member_id integer REFERENCES members(id),token_hash text,expires_at timestamptz,revoked_at timestamptz);
 CREATE TABLE coupons(id serial PRIMARY KEY,member_id integer,type text,source text,status text,total_quota integer,used_count integer,created_at timestamptz,expire_date timestamptz);
 CREATE TABLE checkins(id serial PRIMARY KEY,member_id integer,scanner_type text,scanner_device_id text,points_awarded integer,notes text,checkin_time timestamptz DEFAULT now());
 CREATE TABLE package_payment_orders(id uuid PRIMARY KEY,member_id integer,status text,package_snapshot jsonb,paid_at timestamptz,created_at timestamptz);
 CREATE FUNCTION finalize_package_payment(p_session text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM auth_sessions s WHERE s.token_hash=p_session AND s.revoked_at IS NULL) $$;
 CREATE FUNCTION kiosk_test_now() RETURNS timestamptz LANGUAGE sql AS $$ SELECT current_setting('kiosk.test_now')::timestamptz $$;
 SET kiosk.test_now='2026-10-24T03:00:00Z';
 INSERT INTO members(member_code,full_name,status,role) VALUES('BLU-1','Staff','ACTIVE','ADMIN'),('BLU-2','Welcome','PENDING','MEMBER'),('BLU-3','Expired','EXPIRED','MEMBER'),('BLU-4','No rights','ACTIVE','MEMBER'),('BLU-5','Other welcome','PENDING','MEMBER');
 INSERT INTO auth_sessions(member_id,token_hash,expires_at) VALUES(1,'staff','2026-10-25'),(1,'other-session','2026-10-25');
 INSERT INTO coupons(member_id,type,source,status,total_quota,used_count,created_at,expire_date) VALUES(2,'FREE_ENTRY','WELCOME_REGISTRATION','AVAILABLE',1,0,'2026-10-24','2026-10-25'),(3,'FREE_ENTRY','WELCOME_REGISTRATION','AVAILABLE',1,0,'2026-08-01','2026-09-01'),(5,'FREE_ENTRY','WELCOME_REGISTRATION','AVAILABLE',1,0,'2026-10-24','2026-10-25');
 `);
 // Only this disposable test gets a deterministic clock; production has no clock override.
 const migration = await readFile(new URL('../src/db/migrations/20261024_kiosk.sql', import.meta.url),'utf8');
 for (const name of ['create_package_payment_order','claim_package_payment_attempt','prepare_owner_payment_recheck','reject_unresolved_package_payment']) {
  await db.exec(`CREATE FUNCTION ${name}(p_session text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM auth_sessions s WHERE s.token_hash=p_session AND s.revoked_at IS NULL) $$`);
 }
 assert.match(migration,/SELECT \* INTO staff FROM members WHERE id=s.member_id FOR SHARE/);
 await db.exec(migration.replaceAll('clock_timestamp()', 'kiosk_test_now()'));
 const call = async (code, key=randomUUID(), token='staff', station='LOCAL_FRONT_DESK') => (await db.query('SELECT kiosk_checkin($1,$2,$3::uuid,$4) AS result',[token,station,key,code])).rows[0].result;
 await assert.rejects(call('BLU-2'), /Kiosk required/);
 await db.exec("UPDATE auth_sessions SET mode='KIOSK',device_id='LOCAL_FRONT_DESK' WHERE token_hash='staff'");
 await assert.rejects(call('BLU-2',randomUUID(),'staff','FORGED'), /Kiosk required/);
 assert.equal((await db.query("SELECT finalize_package_payment('staff') AS ok")).rows[0].ok,false);
 assert.equal((await db.query("SELECT finalize_package_payment('other-session') AS ok")).rows[0].ok,true);
 const key=randomUUID(); const first=await call('BLU-2',key);
 assert.equal(first.reason,'FREE_ENTRY'); assert.equal(first.ok,true);
 assert.deepEqual(await call('BLU-2',key),first);
 await assert.rejects(call('BLU-5',key), /Request key reused/);
 assert.equal((await call('BLU-2')).reason,'BOUNCE');
 assert.equal((await call('BLU-5')).reason,'FREE_ENTRY');
 await db.exec("SET kiosk.test_now='2026-10-24T03:00:03Z'");
 assert.equal((await call('BLU-2')).reason,'NO_ENTITLEMENT');
 assert.equal((await call('BLU-3')).reason,'NO_ENTITLEMENT');
 assert.equal((await call('BLU-4')).reason,'NO_ENTITLEMENT');
 assert.equal((await call('BLU-999')).reason,'NOT_FOUND');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM checkins')).rows[0].n,2);
 assert.equal((await db.query('SELECT sum(points_awarded)::int AS n FROM checkins')).rows[0].n,0);
 assert.equal((await db.query("SELECT mode FROM auth_sessions WHERE token_hash='other-session'")).rows[0].mode,'NORMAL');
 // Synthetic order only inside this disposable DB, never in actual finances.
 await db.exec(`UPDATE members SET expire_date='2026-10-25' WHERE id=4;
 INSERT INTO package_payment_orders VALUES(gen_random_uuid(),4,'PAID','{"timeSlot":"07:00-14:00"}','2026-10-24','2026-10-24');`);
 assert.equal((await call('BLU-4')).reason,'PAID_ENTRY');
 await db.exec("SET kiosk.test_now='2026-10-24T07:00:01Z'");
 assert.equal((await call('BLU-4')).reason,'OFF_PEAK');
 await db.exec("SET kiosk.test_now='2026-10-24T15:00:01Z'");
 assert.equal((await call('BLU-4')).reason,'CLOSED');
 await db.exec("UPDATE members SET role='MEMBER' WHERE id=1");
 await assert.rejects(call('BLU-4'),/Kiosk required/);
 await db.exec("UPDATE members SET role='ADMIN',status='SUSPENDED' WHERE id=1");
 await assert.rejects(call('BLU-4'),/Kiosk required/);
 await db.exec("UPDATE members SET status='ACTIVE' WHERE id=1; UPDATE auth_sessions SET expires_at='2026-10-23' WHERE token_hash='staff'");
 await assert.rejects(call('BLU-4'),/Kiosk required/);
 console.log('PASS: migration compiles; normal/forged/expired/role-changed sessions denied; welcome atomic consumption + replay + bounce + different-member immediate; expired/ACTIVE-without-rights denied; zero points; other sessions unchanged.');
 console.log('Single-connection WASM: real multi-connection race acceptance is separate. No production writes.');
} finally { await db.close(); }

// Also compile the real payment functions before upgrading their session predicates.
const integration = new PGlite();
try {
 await integration.exec(`
 CREATE TABLE members(id serial PRIMARY KEY,phone text,full_name text,member_code text,status text,role text,points integer DEFAULT 0,expire_date timestamptz,updated_at timestamptz,avatar_url text);
 CREATE TABLE auth_sessions(id serial PRIMARY KEY,member_id integer REFERENCES members(id),token_hash text,expires_at timestamptz,revoked_at timestamptz);
 CREATE TABLE payments(id serial PRIMARY KEY,easyslip_trans_ref varchar(100));
 CREATE TABLE coupons(id serial PRIMARY KEY,member_id integer,type text,source text,status text,total_quota integer,used_count integer,created_at timestamptz,expire_date timestamptz);
 CREATE TABLE checkins(id serial PRIMARY KEY,member_id integer,scanner_type text,scanner_device_id text,points_awarded integer,notes text,checkin_time timestamptz DEFAULT now());
 `);
 for (const file of ['20261009_real_package_payments.sql','20261010_payment_promptpay.sql','20261024_kiosk.sql']) {
  await integration.exec(await readFile(new URL('../src/db/migrations/'+file,import.meta.url),'utf8'));
 }
 const {rows}=await integration.query("SELECT proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('create_package_payment_order','claim_package_payment_attempt','finalize_package_payment','prepare_owner_payment_recheck','reject_unresolved_package_payment')");
 assert.equal(rows.length,5);
 for (const row of rows) assert.match(row.definition,/mode = 'NORMAL' AND (s\.)?token_hash=p_session/,row.proname);
 console.log('PASS: actual original + incremental payment migrations + kiosk upgrade compile; all five money function predicates require NORMAL.');
} finally { await integration.close(); }
