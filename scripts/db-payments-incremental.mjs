import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { client, protect, root, local, quote, digest, save, stamp, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';
import { incrementalPaymentStatements } from './db-payments-sql.mjs';
const expected = 'ca3e8e319e2cbc61e783fd8aa052e270dac5ccd306fe5bc37559428f8f2ff771';
const original = 'f25634355d4935628e043cfab03d6e176af2e41eb3f97d39c2d11c5d12e1a779';
const file = path.join(root, 'src/db/migrations/20261010_payment_promptpay.sql');
const names = ['normalize_payment_receiver_name','protect_package_payment_attempt','claim_package_payment_attempt','finalize_package_payment','prepare_owner_payment_recheck'];
const literal = v => "'" + v.replaceAll("'", "''") + "'";
const duplicates = "IF EXISTS(SELECT 1 FROM public.payments WHERE easyslip_trans_ref IS NOT NULL GROUP BY easyslip_trans_ref HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate references'; END IF;";
const baseline = "IF to_regprocedure('public.prepare_owner_payment_recheck(uuid,integer,text)') IS NOT NULL OR to_regprocedure('public.finalize_package_payment(uuid,integer,text,uuid)') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.package_payment_resolution_audit'::regclass AND conname='package_payment_resolution_audit_action_check' AND position('OWNER_RECHECK' in pg_get_constraintdef(oid))=0) THEN RAISE EXCEPTION 'Unexpected baseline'; END IF;";
async function deploy() {
  protect();
  const text = fs.readFileSync(file,'utf8');
  if (digest(text)!==expected || digest(fs.readFileSync(path.join(root,'src/db/migrations/20261009_real_package_payments.sql'),'utf8'))!==original) throw new Error('Pinned SQL changed');
  const statements = incrementalPaymentStatements(text), sql = client();
  const tables = (await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  await sql.query(`DO $$ BEGIN ${baseline} ${duplicates} END $$`);
  const unsafe = await sql.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')");
  if(unsafe[0].n) throw new Error('Unsafe PUBLIC grants');
  const roles = await sql.query("SELECT rolname FROM pg_roles WHERE rolcanlogin AND rolname<>current_user AND (has_table_privilege(rolname,'public.members','INSERT,UPDATE,DELETE') OR has_table_privilege(rolname,'public.payments','INSERT,UPDATE,DELETE'))");
  if(roles.some(r=>!['cloud_admin','neon_superuser','neon_service','postgres'].includes(r.rolname))) throw new Error('Unreviewed writers');
  const dir = await backup(sql,tables); await verify(dir,sql);
  const defs = await sql.query("SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.oid");
  save(path.join(dir,'functions-before.sql'), defs.map(r=>r.definition+';').join('\n'));
  execFileSync(process.execPath,[path.join(root,'scripts/payment-sql-tests.mjs'),'--run-memory'],{cwd:root,stdio:'inherit',timeout:120000});
  execFileSync(process.execPath,[path.join(root,'scripts/db-payments-integration.mjs'),dir,'--incremental'],{cwd:root,stdio:'inherit',timeout:120000});
  const snapshot=JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json'),'utf8'));
  const guards=()=>tables.map(t=>sql.query(`DO $guard$ BEGIN IF (SELECT md5(coalesce(json_agg(t ORDER BY to_jsonb(t)::text),'[]'::json)::text) FROM public.${quote(t)} t)<>md5(${literal(snapshot.tables[t].rows)}) THEN RAISE EXCEPTION 'Snapshot drift'; END IF; END $guard$`));
  if(digest(fs.readFileSync(file,'utf8'))!==expected) throw new Error('SQL changed');
  if(!process.argv.includes('--apply')) { console.log(JSON.stringify({status:'preflight-ready',backup:path.relative(root,dir),migrationSha256:expected})); return; }
  const list=names.map(literal).join(',');
  const post=`DO $post$ BEGIN IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${list}) AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_catalog'])<>5 THEN RAISE EXCEPTION 'Function configuration mismatch'; END IF; IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='public' AND p.proname IN (${list}) AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'PUBLIC execution'; END IF; IF position('PROMPTPAY' in pg_get_functiondef('public.finalize_package_payment(uuid,integer,text,uuid)'::regprocedure))=0 OR position('PROVIDER_VALIDATION_FAILED' in pg_get_functiondef('public.prepare_owner_payment_recheck(uuid,integer,text)'::regprocedure))=0 THEN RAISE EXCEPTION 'Missing payment recovery logic'; END IF; END $post$`;
  const result=await sql.transaction([
    sql.query("SET LOCAL lock_timeout='5s'"),sql.query("SET LOCAL statement_timeout='60s'"),sql.query('SET LOCAL search_path=public,pg_catalog'),
    sql.query(`LOCK TABLE ${tables.map(t=>'public.'+quote(t)).join(',')} IN SHARE ROW EXCLUSIVE MODE`),
    sql.query(`DO $$ BEGIN ${baseline} ${duplicates} END $$`),...guards(),...statements.map(s=>sql.query(s)),
    sql.query(`DO $acl$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${list}) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature); EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_catalog',f.signature); END LOOP; END $acl$`),
    sql.query(post),...guards(),sql.query("SELECT count(*)::int AS pendingRejectedWithoutEvidence FROM package_payment_orders o JOIN package_payment_attempts a ON a.order_id=o.id WHERE o.status='PENDING' AND a.state='REJECTED' AND a.evidence IS NULL AND a.rejection_reason='PROVIDER_VALIDATION_FAILED'")
  ],{isolationLevel:'Serializable'});
  const report={status:'applied',migrationSha256:expected,originalSha256:original,backup:path.relative(root,dir),functionsBeforeSha256:digest(fs.readFileSync(path.join(dir,'functions-before.sql'))),unchangedPublicTables:tables,functions:5,publicExecute:false,searchPath:'public,pg_catalog',validation:'Pinned parser; isolated original then incremental fixtures; live metadata acceptance; backup verified; pre/post snapshot guards',pendingRejectedWithoutEvidence:result.at(-1)[0].pendingrejectedwithoutevidence,noRecoveryExecuted:true,noProviderSmsOrCredits:true};
  const reportFile=path.join(local,'payments-incremental-'+stamp()+'.json'); save(reportFile,JSON.stringify(report,null,2)); console.log(JSON.stringify({...report,report:path.relative(root,reportFile)}));
}
deploy().catch(safeFailure);
