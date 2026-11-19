// Native PostgreSQL only; never reads env, backups, customer rows or DATABASE_URL.
// Uses installed portable tooling, fresh cluster, loopback only, bounded processes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const root=fileURLToPath(new URL('../../',import.meta.url));
const bin=join(root,'.local-db/portable-postgres-uat/package/native/bin');
const bridge=join(root,'.local-db/portable-postgres-uat/psql.py');
const exe=n=>join(bin,n+(process.platform==='win32'?'.exe':''));
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');

function run(name,args,input='') {
 return new Promise((resolve,reject)=>{
  // Inherited PGHOSTADDR/service options must not redirect a local test connection.
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('PG') && key!=='DATABASE_URL'));
  env.PGPASSFILE=join(root,'.local-db/member-card-no-password-file');
  env.PYTHONIOENCODING='utf-8';
  const child=spawn(name==='psql'?'python':exe(name),name==='psql'?[bridge,...args]:args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env});
  let out='',err='';const timer=setTimeout(()=>child.kill(),30000);
  child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});
  child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(out.trim());else reject(Error(`${name} failed: ${err.trim()}`));});
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}

for(const profile of ['october','r7']) test(`native member card SQL (${profile}): auth/version/audit, real admission and races`,{
 timeout:180000,
},async t=>{
 for(const name of ['initdb','pg_ctl'])assert.ok(existsSync(exe(name)),`Native ${name} unavailable; SQL validation incomplete`);
 assert.ok(existsSync(bridge),'Native libpq bridge unavailable; SQL validation incomplete');
 const hasR7=profile==='r7';
 const dir=mkdtempSync(join(root,'.local-db/member-card-test-')),data=join(dir,'data'),port=await freePort();let started=false;
 const sql=s=>run('psql',['-X','-qAt','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],s);
 const json=async s=>JSON.parse(await sql(s));
 const payload=(patch={})=>({memberCode:'BLU-3',cardCode:'CARD-00123',expectedVersion:0,reason:'Synthetic card correction',...patch});
 const action=(p=payload(),key=randomUUID(),token='s2')=>json(`SELECT member_card_update(${quote(token)},${quote(key)}::uuid,${quote(JSON.stringify(p))}::jsonb);`);
 const card=(code='BLU-3',token='s2')=>json(`SELECT member_card_read(${quote(token)},${quote(code)});`);
 const scan=(code='CARD-00123',direction='IN',token='s2',key=randomUUID())=>json(`SELECT member_scan_admit(${quote(token)},'TEST',${quote(key)}::uuid,${quote(code)},${direction===null?'NULL':quote(direction)});`);
 const snapshot=()=>sql(`SELECT jsonb_build_object('members',(SELECT jsonb_agg(ROW(m.*) ORDER BY m.id) FROM members m),'sessions',(SELECT jsonb_agg(ROW(s.*) ORDER BY s.id) FROM auth_sessions s),'orders',(SELECT jsonb_agg(ROW(o.*) ORDER BY o.id) FROM package_payment_orders o),'ledger',(SELECT jsonb_agg(ROW(l.*) ORDER BY l.order_id) FROM package_payment_point_ledger l),'finance',(SELECT jsonb_agg(ROW(f.*) ORDER BY f.id) FROM finance_entries f),'catalog',(SELECT jsonb_agg(ROW(c.*) ORDER BY c.id) FROM package_catalog c));`);
 try {
  await run('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','-E','UTF8']);
  const log=openSync(join(dir,'pg_ctl.log'),'a');
  try {
   // Detached server must not inherit the tool's stdout pipes on Windows.
   started=true;
   execFileSync(exe('pg_ctl'),['-D',data,'-l',join(dir,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','-t','20','start'],{timeout:30000,stdio:['ignore',log,log]});
  } finally { closeSync(log); }
  const fixture=read('./package-payment-benefits.test.mjs').match(/await db\.exec\(`([\s\S]*?)`\);/);assert.ok(fixture);await sql(fixture[1]);
    // Match actual persisted role enum, rather than accepting arbitrary mock role strings.
    await sql("CREATE TYPE member_role AS ENUM ('MEMBER','ADMIN','OWNER'); ALTER TABLE members ALTER COLUMN role TYPE member_role USING role::member_role; CREATE UNIQUE INDEX member_card_test_session_token ON auth_sessions(token_hash);");
  for(const name of ['20261009_real_package_payments','20261010_payment_promptpay','20261024_kiosk','20261024_real_benefits_admin','20261024_real_rewards','20261024_real_frontdesk','20261024_real_finance','20261025_package_payment_benefits','20261031_payment_receiver_bank','20261031_payment_currency_recheck','20261031_package_catalog','20261031_package_catalog_order_guard','20261118_r3_package_catalog','20261118_r3_package_catalog_checkin','20261118_R6_time_supplement','20261118_R7_visits'].filter(name=>hasR7 || !name.startsWith('20261118'))) {
     if(name==='20261031_payment_receiver_bank') {
      // Deployed October baseline hardens legacy invoker functions before guarded upgrades.
      // Match the existing combined SQL harness; do not remove or weaken migration guards.
      await sql(`DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature); EXECUTE format('ALTER FUNCTION %s SET search_path=public,pg_catalog',f.signature); END LOOP; END $$;`);
     }
     if(['20261118_r3_package_catalog_checkin','20261118_R6_time_supplement','20261118_R7_visits'].includes(name)) {
      const [anchor,replacement]=name==='20261118_r3_package_catalog_checkin'
       ? ["m.status='ACTIVE'","m.status='PENDING'"]
       : name==='20261118_R6_time_supplement'
        ? ['IF package_catalog_slot_allows(slot,local_time) THEN','IF false THEN']
        : ['time_supplement_allows','missing_supplement_test'];
      const migration=read(`../db/migrations/${name}.sql`).replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
      // Transactional source drift probe must hit the actual migration's guard and roll back.
      await assert.rejects(sql(`BEGIN; DO $$ BEGIN EXECUTE replace(pg_get_functiondef('real_frontdesk_checkin(text,text,uuid,text)'::regprocedure),${quote(anchor)},${quote(replacement)}); END $$; ${migration} ROLLBACK;`),/P0001/);
     }
     try { await sql(read(`../db/migrations/${name}.sql`)); }
     catch(error) { throw new Error(`Local migration failed: ${name}`,{cause:error}); }
    }
  await sql(`INSERT INTO members(member_code,full_name,status,role,points) SELECT 'BLU-'||i,'SYNTHETIC','EXPIRED',(CASE WHEN i=1 THEN 'OWNER' WHEN i IN (2,4,6) THEN 'ADMIN' ELSE 'MEMBER' END)::member_role,120+i FROM generate_series(1,7) i;
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'s'||id,now()+interval '1 day' FROM members;
   UPDATE auth_sessions SET mode='KIOSK',device_id='TEST' WHERE member_id=6;`);
  t.diagnostic(`Engine: ${await sql('SHOW server_version;')}; profile=${profile}; ${hasR7?'October + actual R3/R6/R7 and three drift guards':'October only; no R3/R6/R7 applied'}`);
  const before=await snapshot();
  const definitions=await sql("SELECT jsonb_object_agg(proname,pg_get_functiondef(oid)) FROM pg_proc WHERE proname IN ('kiosk_checkin','real_frontdesk_checkin','r7_visit_action');");
  const cardMigration=read('../db/migrations/20261118_R2_member_cards.sql');
  await assert.rejects(sql(`BEGIN; ALTER FUNCTION public.real_frontdesk_checkin(text,text,uuid,text) RENAME TO missing_admission_test; ${cardMigration.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')} ROLLBACK;`),/P0001/);
  await sql(cardMigration);
  assert.equal(await sql("SELECT to_regprocedure('public.r7_visit_action(text,text,uuid,text,text)') IS NOT NULL;"),hasR7?'t':'f');
  assert.equal(await snapshot(),before);
  assert.equal(await sql("SELECT jsonb_object_agg(proname,pg_get_functiondef(oid)) FROM pg_proc WHERE proname IN ('kiosk_checkin','real_frontdesk_checkin','r7_visit_action');"),definitions);
  await t.test('guarded empty state, target matrix and persisted session denial',async()=>{
   assert.deepEqual(await card(),{cardCode:null,version:0});
   for(const token of ['missing','s3','s6']){await assert.rejects(action(payload(),randomUUID(),token),/42501/);await assert.rejects(card('BLU-3',token),/42501/);}
   for(const code of ['BLU-1','BLU-2','BLU-4','missing']){await assert.rejects(card(code),/42501/);await assert.rejects(action(payload({memberCode:code})),/42501/);}
   assert.deepEqual(await card('BLU-4','s1'),{cardCode:null,version:0});await assert.rejects(card('BLU-1','s1'),/42501/);
   assert.deepEqual(await json(`BEGIN; SELECT member_card_update('s1',${quote(randomUUID())},${quote(JSON.stringify(payload({memberCode:'BLU-4',cardCode:'CARD-444'})))}); ROLLBACK;`),{ok:true});
   assert.deepEqual(await card('BLU-4','s1'),{cardCode:null,version:0});
   for(const mutation of ["UPDATE auth_sessions SET mode='KIOSK',device_id='TEST' WHERE member_id=2","UPDATE auth_sessions SET revoked_at=now() WHERE member_id=2","UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE member_id=2","UPDATE auth_sessions SET expires_at=NULL WHERE member_id=2","UPDATE members SET status='SUSPENDED' WHERE id=2","UPDATE members SET role='MEMBER' WHERE id=2"]){
    await assert.rejects(sql(`BEGIN; ${mutation}; SELECT member_card_read('s2','BLU-3'); ROLLBACK;`),/42501/);
    await assert.rejects(sql(`BEGIN; ${mutation}; SELECT member_card_update('s2',${quote(randomUUID())},${quote(JSON.stringify(payload()))}); ROLLBACK;`),/42501/);
    await assert.rejects(sql(`BEGIN; ${mutation}; SELECT member_card_admit('s2','TEST',${quote(randomUUID())},'CARD-00123','IN'); ROLLBACK;`),/42501/);
   }
  });
  await t.test('strict SQL fields and canonical grammar',async()=>{
   for(const patch of [{role:'OWNER'},{cardCode:'card-1'},{cardCode:'CARD-A1'},{cardCode:''},{cardCode:'123'},{cardCode:'CARD-１２'},{expectedVersion:-1},{expectedVersion:0.5},{expectedVersion:'x'},{expectedVersion:null},{expectedVersion:2147483647},{reason:''}])await assert.rejects(action(payload(patch)),/22023/);
  });
  const key=randomUUID();
  await t.test('atomic binding/replay, generic unique conflict, monotonic unbind and stale ABA',async()=>{
   assert.deepEqual(await action(payload(),key),{ok:true});assert.deepEqual(await action(payload(),key),{ok:true});
   assert.equal(await sql('SELECT count(*) FROM member_card_audit;'),'1');
   await assert.rejects(action(payload({reason:'changed'}),key),/P0001/);
   await assert.rejects(action(),/P0001/);
   await assert.rejects(action(payload({memberCode:'BLU-5'})),/P0001/);
   assert.deepEqual(await card('BLU-5'),{cardCode:null,version:0});
   await action(payload({cardCode:null,expectedVersion:1}));await action(payload({expectedVersion:2}));
   assert.deepEqual(await card(),{cardCode:'CARD-00123',version:3});
   await assert.rejects(action(payload({expectedVersion:1})),/P0001/);
   await action(payload(),key);assert.equal((await card()).version,3);
   for(const command of ["UPDATE member_card_audit SET reason='bad'",'DELETE FROM member_card_audit','TRUNCATE member_card_audit'])await assert.rejects(sql(command),/P0001/);
  });
  await t.test('audit failure rolls binding/version/key back; explicit transaction rollback',async()=>{
   await sql("CREATE FUNCTION card_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$; CREATE TRIGGER card_fail BEFORE INSERT ON member_card_audit FOR EACH ROW EXECUTE FUNCTION card_fail();");
   const p=payload({cardCode:'CARD-999',expectedVersion:3}),k=randomUUID();await assert.rejects(action(p,k),/P0001/);assert.deepEqual(await card(),{cardCode:'CARD-00123',version:3});
   await sql('DROP TRIGGER card_fail ON member_card_audit;');await action(p,k);
   await sql(`BEGIN; SELECT member_card_update('s2',${quote(randomUUID())},${quote(JSON.stringify(payload({cardCode:null,expectedVersion:4})))}); ROLLBACK;`);
   assert.deepEqual(await card(),{cardCode:'CARD-999',version:4});
  });
  await t.test('real CARD resolution denies no entitlement and suspended member; replay stays pinned after replacement',async()=>{
   const k=randomUUID(),first=await scan('CARD-999','IN','s2',k);assert.equal(first.ok,false);assert.ok(['CLOSED','NO_ENTITLEMENT'].includes(first.reason));
   const kiosk=await scan('CARD-999',null,'s6');assert.equal(kiosk.ok,false);assert.ok(['CLOSED','NO_ENTITLEMENT'].includes(kiosk.reason));
   await assert.rejects(scan('CARD-999',null,'s2'),/42501/);await assert.rejects(scan('CARD-999','IN','s6'),/42501/);
   await assert.rejects(sql(`SELECT member_card_admit('s6','WRONG',${quote(randomUUID())},'CARD-999',NULL);`),/42501/);
   await sql("UPDATE members SET status='SUSPENDED' WHERE id=3;");
   await action(payload({cardCode:'CARD-998',expectedVersion:4}));
   assert.equal((await scan('CARD-998')).reason,'SUSPENDED');assert.equal((await scan('CARD-998',null,'s6')).reason,'SUSPENDED');
   assert.deepEqual(await scan('CARD-999','IN','s2',k),first);
   assert.equal((await scan('CARD-999')).reason,'NOT_FOUND');if(hasR7)assert.equal((await scan('CARD-998','OUT')).reason,'NO_OPEN_VISIT');
      else await assert.rejects(scan('CARD-998','OUT'),/0A000/);
   await sql("UPDATE members SET status='EXPIRED' WHERE id=3;");
   assert.equal(await sql('SELECT count(*) FROM checkins;'),'0');assert.equal(await sql('SELECT count(*) FROM package_payment_orders;'),'0');
  });
  await t.test('parallel native connections cannot bind the same card twice; identical UUID audits once',async()=>{
   const results=await Promise.allSettled([action(payload({memberCode:'BLU-5',cardCode:'CARD-777'})),action(payload({memberCode:'BLU-7',cardCode:'CARD-777'}))]);
   assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
   assert.match(results.find(x=>x.status==='rejected').reason.message,/P0001/);
   assert.equal(await sql("SELECT count(*) FROM member_cards WHERE card_code='CARD-777';"),'1');
   const p=payload({cardCode:'CARD-997',expectedVersion:5}),k=randomUUID();const before=Number(await sql('SELECT count(*) FROM member_card_audit;'));
   await Promise.all([action(p,k),action(p,k)]);assert.equal(Number(await sql('SELECT count(*) FROM member_card_audit;')),before+1);
  });
  await t.test('actual welcome entitlement admission (time-gated), paired OUT and kiosk entry-only',async()=>{
   // Synthetic welcome coupons only: no fake orders, PAID state or provider evidence.
   await sql("INSERT INTO coupons(member_id,type,source,title,total_quota,used_count,expire_date) VALUES (3,'FREE_ENTRY','WELCOME_REGISTRATION','Synthetic welcome',1,0,now()+interval '1 day'),(5,'FREE_ENTRY','WELCOME_REGISTRATION','Synthetic welcome',1,0,now()+interval '1 day');");
   const c5=await card('BLU-5');await action(payload({memberCode:'BLU-5',cardCode:'CARD-555',expectedVersion:c5.version}));
   const admissionSnapshot=()=>sql(`SELECT jsonb_build_object('coupons',(SELECT jsonb_agg(ROW(c.*) ORDER BY c.id) FROM coupons c),'checkins',(SELECT jsonb_agg(ROW(c.*) ORDER BY c.id) FROM checkins c),'visits',${hasR7?'(SELECT jsonb_agg(ROW(v.*) ORDER BY v.id) FROM r7_visits v)':'NULL'},'r7Requests',${hasR7?'(SELECT jsonb_agg(ROW(r.*) ORDER BY r.actor_id,r.request_key) FROM r7_visit_requests r)':'NULL'},'legacyRequests',(SELECT jsonb_agg(ROW(r.*) ORDER BY r.station,r.request_key) FROM kiosk_requests r),'bounce',(SELECT jsonb_agg(ROW(b.*) ORDER BY b.station,b.member_id) FROM kiosk_member_bounce b),'cardRequests',(SELECT jsonb_agg(ROW(r.*) ORDER BY r.actor_id,r.station,r.channel,r.request_key) FROM member_card_scan_requests r),'bindings',(SELECT jsonb_agg(ROW(b.*) ORDER BY b.member_id) FROM member_cards b),'bindingAudit',(SELECT jsonb_agg(ROW(a.*) ORDER BY a.id) FROM member_card_audit a));`);
   const k=randomUUID(),beforeAdmission=await admissionSnapshot();
   await sql("CREATE FUNCTION card_admit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected outer request failure'; END $$; CREATE TRIGGER card_admit_fail BEFORE INSERT ON member_card_scan_requests FOR EACH ROW EXECUTE FUNCTION card_admit_fail();");
   await assert.rejects(scan('CARD-997','IN','s2',k),/P0001/);
   await assert.rejects(scan('CARD-555',null,'s6'),/P0001/);
   assert.equal(await admissionSnapshot(),beforeAdmission);
   await sql('DROP TRIGGER card_admit_fail ON member_card_scan_requests;');
   const [entry,duplicate]=await Promise.all([scan('CARD-997','IN','s2',k),scan('CARD-997','IN','s2',k)]);
   assert.deepEqual(duplicate,entry);
   const kioskKey=randomUUID();
   const [kiosk,kioskDuplicate]=await Promise.all([scan('CARD-555',null,'s6',kioskKey),scan('CARD-555',null,'s6',kioskKey)]);
   assert.deepEqual(kioskDuplicate,kiosk);
   assert.deepEqual(await json(`SELECT member_card_admit('s6','TEST',${quote(kioskKey)},'CARD-555',NULL);`),kiosk);
   assert.equal(await sql('SELECT count(*) FROM checkins WHERE member_id=3;'),entry.ok?'1':'0');
   assert.equal(await sql('SELECT count(*) FROM checkins WHERE member_id=5;'),kiosk.ok?'1':'0');
   for(const result of [entry,kiosk])assert.ok(result.ok ? result.reason==='FREE_ENTRY' : result.reason==='CLOSED');
   assert.equal(entry.outSupported,hasR7);
   if(entry.ok && hasR7){
    assert.equal((await scan('CARD-997')).reason,'ALREADY_IN');
    assert.equal((await scan('CARD-997','OUT')).reason,'EXIT');
    assert.equal(await sql('SELECT count(*) FROM r7_visits WHERE exited_at IS NOT NULL;'),'1');
   } else if(!entry.ok) assert.equal(await sql('SELECT used_count FROM coupons WHERE member_id=3;'),'0');
   t.diagnostic(`Actual admission: frontdesk=${entry.reason}, kiosk=${kiosk.reason}; no PAID/order/provider evidence created`);
   const countRows=()=>sql(`SELECT jsonb_build_object('checkins',(SELECT count(*) FROM checkins),'visits',${hasR7?'(SELECT count(*) FROM r7_visits)':'NULL'});`);
   const counts=await countRows();
   if(!hasR7){
    const beforeOut=await admissionSnapshot();
    for(const code of ['CARD-997','BLU-3'])await assert.rejects(scan(code,'OUT'),/0A000/);
    assert.equal(await admissionSnapshot(),beforeOut);
   }
   await action(payload({cardCode:null,expectedVersion:(await card()).version}));
   assert.equal((await scan('CARD-997')).reason,'NOT_FOUND');
   await action(payload({memberCode:'BLU-7',cardCode:'CARD-997',expectedVersion:(await card('BLU-7')).version}));
   assert.deepEqual(await scan('CARD-997','IN','s2',k),entry);
   assert.equal(await countRows(),counts);
   assert.ok(['NO_ENTITLEMENT','CLOSED'].includes((await scan('CARD-997')).reason));
   await assert.rejects(scan('CARD-555','IN','s2',k),/22023/);
   if(hasR7)assert.equal(await sql('SELECT count(*) FROM r7_visits WHERE member_id=5;'),'0');
   else assert.equal(await sql("SELECT to_regclass('public.r7_visits') IS NULL;"),'t');
   assert.equal(await sql('SELECT coalesce(sum(points_awarded),0) FROM checkins;'),'0');
  });
  await t.test('existing admission error is not absence; no fallback/retry after dispatch',async()=>{
   const signature=hasR7?'r7_visit_action(text,text,uuid,text,text)':'real_frontdesk_checkin(text,text,uuid,text)';
   const args=hasR7?'p_session text,p_station text,p_key uuid,p_code text,p_direction text':'p_session text,p_station text,p_key uuid,p_code text';
   const name=signature.split('(')[0];
   await assert.rejects(sql(`BEGIN; CREATE OR REPLACE FUNCTION public.${name}(${args}) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic downstream undefined-function error' USING ERRCODE='42883'; END $$; SELECT member_scan_admit('s2','TEST',${quote(randomUUID())},'BLU-7','IN'); ROLLBACK;`),/42883/);
   assert.equal(await sql("SELECT jsonb_object_agg(proname,pg_get_functiondef(oid)) FROM pg_proc WHERE proname IN ('kiosk_checkin','real_frontdesk_checkin','r7_visit_action');"),definitions);
  });
  await t.test('real frontdesk server BLU/CARD dispatch and history execute on this installed SQL profile',async()=>{
   const cookie='a'.repeat(64),digest=createHash('sha256').update(cookie).digest('hex');
   const filename=fileURLToPath(new URL('./real-checkin-server.ts',import.meta.url));
   const loaded=new Module(filename);loaded.filename=filename;
   loaded.require=name=>{
    if(name==='server-only')return {};
    if(name==='next/headers')return {cookies:async()=>({get:()=>({value:cookie})})};
    if(name==='@neondatabase/serverless')return {neon:()=>async(parts,...values)=>{
     const query=parts.reduce((q,p,i)=>q+(i?(values[i-1]===null?'NULL':quote(values[i-1])):'')+p,'');
     return json(`SELECT coalesce(jsonb_agg(row_to_json(q)),'[]'::jsonb) FROM (${query}) q;`);
    }};
    if(name==='./auth/server')return {SESSION_COOKIE:'session',getCurrentMember:async()=>({role:'ADMIN'})};
    if(name==='./auth/http')return {readBody:r=>r.json(),json:(body,status=200)=>({body,status})};
    return require(name);
   };
   loaded._compile(ts.transpileModule(read('./real-checkin-server.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
   const env=process.env.DATABASE_URL;process.env.DATABASE_URL='LOCAL_NATIVE_TRANSPORT_ONLY';
   try {
    await sql(`UPDATE auth_sessions SET token_hash=${quote(digest)} WHERE member_id=2;`);
    for(const code of [' blu-7 \r\n',' card-997 \r\n']){
     const response=await loaded.exports.realCheckinAction(new Request('http://offline.invalid/api/admin/checkin/scan',{method:'POST',body:JSON.stringify({code,direction:'IN',requestKey:randomUUID()})}),'scan');
     assert.equal(response.status,200);assert.equal(response.body.ok,false);assert.ok(['NO_ENTITLEMENT','CLOSED'].includes(response.body.reason));assert.equal(response.body.outSupported,hasR7);
    }
    const history=await loaded.exports.realCheckinAction(new Request('http://offline.invalid/api/admin/checkin/history',{method:'POST',body:JSON.stringify({query:''})}),'history');
    assert.equal(history.status,200);assert.equal(history.body.outSupported,hasR7);assert.equal(history.body.hourly.length,24);
    assert.equal(history.body.records.length,Number(await sql('SELECT count(*) FROM checkins;')));
   } finally {
    await sql(`UPDATE auth_sessions SET token_hash='s2' WHERE member_id=2;`);
    if(env===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=env;
   }
  });
  await t.test('existing members/auth/finance/order/ledger snapshots unchanged; backend-only ACL and fixed search path',async()=>{
   assert.equal(await snapshot(),before);
   await sql('CREATE ROLE card_browser NOLOGIN;');
   const acl=await json("SELECT jsonb_build_object('table',has_table_privilege('card_browser','member_cards','SELECT'),'function',has_function_privilege('card_browser','member_card_read(text,text)','EXECUTE'));");assert.deepEqual(acl,{table:false,function:false});
   assert.equal(await sql("SELECT count(*) FROM pg_proc WHERE (proname LIKE 'member_card_%' OR proname='member_scan_admit') AND (prosecdef OR NOT ('search_path=pg_catalog, public'=ANY(proconfig)));"),'0');
  });
 } finally {
  if(started)await run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
  rmSync(dir,{recursive:true,force:true});
 }
});
