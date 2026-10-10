import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { client, protect, root, quote, digest, save, local, stamp, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';
import { migrationStatements } from './db-payments-sql.mjs';

const file = path.join(root, 'src/db/migrations/20261009_real_package_payments.sql');
const absent = `IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relname LIKE 'package_payment_%' OR c.relname='payment_transfer_refs' OR c.relname='payments_easyslip_trans_ref_unique')) OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE '%package_payment%' OR p.proname IN ('protect_legacy_payment_ref','normalize_payment_receiver_name','protect_payment_resolution_audit','protect_package_order_snapshot'))) THEN RAISE EXCEPTION 'Payment schema already present'; END IF;`;
const duplicates = `IF EXISTS (SELECT 1 FROM public.payments WHERE easyslip_trans_ref IS NOT NULL GROUP BY easyslip_trans_ref HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate legacy references'; END IF;`;

export async function deploy(apply = false) {
  protect();
  const text = fs.readFileSync(file, 'utf8'), hash = digest(text), statements = migrationStatements(text);
  const sql = client();
  const tables = (await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r => r.tablename);
  if (!['members','payments','auth_sessions','packages'].every(t => tables.includes(t))) throw new Error('Required baseline tables missing');
  await sql.query(`DO $$ BEGIN ${absent} ${duplicates} END $$`);
  const roles = await sql.query(`SELECT rolname FROM pg_roles WHERE rolcanlogin AND rolname<>current_user AND (has_table_privilege(rolname,'public.members','INSERT,UPDATE,DELETE') OR has_table_privilege(rolname,'public.payments','INSERT,UPDATE,DELETE'))`);
  // Known Neon administrative roles are infrastructure, not browser-facing application identities.
  const unexpected = roles.filter(r => !['cloud_admin','neon_superuser','neon_service','postgres'].includes(r.rolname));
  if (unexpected.length) throw new Error('Additional database writers require grant review');
  const publicWrite = await sql.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`);
  if (publicWrite[0].n) throw new Error('PUBLIC write grants are unsafe');
  const dir = await backup(sql, tables);
  await verify(dir, sql);
    execFileSync(process.execPath, [path.join(root, 'scripts/db-payments-integration.mjs'), dir], { cwd: root, stdio: 'inherit', timeout: 120000 });
  const snapshot = JSON.parse(fs.readFileSync(path.join(dir, 'snapshot.json'), 'utf8'));
  const guards = tables.map(t => sql.query(`DO $guard$ BEGIN IF (SELECT md5(coalesce(json_agg(t ORDER BY to_jsonb(t)::text),'[]'::json)::text) FROM public.${quote(t)} t) <> md5(${"'" + snapshot.tables[t].rows.replaceAll("'", "''") + "'"}) THEN RAISE EXCEPTION 'Backup data drift'; END IF; END $guard$`));
  if (digest(fs.readFileSync(file, 'utf8')) !== hash) throw new Error('Migration edited during preparation');
  if (!apply) { console.log(JSON.stringify({ status: 'preflight-ready', migrationSha256: hash, tables: tables.length })); return; }
  const functions = statements.filter(s => /^CREATE FUNCTION /i.test(s)).map(s => s.match(/^CREATE FUNCTION ([a-z_]+)/i)[1]);
  const result = await sql.transaction([
    sql.query("SET LOCAL lock_timeout='5s'"), sql.query("SET LOCAL statement_timeout='60s'"),
    sql.query('SET LOCAL search_path=public,pg_catalog'),
    sql.query(`LOCK TABLE ${tables.map(t => 'public.' + quote(t)).join(',')} IN SHARE ROW EXCLUSIVE MODE`),
    sql.query(`DO $$ BEGIN ${absent} ${duplicates} END $$`), ...guards,
    ...statements.map(s => sql.query(s)),
    sql.query(`DO $acl$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${functions.map(n => "'" + n + "'").join(',')}) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature); EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_catalog',f.signature); END LOOP; END $acl$`),
    ...guards,
    sql.query("SELECT (SELECT count(*) FROM public.payment_transfer_refs)::int AS legacy_refs, (SELECT count(*) FROM public.package_payment_orders)::int AS orders, (SELECT count(*) FROM public.package_payment_attempts)::int AS attempts"),
  ], { isolationLevel: 'Serializable' });
  const report = { status: 'applied', migrationSha256: hash, backup: path.relative(root, dir), unchangedExistingTables: tables, schema: result.at(-1)[0], functions: functions.length, publicFunctionExecute: false };
  save(path.join(local, 'payments-deploy-' + stamp() + '.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) deploy(process.argv.includes('--apply')).catch(safeFailure);
