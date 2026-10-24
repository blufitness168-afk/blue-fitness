import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { client, protect, root, local, digest, quote, save, stamp, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';
import { splitSql } from './db-payments-sql.mjs';
async function main() {
 const args=process.argv.slice(2);const text=fs.readFileSync(path.join(root,'src/db/migrations/20261024_kiosk.sql'),'utf8');const sha=digest(text);
 if (!args.includes('--apply')) { console.log(JSON.stringify({state:'prepare-only',sha256:sha,apply:'node scripts/db-kiosk-migrate.mjs --apply --reviewed-sha '+sha,noConnection:true}));return; }
 const index=args.indexOf('--reviewed-sha');
 if(index<0 || args[index+1]!==sha || args.length!==3) throw Error('Review current migration and supply exact --reviewed-sha');
 protect();
 execFileSync(process.execPath,[path.join(root,'scripts/kiosk-sql-tests.mjs')],{cwd:root,stdio:'inherit',timeout:120000});
 const sql=client();
 const baseline=await sql`SELECT to_regprocedure('public.kiosk_checkin(text,text,uuid,text)') AS kiosk,to_regprocedure('public.finalize_package_payment(uuid,integer,text,uuid)') AS payment`;
 if(baseline[0].kiosk || !baseline[0].payment) throw Error('Unexpected baseline; no automatic reapply');
 const tables=(await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
 const directory=await backup(sql,tables);await verify(directory,sql);
 const definitions=await sql.query("SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.oid");
 save(path.join(directory,'functions-before.sql'),definitions.map(r=>r.definition+';').join('\n'));
 const snapshot=JSON.parse(fs.readFileSync(path.join(directory,'snapshot.json'),'utf8'));
 const literal=v=>"'"+v.replaceAll("'","''")+"'";
 const dataGuards=(after=false)=>tables.map(t=>{
  const rows=JSON.parse(snapshot.tables[t].rows);
  const expression=after && t==='auth_sessions' ? "to_jsonb(t)-'mode'-'device_id'" : 'to_jsonb(t)';
  return sql.query(`DO $guard$ BEGIN IF (SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM (SELECT ${expression} AS r FROM public.${quote(t)} t) original) IS DISTINCT FROM (SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]'::jsonb) FROM jsonb_array_elements(${literal(JSON.stringify(rows))}::jsonb) r) THEN RAISE EXCEPTION 'Snapshot drift or data mutation'; END IF; END $guard$`);
 });
 const securityCheck=`DO $check$ DECLARE f record; n integer:=0; BEGIN
 FOR f IN SELECT p.oid,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('create_package_payment_order','claim_package_payment_attempt','finalize_package_payment','prepare_owner_payment_recheck','reject_unresolved_package_payment') LOOP
  n:=n+1;
  IF f.definition !~ 'mode = ''NORMAL'' AND (s\\.)?token_hash=p_session' THEN RAISE EXCEPTION 'Unsafe payment predicate'; END IF;
 END LOOP;
 IF n<>5 THEN RAISE EXCEPTION 'Expected five payment functions'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE ns.nspname='public' AND p.proname IN ('kiosk_checkin','create_package_payment_order','claim_package_payment_attempt','finalize_package_payment','prepare_owner_payment_recheck','reject_unresolved_package_payment') AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'Unsafe PUBLIC execute'; END IF;
 END $check$`; 
 await sql.transaction([
  sql.query("SET LOCAL lock_timeout='5s'"),sql.query("SET LOCAL statement_timeout='60s'"),sql.query('SET LOCAL search_path=public,pg_catalog'),
  sql.query(`LOCK TABLE ${tables.map(t=>'public.'+quote(t)).join(',')} IN SHARE ROW EXCLUSIVE MODE`),...dataGuards(),
  ...splitSql(text).map(s=>sql.query(s)),
  ...dataGuards(true),sql.query(securityCheck),
  sql.query("DO $$ BEGIN IF EXISTS(SELECT 1 FROM auth_sessions WHERE mode<>'NORMAL' OR device_id IS NOT NULL) THEN RAISE EXCEPTION 'Unexpected session mutation'; END IF; END $$"),
 ],{isolationLevel:'Serializable'});
 const postMetadata=await sql.query("SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_sessions' ORDER BY ordinal_position");
 await sql.query(securityCheck);
 const mode=postMetadata.find(c=>c.column_name==='mode');
 if(mode?.is_nullable!=='NO' || !mode.column_default?.includes("'NORMAL'")) throw Error('Unexpected mode default');
 const report={postMetadata,securityChecks:'five NORMAL predicates; no PUBLIC execute; original table data unchanged inside transaction',state:'applied',sha256:sha,backup:path.relative(root,directory),fixturesCreated:false,noPaymentOrSmsCalls:true};
 save(path.join(local,'kiosk-migration-'+stamp()+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(safeFailure);
