// Explicit production-file target; no connection or writes without inspect/apply flags.
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
const migration='src/db/migrations/20261031_payment_receiver_bank.sql';
const oldGuard="AND a.evidence->>'bankCode'='004'";
const newGuard="AND (o.receiver_snapshot->>'bankCode') ~ '^[0-9]{3}$'";
export function replaceBankGuard(definition) {
 assert.equal(definition.split(oldGuard).length-1,1,'Expected exactly one obsolete bank guard');
 return definition.replace(oldGuard,()=>newGuard);
}
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const metadataQuery=`SELECT jsonb_build_object(
 'identity',jsonb_build_object('database',current_database(),'role',current_user),
 'columns',(SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name,ordinal_position) FROM information_schema.columns c WHERE table_schema='public'),
 'tables',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM (SELECT c.oid,c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') x),
 'functions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM (SELECT p.oid,p.proname,p.proowner,p.proacl,p.proconfig,p.prosecdef,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f') x)
 ) AS metadata`;
const getMetadata=async sql=>(await sql.query(metadataQuery))[0].metadata;
function plan(){
 const inputs=[migration,'scripts/db-receiver-bank-migrate.mjs','scripts/db-safety.mjs','scripts/db-backup.mjs','scripts/db-verify-backup.mjs','scripts/db-payments-sql.mjs','scripts/bangkok-receiver-uat.mjs','src/lib/payment-receiver-bank.test.mjs','scripts/db-receiver-bank.test.mjs'];
 const hashes=Object.fromEntries(inputs.map(p=>[p,digest(fs.readFileSync(path.join(root,p),'utf8'))]));
 const statements=splitSql(fs.readFileSync(path.join(root,migration),'utf8'));
 assert.equal(statements.shift(),'BEGIN');assert.equal(statements.pop(),'COMMIT');assert.equal(statements.length,1);assert.match(statements[0],/^DO /);
 return {sha256:digest(JSON.stringify(hashes)),hashes,statements};
}
function target(){
 const env=dotenv.parse(fs.readFileSync(path.join(root,'.env.production')));
 assert(env.DATABASE_URL,'Production DATABASE_URL missing');
 assert.equal(env.PAYMENT_TRANSFERS_ENABLED,'false','Production file must still disable transfers');
 return neon(env.DATABASE_URL);
}
function baseline(m){
 const functions=m.functions.filter(f=>f.proname==='finalize_package_payment');assert.equal(functions.length,1,'Expected one finalizer');
 const f=functions[0];assert.equal(f.definition.split(oldGuard).length-1,1,'Unsupported baseline or already applied');
 assert.match(f.definition,/mode = 'NORMAL'/);assert(f.proconfig.includes('search_path=public, pg_catalog'));assert.equal(f.prosecdef,false);
 assert(m.tables.every(t=>!['p','f','m'].includes(t.relkind)),'Unsupported table kind');
 return f;
}
const guard=(query,expected,message)=>`DO $guard$ BEGIN IF (${query}) IS DISTINCT FROM ${literal(JSON.stringify(expected))}::jsonb THEN RAISE EXCEPTION '${message}'; END IF; END $guard$`;
async function main(){
 const args=process.argv.slice(2),p=plan();
 if(!args.length){console.log(JSON.stringify({state:'prepare-only',noConnection:true,sha256:p.sha256,hashes:p.hashes,targetFile:'.env.production',migration,inspect:'node scripts/db-receiver-bank-migrate.mjs --inspect'},null,2));return;}
 assert(args.length===1&&args[0]==='--inspect'||args.length===5&&args[0]==='--apply'&&args[1]==='--reviewed-sha'&&args[2]===p.sha256&&args[3]==='--reviewed-db'&&/^[a-f0-9]{64}$/.test(args[4]),'Exact reviewed flags/SHA required');
 protect();
 if(args[0]==='--apply')execFileSync(process.execPath,['--test','src/lib/payment-receiver-bank.test.mjs','scripts/db-receiver-bank.test.mjs'],{cwd:root,stdio:'inherit',timeout:90000});
 const sql=target(),m=await getMetadata(sql),f=baseline(m);
 const unsafe=(await sql.query("SELECT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.finalize_package_payment(uuid,integer,text,uuid)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS unsafe"))[0].unsafe;
 assert.equal(unsafe,false,'PUBLIC finalizer EXECUTE');
 const fingerprint=digest(JSON.stringify(m));
 if(args[0]==='--inspect'){
  const file=path.join(local,'receiver-bank-inspect-'+stamp()+'.json');save(file,JSON.stringify({sha256:p.sha256,metadata:m},null,2));
  console.log(JSON.stringify({state:'read-only-inspection',databaseFingerprint:fingerprint,finalizerSha256:digest(f.definition),normalGuard:true,publicExecute:false,transfersEnabled:false,report:path.relative(root,file)}));return;
 }
 assert.equal(fingerprint,args[4],'Metadata changed since review');assert.equal(plan().sha256,p.sha256,'Review inputs changed');
 const tables=m.tables.filter(t=>t.relkind==='r').map(t=>t.relname).sort();
 const directory=await backup(sql,tables);await verify(directory,sql);
 save(path.join(directory,'receiver-bank-metadata-before.json'),JSON.stringify(m,null,2));
 save(path.join(directory,'receiver-bank-plan.json'),JSON.stringify(p,null,2));
 const snapshot=JSON.parse(fs.readFileSync(path.join(directory,'snapshot.json'),'utf8'));
 const dataGuards=()=>tables.map(t=>{
  const columns=snapshot.columns.filter(c=>c.table_name===t).map(c=>`${literal(c.column_name)},t.${quote(c.column_name)}`).join(',');
  const query=`SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM (SELECT jsonb_build_object(${columns}) AS r FROM public.${quote(t)} t) rows`;
  const expected=JSON.parse(snapshot.tables[t].rows);
  return sql.query(`DO $guard$ BEGIN IF (${query}) IS DISTINCT FROM (SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM jsonb_array_elements(${literal(JSON.stringify(expected))}::jsonb) r) THEN RAISE EXCEPTION 'Data changed since backup or migration mutated data'; END IF; END $guard$`);
 });
 const expected=structuredClone(m);expected.functions.find(x=>x.oid===f.oid).definition=replaceBankGuard(f.definition);
 assert.equal(plan().sha256,p.sha256,'Inputs changed before transaction');
 await sql.transaction([
  sql.query("SET LOCAL lock_timeout='5s'"),sql.query("SET LOCAL statement_timeout='90s'"),
  sql.query("SELECT pg_advisory_xact_lock(hashtextextended('blue-fitness:receiver-bank-migration',0))"),
  sql.query(`LOCK TABLE ${tables.map(t=>'public.'+quote(t)).join(',')} IN SHARE ROW EXCLUSIVE MODE`),
  sql.query(guard(metadataQuery,m,'Metadata drift')),...dataGuards(),
  ...p.statements.map(s=>sql.query(s)),...dataGuards(),sql.query(guard(metadataQuery,expected,'Unexpected schema/function/ACL change')),
 ],{isolationLevel:'Serializable'});
 const report={state:'applied',sha256:p.sha256,backup:path.relative(root,directory),originalTablesPreserved:tables.length,onlyChange:'BANK_ACCOUNT finalizer bank guard uses immutable snapshot bank code instead of KBank-only literal',normalGuardAndAcl:'unchanged',ordersAndMembers:'unchanged',noSmsProviderOrTransfers:true,transfersEnabled:false};
 save(path.join(directory,'receiver-bank-applied.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main().catch(safeFailure);
