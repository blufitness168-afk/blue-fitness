// Prepare is offline. Only --inspect (read-only) and explicit --apply may connect.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { client, protect, root, local, digest, quote, save, stamp, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';
import { splitSql } from './db-payments-sql.mjs';

const names = ['20261024_real_rewards.sql','20261024_real_finance.sql','20261024_real_frontdesk.sql','20261024_real_benefits_admin.sql','20261025_package_payment_benefits.sql'];
const prerequisites = ['20261009_real_package_payments.sql','20261010_payment_promptpay.sql','20261024_kiosk.sql'];
const migrationPath = name => 'src/db/migrations/' + name;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const newTables = ['reward_point_spend_ledger','reward_action_requests','finance_entries','finance_action_requests','finance_audit','benefit_definitions','benefit_assignments','benefit_promo_reservations','benefit_action_audit','benefit_consumptions'];
const signatures = ['real_rewards_action(text,text,uuid,jsonb)','real_finance_action(text,text,uuid,jsonb)','real_frontdesk_checkin(text,text,uuid,text)','real_benefits_admin_action(text,text,uuid,jsonb)','create_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb)','create_package_payment_order_before_benefits(uuid,integer,text,uuid,jsonb,jsonb)'];
const requiredTables = ['members','payments','auth_sessions','coupons','checkins','rewards','redemptions','package_payment_orders','package_payment_attempts','package_payment_point_ledger','package_payment_resolution_audit','payment_transfer_refs','kiosk_requests','kiosk_member_bounce'];

function statements(text) {
 const parts = splitSql(text);
 if (parts[0] === 'BEGIN') {
  assert.equal(parts.pop(), 'COMMIT', 'Expected outer COMMIT'); parts.shift();
 }
 assert(parts.length && parts.every(s => !/^(BEGIN|COMMIT|ROLLBACK|START TRANSACTION|END)\b/i.test(s)), 'Nested transaction control is forbidden');
 assert(parts.every(s => /^(CREATE|ALTER|REVOKE|GRANT)\b/i.test(s)), 'Unexpected top-level migration operation');
 return parts;
}
function plan() {
 const files = names.map(name => ({ name, text: read(migrationPath(name)) }));
 const inputs = [...names.map(migrationPath), ...prerequisites.map(migrationPath), 'scripts/db-real-modules-deploy.mjs','scripts/db-safety.mjs','scripts/db-backup.mjs','scripts/db-verify-backup.mjs','scripts/db-payments-sql.mjs','src/lib/package-payment-benefits.test.mjs','src/lib/payment-policy.ts','src/lib/mock-data.ts','src/lib/payment-server.ts','pnpm-lock.yaml'];
 const hashes = Object.fromEntries(inputs.map(file => [file,digest(read(file))]));
 return { files, hashes, sha256: digest(JSON.stringify(hashes)), statements: files.flatMap(f => statements(f.text)) };
}

// Catalog snapshot includes function ownership/ACL/config, triggers, RLS, schema ACL,
// columns/defaults, constraints/indexes and identity. No row values or credentials.
const metadataQuery = `SELECT jsonb_build_object(
 'identity',(SELECT to_jsonb(x) FROM (SELECT current_database() AS database,current_user AS role,session_user AS session_role) x),
 'schemas',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.nspname) FROM (SELECT nspname,nspowner,nspacl FROM pg_namespace WHERE nspname='public') x),
 'roles',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.rolname) FROM (SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls FROM pg_roles) x),
 'memberships',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.roleid,x.member) FROM (SELECT roleid,member,admin_option FROM pg_auth_members) x),
 'default_acls',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM (SELECT oid,defaclrole,defaclnamespace,defaclobjtype,defaclacl FROM pg_default_acl) x),
 'relations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM (SELECT c.oid,c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') x),
 'columns',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.ordinal_position) FROM (SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public') x),
 'constraints',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM (SELECT k.oid,k.conrelid,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='public') x),
 'indexes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.indexname) FROM (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public') x),
 'enums',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.typname,x.enumsortorder) FROM (SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public') x),
 'functions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM (SELECT p.oid,p.proname,p.proowner,p.proacl,p.prosecdef,p.proconfig,pg_get_function_identity_arguments(p.oid) AS args,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')) x),
 'triggers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM (SELECT t.oid,t.tgrelid,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) x),
 'policies',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.tablename,x.policyname) FROM (SELECT * FROM pg_policies WHERE schemaname='public') x)
 ) AS metadata`;
const getMetadata = async sql => (await sql.query(metadataQuery))[0].metadata;
const jsonEqualGuard = (query, expected, label) => `DO $guard$ BEGIN IF (${query}) IS DISTINCT FROM ${literal(JSON.stringify(expected))}::jsonb THEN RAISE EXCEPTION '${label}'; END IF; END $guard$`;

const securityQuery = `SELECT p.proname,p.prosecdef,p.proconfig,
 EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
 FROM pg_proc p WHERE p.oid IN (${signatures.map(s => `to_regprocedure(${literal('public.' + s)})`).join(',')}) ORDER BY p.proname`;
function securityFindings(rows) {
 const findings = [];
 if (rows.length !== signatures.length) findings.push('Expected six entrypoint/helper signatures');
 for (const row of rows) {
  if (row.public_execute) findings.push(`${row.proname}: PUBLIC EXECUTE must be revoked in the migration`);
  if (row.prosecdef) findings.push(`${row.proname}: unexpected SECURITY DEFINER`);
  if (!row.proconfig?.includes('search_path=public, pg_catalog')) findings.push(`${row.proname}: missing pinned search_path=public,pg_catalog`);
 }
 return findings;
}
const securityGuard = `DO $guard$ BEGIN
 IF (SELECT count(*) FROM (${securityQuery}) f)<>6 OR EXISTS(SELECT 1 FROM (${securityQuery}) f WHERE f.public_execute OR f.prosecdef OR NOT coalesce('search_path=public, pg_catalog'=ANY(f.proconfig),false)) THEN RAISE EXCEPTION 'Unsafe function privileges or configuration'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='public' AND c.relname IN (${newTables.map(literal).join(',')}) AND a.grantee=0) THEN RAISE EXCEPTION 'New tables granted to PUBLIC'; END IF;
 END $guard$`;

async function isolated(p) {
 const require = createRequire(path.join(root,'.local-db/payment-sql-tests/package.json'));
 const { PGlite } = require('@electric-sql/pglite');
 const db = new PGlite();
 try {
  await db.exec(`
   CREATE TYPE member_status AS ENUM ('PENDING','ACTIVE','EXPIRED','SUSPENDED');
   CREATE TYPE coupon_type AS ENUM ('FREE_ENTRY','FRIEND_PASS','EXTRA_DAYS','CUSTOM');
   CREATE TYPE coupon_status AS ENUM ('AVAILABLE','USED','EXPIRED');
   CREATE TABLE members(id serial PRIMARY KEY,phone text,full_name text,member_code text UNIQUE,status member_status,role text,points integer DEFAULT 0,expire_date timestamptz,updated_at timestamptz,avatar_url text);
   CREATE TABLE auth_sessions(id serial PRIMARY KEY,member_id integer REFERENCES members(id),token_hash text,expires_at timestamptz,revoked_at timestamptz);
   CREATE TABLE payments(id serial PRIMARY KEY,easyslip_trans_ref varchar(100));
   CREATE TABLE coupons(id serial PRIMARY KEY,member_id integer REFERENCES members(id),type coupon_type,source text,title text,status coupon_status DEFAULT 'AVAILABLE',total_quota integer,used_count integer,bonus_days_value integer DEFAULT 0,created_at timestamptz DEFAULT now(),expire_date timestamptz,UNIQUE(member_id,source));
   CREATE TABLE checkins(id serial PRIMARY KEY,member_id integer,scanner_type text,scanner_device_id text,points_awarded integer,notes text,checkin_time timestamptz DEFAULT now());
   CREATE TABLE rewards(id serial PRIMARY KEY,title text,description text,image_url text,point_cost integer,stock integer,is_active boolean,created_at timestamptz DEFAULT now());
   CREATE TABLE redemptions(id serial PRIMARY KEY,member_id integer REFERENCES members(id),reward_id integer REFERENCES rewards(id),points_spent integer,redeemed_at timestamptz DEFAULT now(),status text);
  `);
  for (const name of prerequisites) await db.exec(read(migrationPath(name)));
  const before = (await db.query(metadataQuery)).rows[0].metadata;
  // Exact deploy transaction shape, deliberately fail after all five files.
  await assert.rejects(db.exec('BEGIN;\n' + p.statements.join(';\n') + ";\nDO $$ BEGIN RAISE EXCEPTION 'rollback probe'; END $$; COMMIT;"), /rollback probe/);
  await db.exec('ROLLBACK');
  assert.deepEqual((await db.query(metadataQuery)).rows[0].metadata,before,'DDL did not roll back');
  await db.exec('BEGIN;\n' + p.statements.join(';\n') + ';\nCOMMIT;');
  const findings = securityFindings((await db.query(securityQuery)).rows);
  if (!findings.length) await db.exec(securityGuard);
  else await assert.rejects(db.exec(securityGuard), /Unsafe function privileges or configuration/);
  // Reapplication must fail atomically, never partially upgrade an existing installation.
  const applied = (await db.query(metadataQuery)).rows[0].metadata;
  await assert.rejects(db.exec('BEGIN;\n' + p.statements.join(';\n') + ';\nCOMMIT;'));
  await db.exec('ROLLBACK');
  assert.deepEqual((await db.query(metadataQuery)).rows[0].metadata,applied);
  // PL/pgSQL bodies are planned lazily: exercise every entrypoint's auth path.
  for (const call of ["real_rewards_action('missing','member',NULL,'{}')","real_finance_action('missing','read',NULL,'{}')","real_frontdesk_checkin('missing','isolated',gen_random_uuid(),'BLU-0')","real_benefits_admin_action('missing','list',NULL,'{}')"]) {
   await assert.rejects(db.query('SELECT ' + call), e => e.code === '42501');
  }
  await db.exec(`INSERT INTO members(member_code,full_name,status,role) VALUES ('TEST-MEMBER','Memory member','ACTIVE','MEMBER'),('TEST-ADMIN','Memory admin','ACTIVE','ADMIN'),('TEST-OWNER','Memory owner','ACTIVE','OWNER');
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'test-'||role,now()+interval '1 day' FROM members;`);
  const readCalls = [['real_rewards_action','member','MEMBER'],['real_rewards_action','admin','ADMIN'],['real_finance_action','read','OWNER'],['real_benefits_admin_action','list','ADMIN']];
  for (const [fn,action,role] of readCalls) {
   await db.query(`SELECT ${fn}($1,$2,NULL,'{}')`,['test-'+role,action]);
   for (const mutation of ["mode='KIOSK',device_id='isolated'", "expires_at=now()-interval '1 day'", 'revoked_at=now()']) {
    await db.exec('BEGIN');
    await db.query(`UPDATE auth_sessions SET ${mutation} WHERE token_hash=$1`,['test-'+role]);
    await assert.rejects(db.query(`SELECT ${fn}($1,$2,NULL,'{}')`,['test-'+role,action]), e => e.code === '42501');
    await db.exec('ROLLBACK');
   }
   await db.exec('BEGIN');
   await db.query("UPDATE members SET status='SUSPENDED' WHERE role=$1",[role]);
   await assert.rejects(db.query(`SELECT ${fn}($1,$2,NULL,'{}')`,['test-'+role,action]), e => e.code === '42501');
   await db.exec('ROLLBACK');
  }
  for (const [fn,action] of [['real_rewards_action','admin'],['real_finance_action','read'],['real_benefits_admin_action','list']]) {
   await assert.rejects(db.query(`SELECT ${fn}('test-MEMBER',$1,NULL,'{}')`,[action]), e => e.code === '42501');
  }
  // Verify the production metadata guard SQL itself, not just its JS comparison.
  const current = (await db.query(metadataQuery)).rows[0].metadata;
  await db.exec(jsonEqualGuard(metadataQuery,current,'Metadata drift'));
  await assert.rejects(db.exec(jsonEqualGuard(metadataQuery,{},'Metadata drift')), /Metadata drift/);
  console.log(JSON.stringify({isolatedChain:'PASS',combinedRollback:'PASS',atomicReapplyRejection:'PASS',metadataGuard:'PASS',unauthorizedEntrypoints:'PASS',readBodiesAndSessionRolePredicates:'PASS',securityFindings:findings}));
  return findings;
 } finally { await db.close(); }
}
function acceptance() {
 execFileSync(process.execPath,['--test','src/lib/package-payment-benefits.test.mjs'],{cwd:root,stdio:'inherit',timeout:120000});
}
function baseline(m) {
 assert(!m.relations?.some(r => ['p','f','m'].includes(r.relkind)), 'Partitioned/foreign/materialized storage requires a separate backup review');
 for (const name of requiredTables) assert(m.relations?.some(r => r.relname === name && r.relkind === 'r'), 'Missing baseline relation');
 assert(!m.relations.some(r => newTables.includes(r.relname)), 'Already/partially applied: automatic reapply forbidden');
 assert(!m.columns.some(c => (c.table_name === 'redemptions' && c.column_name === 'request_key') || (c.table_name === 'package_payment_orders' && c.column_name === 'package_benefits_version')), 'Unexpected upgraded baseline');
 assert(!m.functions?.some(f => f.proname.startsWith('real_') || f.proname === 'create_package_payment_order_before_benefits'), 'Unexpected baseline functions');
 const money = ['create_package_payment_order','claim_package_payment_attempt','finalize_package_payment','prepare_owner_payment_recheck','reject_unresolved_package_payment'];
 for (const name of money) {
  const functions = m.functions.filter(f => f.proname === name);
  assert.equal(functions.length,1,'Unexpected payment overload');
  assert.match(functions[0].definition,/mode = 'NORMAL' AND (s\.)?token_hash=p_session/,'Missing NORMAL payment predicate');
  assert.equal(functions[0].prosecdef,false);
 }
 assert(m.columns.some(c => c.table_name === 'auth_sessions' && c.column_name === 'mode' && c.is_nullable === 'NO' && c.column_default?.includes("'NORMAL'")), 'Missing kiosk baseline');
}

async function main() {
 const args = process.argv.slice(2), p = plan();
 if (!args.length) {
  console.log(JSON.stringify({state:'prepare-only',noConnection:true,sha256:p.sha256,hashes:p.hashes,order:names,test:'node scripts/db-real-modules-deploy.mjs --test',inspect:'node scripts/db-real-modules-deploy.mjs --inspect',apply:`node scripts/db-real-modules-deploy.mjs --apply --reviewed-sha ${p.sha256} --reviewed-db <fingerprint-from-inspect>`,note:'Do not apply until security review and isolated acceptance pass.'},null,2)); return;
 }
 if (args.length === 1 && args[0] === '--test') {
  const findings = await isolated(p); acceptance();
  if (findings.length) process.exitCode = 1;
  return;
 }
 if (args.length === 1 && args[0] === '--inspect') {
  protect(); const sql = client(); const m = await getMetadata(sql); baseline(m);
  const file = path.join(local,'real-modules-inspect-' + stamp() + '.json');
  save(file,JSON.stringify({sha256:p.sha256,metadata:m},null,2));
  console.log(JSON.stringify({state:'read-only-inspection',databaseFingerprint:digest(JSON.stringify(m)),report:path.relative(root,file),noDataWrites:true})); return;
 }
 assert(args.length === 5 && args[0] === '--apply' && args[1] === '--reviewed-sha' && args[2] === p.sha256 && args[3] === '--reviewed-db' && /^[a-f0-9]{64}$/.test(args[4]), 'Use exact reviewed SHA and DB fingerprint; unknown flags are forbidden');
 protect();
 const findings = await isolated(p); acceptance();
 assert.equal(findings.length,0,'Blocked by isolated security review; no production connection made');
 assert.equal(plan().sha256,p.sha256,'Inputs changed during acceptance');
 const sql = client(), m = await getMetadata(sql); baseline(m);
 assert.equal(digest(JSON.stringify(m)),args[4],'Database metadata changed since review');
 const tables = m.relations.filter(r => r.relkind === 'r').map(r => r.relname).sort();
 const directory = await backup(sql,tables); await verify(directory,sql);
 save(path.join(directory,'real-modules-metadata-before.json'),JSON.stringify(m,null,2));
 save(path.join(directory,'real-modules-plan.json'),JSON.stringify({sha256:p.sha256,hashes:p.hashes},null,2));
 const snapshot = JSON.parse(fs.readFileSync(path.join(directory,'snapshot.json'),'utf8'));
 const guards = () => tables.map(t => {
  const columns = snapshot.columns.filter(c => c.table_name === t).map(c => `${literal(c.column_name)},t.${quote(c.column_name)}`).join(',');
  const query = `SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM (SELECT jsonb_build_object(${columns}) AS r FROM public.${quote(t)} t) original`;
  const expected = JSON.parse(snapshot.tables[t].rows);
  return sql.query(`DO $guard$ BEGIN IF (${query}) IS DISTINCT FROM (SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM jsonb_array_elements(${literal(JSON.stringify(expected))}::jsonb) r) THEN RAISE EXCEPTION 'Snapshot drift or existing data mutation'; END IF; END $guard$`);
 });
 const finalizer = m.functions.find(f => f.proname === 'finalize_package_payment');
 const unchangedFunctions = m.functions.filter(f => f.proname !== 'create_package_payment_order');
 const functionGuard = jsonEqualGuard(`SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM (SELECT p.oid,p.proname,p.proowner,p.proacl,p.prosecdef,p.proconfig,pg_get_function_identity_arguments(p.oid) AS args,pg_get_functiondef(p.oid) AS definition FROM pg_proc p WHERE p.oid IN (${unchangedFunctions.map(f => f.oid).join(',')})) x`,unchangedFunctions,'Existing function mutation');
 // All validation that can abort deployment belongs before COMMIT, including ACLs.
 assert.equal(plan().sha256,p.sha256,'Inputs changed before transaction');
 await sql.transaction([
  sql.query("SET LOCAL lock_timeout='5s'"),sql.query("SET LOCAL statement_timeout='120s'"),sql.query('SET LOCAL search_path=public,pg_catalog'),
  sql.query("SELECT pg_advisory_xact_lock(hashtextextended('blue-fitness:real-modules-deploy',0))"),
  sql.query(`LOCK TABLE ${tables.map(t => 'public.'+quote(t)).join(',')} IN ACCESS EXCLUSIVE MODE`),
  sql.query(jsonEqualGuard(metadataQuery,m,'Metadata drift')),...guards(),
  ...p.statements.map(s => sql.query(s)),...guards(),sql.query(functionGuard),sql.query(securityGuard),
  sql.query(`DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM redemptions WHERE request_key IS NOT NULL OR reward_code IS NOT NULL OR reward_title IS NOT NULL OR completed_at IS NOT NULL OR completed_by IS NOT NULL) OR EXISTS(SELECT 1 FROM package_payment_orders WHERE package_benefits_version IS NOT NULL) THEN RAISE EXCEPTION 'Unexpected historical backfill'; END IF; END $guard$`),
  ...newTables.map(t => sql.query(`DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.${quote(t)}) THEN RAISE EXCEPTION 'Unexpected deployment fixture'; END IF; END $guard$`)),
  sql.query(jsonEqualGuard(`SELECT to_jsonb(pg_get_functiondef(${finalizer.oid}::oid))`,finalizer.definition,'Finalizer changed')),
 ],{isolationLevel:'Serializable'});
 // No automatic retry after an ambiguous commit/network failure. Inspect before rerunning.
 const report = {state:'applied',sha256:p.sha256,backup:path.relative(root,directory),existingRows:'unchanged (all original columns)',historicalEligibility:'NULL',security:'invoker; no PUBLIC execute on six entrypoints/helpers',rollback:'automatic on any transaction failure; no destructive post-commit down migration',noProviderOrSmsCalls:true};
 save(path.join(directory,'real-modules-applied.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
main().catch(safeFailure);
