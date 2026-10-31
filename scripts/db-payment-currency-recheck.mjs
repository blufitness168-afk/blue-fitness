import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { protect, root, local, digest, quote, save, stamp, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';
import { splitSql } from './db-payments-sql.mjs';
const migration='src/db/migrations/20261031_payment_currency_recheck.sql';
// User explicitly moved the production-target configuration into this ignored file.
const targetFile='.env.local';
const signature='public.prepare_owner_payment_currency_recheck(uuid,integer,text)';
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const functionQuery="SELECT p.oid,p.proname,p.proowner,p.proacl,p.proconfig,p.prosecdef,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'";
const metadataQuery=`SELECT jsonb_build_object('identity',jsonb_build_object('database',current_database(),'role',current_user),'functions',(SELECT jsonb_agg(to_jsonb(f) ORDER BY oid) FROM (${functionQuery}) f),'columns',(SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name,ordinal_position) FROM information_schema.columns c WHERE table_schema='public'),'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY tablename) FROM pg_tables t WHERE schemaname='public')) AS metadata`;
function plan(){
 const inputs=[migration,'scripts/db-payment-currency-recheck.mjs','src/lib/payment-currency-recheck.test.mjs','scripts/db-safety.mjs','scripts/db-backup.mjs','scripts/db-verify-backup.mjs','scripts/db-payments-sql.mjs'];
 const hashes=Object.fromEntries(inputs.map(p=>[p,digest(fs.readFileSync(path.join(root,p),'utf8'))]));
 const statements=splitSql(fs.readFileSync(path.join(root,migration),'utf8'));assert.equal(statements.shift(),'BEGIN');assert.equal(statements.pop(),'COMMIT');assert.equal(statements.length,2);assert.match(statements[0],/^CREATE FUNCTION prepare_owner_payment_currency_recheck/);assert.match(statements[1],/^REVOKE ALL/);
 return {sha256:digest(JSON.stringify(hashes)),hashes,statements};
}
const guard=(query,expected,message)=>`DO $guard$ BEGIN IF (${query}) IS DISTINCT FROM ${literal(JSON.stringify(expected))}::jsonb THEN RAISE EXCEPTION '${message}'; END IF; END $guard$`;
async function main(){
 const args=process.argv.slice(2),p=plan();if(!args.length){console.log(JSON.stringify({state:'prepare-only',sha256:p.sha256,hashes:p.hashes,targetFile,noConnection:true},null,2));return;}
 assert(args.length===1&&args[0]==='--inspect'||args.length===5&&args[0]==='--apply'&&args[1]==='--reviewed-sha'&&args[2]===p.sha256&&args[3]==='--reviewed-db'&&/^[a-f0-9]{64}$/.test(args[4]),'Exact reviewed flags required');
 protect();if(args[0]==='--apply')execFileSync(process.execPath,['--test','src/lib/payment-currency-recheck.test.mjs'],{cwd:root,stdio:'inherit',timeout:90000});
 const env=dotenv.parse(fs.readFileSync(path.join(root,targetFile)));assert(env.DATABASE_URL,'Production URL missing');const sql=neon(env.DATABASE_URL);
 const m=(await sql.query(metadataQuery))[0].metadata;
 assert(!(await sql.query('SELECT to_regprocedure($1) IS NOT NULL AS present',[signature]))[0].present,'Already installed; do not reapply');
 const finalizer=m.functions.find(f=>f.proname==='finalize_package_payment');assert(finalizer&&finalizer.definition.includes("AND (o.receiver_snapshot->>'bankCode') ~ '^[0-9]{3}$'"),'Receiver-bank fix prerequisite');
 assert(m.functions.some(f=>f.proname==='prepare_owner_payment_recheck'),'Original recovery prerequisite');
 if(args[0]==='--inspect'){
  const report=path.join(local,'currency-recheck-inspect-'+stamp()+'.json');save(report,JSON.stringify({metadata:m,sha256:p.sha256},null,2));console.log(JSON.stringify({state:'read-only-inspection',databaseFingerprint:digest(JSON.stringify(m)),report:path.relative(root,report)}));return;
 }
 assert.equal(digest(JSON.stringify(m)),args[4],'Metadata drift');assert.equal(plan().sha256,p.sha256,'Inputs changed');
 const tables=m.tables.map(t=>t.tablename).sort(),directory=await backup(sql,tables);await verify(directory,sql);
 save(path.join(directory,'currency-recheck-before.json'),JSON.stringify(m,null,2));save(path.join(directory,'currency-recheck-plan.json'),JSON.stringify(p,null,2));
 const snapshot=JSON.parse(fs.readFileSync(path.join(directory,'snapshot.json'),'utf8'));
 const dataGuards=()=>tables.map(t=>{
  const columns=snapshot.columns.filter(c=>c.table_name===t).map(c=>`${literal(c.column_name)},t.${quote(c.column_name)}`).join(',');
  const q=`SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM (SELECT jsonb_build_object(${columns}) AS r FROM public.${quote(t)} t) original_rows`;
  return sql.query(`DO $guard$ BEGIN IF (${q}) IS DISTINCT FROM (SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM jsonb_array_elements(${literal(snapshot.tables[t].rows)}::jsonb) r) THEN RAISE EXCEPTION 'Data drift or mutation'; END IF; END $guard$`);
 });
 const expected=structuredClone(m);delete expected.functions;
 const otherMetadata=`SELECT (${metadataQuery}) - 'functions'`;
 const oldFunctions=`SELECT jsonb_agg(to_jsonb(f) ORDER BY oid) FROM (${functionQuery} AND p.oid IN (${m.functions.map(f=>f.oid).join(',')})) f`;
 const security=`DO $guard$ DECLARE f record; BEGIN
 SELECT p.*,pg_get_functiondef(p.oid) AS body INTO f FROM pg_proc p WHERE p.oid=${literal(signature)}::regprocedure;
 IF f.prosecdef OR NOT coalesce('search_path=public, pg_catalog'=ANY(f.proconfig),false) OR f.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
 OR position('THB_NUMERIC_CURRENCY_FIX' in f.body)=0 OR position('mode=''NORMAL''' in f.body)=0
 OR (SELECT count(*) FROM (${functionQuery}) x)<>${m.functions.length+1} THEN RAISE EXCEPTION 'Unsafe recovery function'; END IF; END $guard$`;
 assert.equal(plan().sha256,p.sha256,'Inputs changed before transaction');
 await sql.transaction([sql.query("SET LOCAL lock_timeout='5s'"),sql.query("SET LOCAL statement_timeout='90s'"),sql.query("SELECT pg_advisory_xact_lock(hashtextextended('blue-fitness:currency-recheck-deploy',0))"),sql.query(`LOCK TABLE ${tables.map(t=>'public.'+quote(t)).join(',')} IN SHARE ROW EXCLUSIVE MODE`),sql.query(guard(metadataQuery,m,'Metadata drift')),...dataGuards(),...p.statements.map(s=>sql.query(s)),...dataGuards(),sql.query(guard(oldFunctions,m.functions,'Existing function changed')),sql.query(guard(otherMetadata,expected,'Schema changed')),sql.query(security)],{isolationLevel:'Serializable'});
 const report={state:'applied',sha256:p.sha256,backup:path.relative(root,directory),unchangedTables:tables.length,oldFunctionsUnchanged:true,onlyAddition:'Owner currency-fix recovery function with single-use audit',noAttemptReopened:true,noProviderSmsOrMoney:true};
 save(path.join(directory,'currency-recheck-applied.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(safeFailure);
