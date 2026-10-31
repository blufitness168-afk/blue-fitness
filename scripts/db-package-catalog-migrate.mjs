// Offline by default. Never import a credential-loading client.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import { root, local, protect, digest, quote, save, stamp, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';
import { splitSql } from './db-payments-sql.mjs';

const migration = 'src/db/migrations/20261031_package_catalog.sql';
const testFile = 'src/lib/package-catalog-sql.test.mjs';
const newTables = ['package_catalog', 'package_catalog_audit'];
const newFunctions = ['protect_package_catalog_audit', 'protect_package_catalog', 'package_catalog_action', 'create_catalog_package_payment_order'];
const changedFunction = 'issue_paid_package_benefits';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const equal = (query, value, message) => `DO $deployment$ BEGIN IF (${query}) IS DISTINCT FROM ${literal(JSON.stringify(value))}::jsonb THEN RAISE EXCEPTION '${message}'; END IF; END $deployment$`;

export function migrationStatements(text) {
  const parts = splitSql(text);
  assert.equal(parts.shift(), 'BEGIN');
  assert.equal(parts.pop(), 'COMMIT');
  const patterns = [
    /^CREATE TABLE package_catalog \(/,
    /^INSERT INTO package_catalog\(id,name,label,description,price_satang,duration_days,time_slot,friend_quota,bonus_days\) VALUES\s/,
    /^CREATE VIEW package_catalog_public AS\s/,
    /^CREATE TABLE package_catalog_audit \(/,
    /^CREATE FUNCTION protect_package_catalog_audit\(\)/,
    /^CREATE TRIGGER package_catalog_audit_guard BEFORE UPDATE OR DELETE OR TRUNCATE ON package_catalog_audit\s/,
    /^CREATE FUNCTION protect_package_catalog\(\)/,
    /^CREATE TRIGGER package_catalog_guard BEFORE UPDATE OR DELETE ON package_catalog\s/,
    /^CREATE TRIGGER package_catalog_truncate_guard BEFORE TRUNCATE ON package_catalog\s/,
    /^CREATE FUNCTION package_catalog_action\(p_token text,p_action text,p_key uuid,p_payload jsonb\)/,
    /^CREATE FUNCTION create_catalog_package_payment_order\(p_id uuid,p_member integer,p_session text,p_key uuid,p_quote jsonb,p_receiver jsonb\)/,
    /^REVOKE ALL ON package_catalog,package_catalog_public,package_catalog_audit FROM PUBLIC$/,
    /^REVOKE ALL ON FUNCTION package_catalog_action\(text,text,uuid,jsonb\),create_catalog_package_payment_order\(uuid,integer,text,uuid,jsonb,jsonb\),protect_package_catalog\(\),protect_package_catalog_audit\(\) FROM PUBLIC$/,
    /^DO \$guard\$ BEGIN\s/,
    /^CREATE OR REPLACE FUNCTION issue_paid_package_benefits\(\) RETURNS trigger\s/,
  ];
  assert.equal(parts.length, patterns.length, 'Unexpected migration shape');
  parts.forEach((statement, i) => assert.match(statement, patterns[i], 'Unexpected top-level operation'));
  // The only executable DO must be precisely the source comparison, not arbitrary DML.
  assert.match(parts[13], /^DO \$guard\$ BEGIN\s+IF \(SELECT prosrc FROM pg_proc WHERE oid='issue_paid_package_benefits\(\)'::regprocedure\) IS DISTINCT FROM \$expected\$[\s\S]*\$expected\$ THEN\s+RAISE EXCEPTION 'Unexpected issue_paid_package_benefits source; review migration'; END IF;\s+END \$guard\$$/);
  return parts;
}

function plan() {
  const text = read(migration), statements = migrationStatements(text);
  const inputs = [migration, 'scripts/db-package-catalog-migrate.mjs', 'scripts/db-package-catalog-migration.md', 'scripts/db-safety.mjs', 'scripts/db-backup.mjs', 'scripts/db-verify-backup.mjs', 'scripts/db-payments-sql.mjs', 'package.json', 'pnpm-lock.yaml'];
  // Include all SQL prerequisites and all directly relevant acceptance inputs.
  inputs.push(...fs.readdirSync(path.join(root, 'src/db/migrations')).filter(n => n.endsWith('.sql')).sort().map(n => 'src/db/migrations/' + n));
  inputs.push(...fs.readdirSync(path.join(root, 'src/lib')).filter(n => /^(package-catalog.*|package-payment-benefits\.test|payment-policy|mock-data)\.(mjs|ts)$/.test(n)).sort().map(n => 'src/lib/' + n));
  const hashes = Object.fromEntries([...new Set(inputs)].sort().map(file => [file, digest(read(file))]));
  const oldSource = statements[13].match(/\$expected\$([\s\S]*?)\$expected\$/)[1];
  const newSource = statements[14].match(/AS \$\$([\s\S]*?)\$\$$/)[1];
  return { statements, oldSource, newSource, hashes, sha256: digest(JSON.stringify(hashes)) };
}

// Stable structural metadata: exclude physical/MVCC counters, include ownership,
// grants, function configuration, constraints, triggers, policies and view SQL.
const queries = {
  identity: `SELECT current_database() AS database,current_user AS role,session_user AS session_role`,
  schemas: `SELECT nspname,nspowner,nspacl FROM pg_namespace WHERE nspname='public' ORDER BY nspname`,
  roles: `SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls FROM pg_roles ORDER BY rolname`,
  memberships: `SELECT roleid,member,grantor,admin_option FROM pg_auth_members ORDER BY roleid,member,grantor`,
  defaults: `SELECT * FROM pg_default_acl ORDER BY oid`,
  relations: `SELECT c.oid,c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.oid`,
  columns: `SELECT c.oid AS relation,a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,a.attcollation,a.attacl,pg_get_expr(d.adbin,d.adrelid) AS default_expr FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.oid,a.attnum`,
  constraints: `SELECT oid,conrelid,conname,contype,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY oid`,
  indexes: `SELECT indexrelid,indrelid,indisvalid,indisready,pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace) ORDER BY indexrelid`,
  functions: `SELECT p.oid,p.proname,p.proowner,p.proacl,p.prosecdef,p.proconfig,p.prosrc,pg_get_functiondef(p.oid) AS definition FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind IN ('f','p') ORDER BY p.oid`,
  triggers: `SELECT t.oid,t.tgrelid,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace) ORDER BY t.oid`,
  policies: `SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`,
  enums: `SELECT t.oid,t.typname,t.typowner,t.typacl,e.enumlabel,e.enumsortorder FROM pg_type t LEFT JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typnamespace='public'::regnamespace AND t.typtype IN ('e','d') ORDER BY t.oid,e.enumsortorder`,
  views: `SELECT c.oid,pg_get_viewdef(c.oid) AS definition FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='v' ORDER BY c.oid`,
};
const aggregate = query => `SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (${query}) x`;
async function metadata(sql) {
  const values = await sql.transaction(Object.values(queries).map(q => sql.query(`SELECT (${aggregate(q)}) AS value`)), { isolationLevel: 'RepeatableRead', readOnly: true });
  return Object.fromEntries(Object.keys(queries).map((key, i) => [key, values[i][0].value]));
}
function baseline(m, p) {
  const tables = m.relations.filter(r => r.relkind === 'r').map(r => r.relname).sort();
  assert.equal(tables.length, 30, 'Expected ALL 30 original tables');
  assert(!m.relations.some(r => ['p', 'f', 'm'].includes(r.relkind)), 'Unsupported storage');
  assert(!m.relations.some(r => [...newTables, 'package_catalog_public'].includes(r.relname)), 'Already or partially applied');
  assert(!m.functions.some(f => newFunctions.includes(f.proname)), 'Unexpected function collision');
  for (const name of ['members', 'coupons', 'package_payment_orders', 'package_payment_point_ledger', 'package_payment_attempts', 'auth_sessions']) assert(tables.includes(name), 'Missing prerequisite');
  const old = m.functions.filter(f => f.proname === changedFunction);
  assert.equal(old.length, 1); assert.equal(old[0].prosrc, p.oldSource, 'Old issuance source drift');
  assert.equal(old[0].prosecdef, false);
  assert.deepEqual(old[0].proconfig, ['search_path=public, pg_catalog']);
  return tables;
}
function expectedCatalog() {
  const require = createRequire(import.meta.url), ts = require('typescript');
  const filename = path.join(root, 'src/lib/mock-data.ts');
  const mod = new Module(filename); mod.require = require;
  mod._compile(ts.transpileModule(read('src/lib/mock-data.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  assert.equal(mod.exports.mockPackages.length, 10);
  return mod.exports.mockPackages.map(p => ({ id:p.id, name:p.name, label:p.label, description:p.description, price_satang:p.price*100, duration_days:p.durationDays, time_slot:p.timeSlot, friend_quota:p.friendCoupons, bonus_days:p.bonusDays, version:1, is_active:true }));
}
async function isolatedGuards(p) {
  const require = createRequire(new URL('../.local-db/payment-sql-tests/package.json', import.meta.url));
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(read('src/lib/package-payment-benefits.test.mjs').match(/await db\.exec\(`([\s\S]*?)`\);/)[1]);
    for (const name of ['20261009_real_package_payments','20261010_payment_promptpay','20261024_kiosk','20261024_real_benefits_admin','20261024_real_rewards','20261024_real_frontdesk','20261024_real_finance','20261025_package_payment_benefits']) await db.exec(read('src/db/migrations/'+name+'.sql'));
    await db.exec(`DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature); EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_catalog',f.signature); END LOOP; END $$`);
    for (const name of ['20261031_payment_receiver_bank','20261031_payment_currency_recheck']) await db.exec(read('src/db/migrations/'+name+'.sql'));
    // Query objects are deferred exactly as with the Neon transaction API.
    const sql = { query:(text,params) => ({text,params}), transaction:async calls => {
      await db.exec('BEGIN');
      try { const out=[]; for (const c of calls) out.push((await db.query(c.text,c.params)).rows); await db.exec('COMMIT'); return out; }
      catch (e) { await db.exec('ROLLBACK'); throw e; }
    } };
    const m = await metadata(sql);
    assert.equal(m.functions.find(f => f.proname===changedFunction).prosrc,p.oldSource);
    await sql.transaction([...metadataGuards(sql,m,p),...p.statements.map(s=>sql.query(s))]);
        const debug = await metadata(sql);
        const oldF=m.functions.find(f=>f.proname===changedFunction), newF=debug.functions.find(f=>f.proname===changedFunction);
        assert.deepEqual(newF,{...oldF,prosrc:p.newSource,definition:oldF.definition.replace(p.oldSource,()=>p.newSource)});
        await sql.transaction([...metadataGuards(sql,m,p,true),sql.query(equal(aggregate('SELECT * FROM public.package_catalog ORDER BY id'),expectedCatalog(),'Seed mismatch'))]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM package_catalog_audit')).rows[0].n,0);
    console.log(JSON.stringify({isolatedDeploymentGuards:'passed',noConnection:true}));
  } catch (error) {
    console.error('Isolated synthetic deployment guard:', error.message);
    throw error;
  } finally { await db.close(); }
}
function acceptance() {
  execFileSync(process.execPath, ['--test', testFile], { cwd:root, stdio:'inherit', timeout:180000 });
}
function connect() {
  // Deliberately ignore inherited DATABASE_URL and all other dotenv files.
  const env = dotenv.parse(read('.env.local'));
  assert(env.DATABASE_URL, 'DATABASE_URL missing in .env.local');
  return neon(env.DATABASE_URL);
}
function metadataGuards(sql, m, p, after = false) {
  return Object.entries(queries).map(([key, query]) => {
    let q = query;
    let expected = m[key];
    if (after) {
      // Compare every pre-existing object by stable identifier and disallow extras
      // separately below. Only the reviewed issuance body may change.
      const ids = { relations:'c.oid', columns:'c.oid', constraints:'oid', indexes:'indexrelid', functions:'p.oid', triggers:'t.oid', views:'c.oid' };
      if (ids[key]) {
        const field = key === 'columns' ? 'relation' : key === 'indexes' ? 'indexrelid' : 'oid';
        const values = [...new Set(m[key].map(r => r[field]))];
        q = `SELECT * FROM (${query}) original WHERE ${quote(field)} IN (${values.length ? values.join(',') : 'NULL'})`;
      }
      if (key === 'functions') expected = expected.map(f => f.proname === changedFunction ? { ...f, prosrc:p.newSource, definition:f.definition.replace(p.oldSource, () => p.newSource) } : f);
    }
    return sql.query(equal(aggregate(q), expected, 'Metadata drift: ' + key));
  });
}
function rowGuards(sql, snapshot, tables) {
  return tables.map(table => {
    const cols = snapshot.columns.filter(c => c.table_name === table).map(c => `${literal(c.column_name)},t.${quote(c.column_name)}`).join(',');
    const query = `SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM (SELECT jsonb_build_object(${cols}) AS r FROM public.${quote(table)} t) original`;
    const expected = `SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM jsonb_array_elements(${literal(snapshot.tables[table].rows)}::jsonb) r`;
    return sql.query(`DO $deployment$ BEGIN IF (${query}) IS DISTINCT FROM (${expected}) THEN RAISE EXCEPTION 'Original row drift'; END IF; END $deployment$`);
  });
}
function postGuard(m) {
  const relationNames = [...newTables, 'package_catalog_public'];
  return `DO $deployment$ BEGIN
    IF (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r')<>32
      OR (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='v')<>${m.relations.filter(r => r.relkind === 'v').length+1}
      OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND oid NOT IN (${m.relations.map(r => r.oid).join(',')}) AND NOT (relname IN (${relationNames.map(literal).join(',')}) OR (relkind='i' AND oid IN (SELECT indexrelid FROM pg_index WHERE indrelid IN ('package_catalog'::regclass,'package_catalog_audit'::regclass)))))
      THEN RAISE EXCEPTION 'Unexpected new relations'; END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind IN ('f','p'))<>${m.functions.length+4}
      OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (${newFunctions.map(literal).join(',')}))<>4
      OR EXISTS(SELECT 1 FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname IN (${[...newFunctions, changedFunction].map(literal).join(',')}) AND (prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_catalog'] OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)))
      THEN RAISE EXCEPTION 'Unsafe function set/configuration/ACL'; END IF;
    IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.relnamespace='public'::regnamespace AND c.relname IN (${relationNames.map(literal).join(',')}) AND a.grantee=0)
      THEN RAISE EXCEPTION 'Unexpected PUBLIC relation grants'; END IF;
    IF EXISTS(SELECT 1 FROM package_catalog_audit) THEN RAISE EXCEPTION 'Audit not empty'; END IF;
  END $deployment$`;
}

async function main() {
  const args = process.argv.slice(2), p = plan();
  if (!args.length) {
    console.log(JSON.stringify({ state:'prepare-only', noConnection:true, sha256:p.sha256, hashes:p.hashes, test:'node scripts/db-package-catalog-migrate.mjs --test', inspect:'node scripts/db-package-catalog-migrate.mjs --inspect' }, null, 2)); return;
  }
  if (args.length === 1 && args[0] === '--test') { acceptance(); await isolatedGuards(p); assert.equal(plan().sha256,p.sha256); return; }
  const inspect = args.length === 1 && args[0] === '--inspect';
  if (!inspect) assert(args.length === 5 && args[0] === '--apply' && args[1] === '--reviewed-sha' && args[2] === p.sha256 && args[3] === '--reviewed-db' && /^[a-f0-9]{64}$/.test(args[4]), 'Exact reviewed SHA and metadata fingerprint required');
  // Mandatory isolated SQL acceptance before constructing any live client, even inspect.
  acceptance(); await isolatedGuards(p); assert.equal(plan().sha256, p.sha256, 'Inputs changed during tests');
  protect(); const sql = connect(), m = await metadata(sql), tables = baseline(m,p);
  const fingerprint = digest(JSON.stringify(m));
  if (inspect) {
    const file = path.join(local, 'package-catalog-inspect-' + stamp() + '.json');
    save(file,JSON.stringify({ sha256:p.sha256, metadataFingerprint:fingerprint, metadata:m },null,2));
    console.log(JSON.stringify({ state:'read-only-inspection', sha256:p.sha256, metadataFingerprint:fingerprint, report:path.relative(root,file), originalTables:tables.length })); return;
  }
  assert.equal(fingerprint,args[4], 'Metadata changed since review');
  const directory = await backup(sql,tables); await verify(directory,sql);
  const snapshot = JSON.parse(fs.readFileSync(path.join(directory,'snapshot.json'),'utf8'));
  assert.deepEqual(Object.keys(snapshot.tables).sort(),tables,'Incomplete backup');
  save(path.join(directory,'package-catalog-review.json'),JSON.stringify({sha256:p.sha256,hashes:p.hashes,metadata:m},null,2));
  assert.equal(plan().sha256,p.sha256,'Inputs changed before transaction');
  await sql.transaction([
    sql.query("SET LOCAL lock_timeout='5s'"), sql.query("SET LOCAL statement_timeout='120s'"), sql.query('SET LOCAL search_path=public,pg_catalog'),
    // Fresh READ COMMITTED snapshots after all writer locks detect commits made while waiting.
    sql.query(`LOCK TABLE ${tables.map(t => 'public.'+quote(t)).join(',')} IN SHARE ROW EXCLUSIVE MODE`),
    sql.query("SELECT pg_advisory_xact_lock(hashtextextended('blue-fitness:package-catalog-migrate',0))"),
    ...metadataGuards(sql,m,p), ...rowGuards(sql,snapshot,tables),
    ...p.statements.map(s => sql.query(s)),
    ...rowGuards(sql,snapshot,tables), ...metadataGuards(sql,m,p,true), sql.query(postGuard(m)),
    sql.query(equal(aggregate('SELECT * FROM public.package_catalog ORDER BY id'),expectedCatalog(),'Catalog seed differs from default code catalog')),
  ],{ isolationLevel:'ReadCommitted' });
  const report = {state:'applied',sha256:p.sha256,metadataFingerprint:fingerprint,backup:path.relative(root,directory),originalTablesUnchanged:30,seedRows:10,auditRows:0};
  save(path.join(directory,'package-catalog-applied.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(safeFailure);
