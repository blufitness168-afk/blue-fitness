// Native isolated PostgreSQL; no env file, production DB, provider or customer data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bin=join(root,'.local-db/portable-postgres-uat/package/native/bin');
const bridge=join(root,'.local-db/portable-postgres-uat/psql.py');
const exe=n=>join(bin,n+(process.platform==='win32'?'.exe':''));
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
function run(name,args,input='') {
 return new Promise((resolve,reject)=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.toUpperCase().startsWith('PG') && k!=='DATABASE_URL'));
  env.PGPASSFILE=join(root,'.local-db/avatar-no-password-file');
  env.PYTHONIOENCODING='utf-8';
  // Existing local adapter uses native libpq against the actual PostgreSQL server, not stock psql.
  const child=spawn(name==='psql'?'python':exe(name),name==='psql'?[bridge,...args]:args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env});
  let out='',err='';const timer=setTimeout(()=>child.kill(),30000);
  child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});
  child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(out.trim());else reject(Error(`${name}: ${err}`));});
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
test('native staff avatar: actual SQL auth, claim races, CAS, atomic audit and source', {timeout:180000}, async t=>{
 for(const n of ['initdb','pg_ctl'])assert.ok(existsSync(exe(n)),`Native ${n} unavailable; SQL validation incomplete`);
 assert.ok(existsSync(bridge),'Native libpq adapter unavailable; SQL validation incomplete');
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const dir=mkdtempSync(join(root,'.local-db/staff-avatar-test-')),data=join(dir,'data');let started=false;
 const sql=s=>run('psql',['-X','-qAt','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],s);
 const json=async s=>JSON.parse(await sql(s));
 const payload=(patch={})=>({memberCode:'BLU-3',contentHash:'a'.repeat(64),mime:'image/jpeg',expectedVersion:0,reason:'Synthetic avatar correction',...patch});
 const claim=(p=payload(),key=randomUUID(),lease=randomUUID(),session='s2')=>json(`SELECT staff_avatar_claim(${quote(session)},${quote(key)},${quote(JSON.stringify(p))},${quote(lease)});`);
 const read=(code='BLU-3',session='s2')=>json(`SELECT staff_avatar_read(${quote(session)},${quote(code)});`);
 const url=id=>`https://res.cloudinary.com/offline/image/upload/v1/${id}.jpg`;
 const finish=(key,lease,asset,session='s2',code='BLU-3')=>json(`SELECT staff_avatar_finish(${quote(session)},${quote(code)},${quote(key)},${quote(lease)},${quote(asset)});`);
 try {
  await run('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','-E','UTF8']);
  const log=openSync(join(dir,'pg_ctl.log'),'a');
  try {
   execFileSync(exe('pg_ctl'),['-D',data,'-l',join(dir,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','-t','20','start'],{timeout:30000,stdio:['ignore',log,log]});started=true;
  } finally { closeSync(log); }
  await sql(`CREATE TABLE members(id serial PRIMARY KEY,member_code text UNIQUE,role text,status text,avatar_url text,avatar_changed boolean DEFAULT false,updated_at timestamptz);
   CREATE TABLE auth_sessions(id serial PRIMARY KEY,member_id integer REFERENCES members(id),token_hash text UNIQUE,mode text DEFAULT 'NORMAL',revoked_at timestamptz,expires_at timestamptz);
   INSERT INTO members(member_code,role,status) SELECT 'BLU-'||i,CASE WHEN i=1 THEN 'OWNER' WHEN i IN (2,4) THEN 'ADMIN' ELSE 'MEMBER' END,'ACTIVE' FROM generate_series(1,5) i;
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'s'||id,now()+interval '1 day' FROM members;`);
  await sql(readFileSync(new URL('../db/migrations/20261118_R2_staff_avatar.sql',import.meta.url),'utf8'));
  await t.test('live auth and exact role target matrix, including self and owner denial',async()=>{
   assert.deepEqual(await read(),{avatarUrl:null,version:0,source:'LEGACY'});
   for(const token of ['missing','s3'])await assert.rejects(claim(payload(),randomUUID(),randomUUID(),token),/42501/);
   for(const code of ['BLU-1','BLU-2','BLU-4','missing'])await assert.rejects(read(code),/42501/);
   assert.equal((await read('BLU-4','s1')).version,0);await assert.rejects(read('BLU-1','s1'),/42501/);
   for(const mutation of ["UPDATE auth_sessions SET mode='KIOSK' WHERE member_id=2","UPDATE auth_sessions SET revoked_at=now() WHERE member_id=2","UPDATE auth_sessions SET expires_at=now() WHERE member_id=2","UPDATE members SET status='SUSPENDED' WHERE id=2","UPDATE members SET role='MEMBER' WHERE id=2"])
    await assert.rejects(sql(`BEGIN; ${mutation}; SELECT staff_avatar_read('s2','BLU-3'); ROLLBACK;`),/42501/);
   for(const p of [{reason:''},{expectedVersion:-1},{expectedVersion:0.5},{contentHash:'bad'},{mime:'image/svg+xml'},{url:'https://evil.invalid'},{source:'STAFF_UPLOAD'}])await assert.rejects(claim(payload(p)),/22023/);
  });
  const key=randomUUID(),lease=randomUUID();let c;
  await t.test('claim precedes upload: parallel duplicate rejected, hash pinned, expiry recovery keeps asset id',async()=>{
   c=await claim(payload(),key,lease);assert.equal(c.done,false);assert.equal(c.recover,false);
   await assert.rejects(claim(payload(),key),/P0001/);
   await assert.rejects(claim(payload({contentHash:'b'.repeat(64)}),key),/P0001/);
   assert.equal(await sql('SELECT count(*) FROM staff_avatar_requests;'),'1');
   await sql(`UPDATE staff_avatar_requests SET lease_until=now()-interval '1 second';`);
   const recovered=await claim(payload(),key,lease);assert.equal(recovered.publicId,c.publicId);
   const newLease=randomUUID();await sql(`UPDATE staff_avatar_requests SET lease_until=now()-interval '1 second';`);
   const results=await Promise.allSettled([claim(payload(),key,newLease),claim(payload(),key,randomUUID())]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='fulfilled').value.recover,true);
   await assert.rejects(finish(key,lease,url(c.publicId)),/22023/);
   // Return the lease to the original attempt solely in the synthetic fixture.
   await sql(`UPDATE staff_avatar_requests SET lease=${quote(lease)};`);
  });
  await t.test('final authorization independently denies changed session/role/target; no arbitrary URL',async()=>{
   for(const mutation of ["UPDATE auth_sessions SET mode='KIOSK' WHERE member_id=2","UPDATE auth_sessions SET revoked_at=now() WHERE member_id=2","UPDATE auth_sessions SET expires_at=now() WHERE member_id=2","UPDATE members SET role='OWNER' WHERE id=3","UPDATE members SET role='MEMBER' WHERE id=2"])
    await assert.rejects(sql(`BEGIN; ${mutation}; SELECT staff_avatar_finish('s2','BLU-3',${quote(key)},${quote(lease)},${quote(url(c.publicId))}); ROLLBACK;`),/42501/);
   for(const bad of ['https://evil.invalid/a.jpg',url(c.publicId).replace('/3/','/5/'),url(c.publicId)+'?x=1'])await assert.rejects(finish(key,lease,bad),/22023/);
   assert.equal((await read()).version,0);
  });
  await t.test('audit failure rolls entire finish back; success/replay increments exactly once',async()=>{
   await sql("CREATE FUNCTION avatar_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$; CREATE TRIGGER avatar_fail BEFORE INSERT ON staff_avatar_audit FOR EACH ROW EXECUTE FUNCTION avatar_fail();");
   await assert.rejects(finish(key,lease,url(c.publicId)),/P0001/);assert.equal((await read()).version,0);
   assert.equal(await sql('SELECT completed FROM staff_avatar_requests;'),'f');
   await sql('DROP TRIGGER avatar_fail ON staff_avatar_audit;');
   assert.deepEqual(await finish(key,lease,url(c.publicId)),{ok:true});assert.deepEqual(await finish(key,lease,url(c.publicId)),{ok:true});
   assert.deepEqual(await claim(payload(),key),{done:true});
   assert.deepEqual(await read(),{avatarUrl:url(c.publicId),version:1,source:'STAFF_UPLOAD'});
   assert.equal(await sql('SELECT count(*) FROM staff_avatar_audit;'),'1');
   assert.equal(await sql('SELECT avatar_changed AND updated_at IS NOT NULL FROM members WHERE id=3;'),'t');
   for(const command of ["UPDATE staff_avatar_audit SET reason='bad'",'DELETE FROM staff_avatar_audit','TRUNCATE staff_avatar_audit'])await assert.rejects(sql(command),/P0001/);
  });
  await t.test('legacy/self-photo changes invalidate stale version without metadata laundering; ACL',async()=>{
   const k=randomUUID(),l=randomUUID(),pending=await claim(payload({expectedVersion:1}),k,l);
   await sql("UPDATE members SET avatar_url='https://legacy.invalid/photo.jpg',avatar_version=999 WHERE id=3;");
   assert.deepEqual(await read(),{avatarUrl:'https://legacy.invalid/photo.jpg',version:2,source:'LEGACY'});
   await assert.rejects(finish(k,l,url(pending.publicId)),/P0001/);
   await sql('CREATE ROLE avatar_browser NOLOGIN;');
   assert.equal(await sql("SELECT has_table_privilege('avatar_browser','staff_avatar_requests','SELECT') OR has_function_privilege('avatar_browser','staff_avatar_finish(text,text,uuid,uuid,text)','EXECUTE');"),'f');
   assert.equal(await sql("SELECT count(*) FROM pg_proc WHERE proname LIKE 'staff_avatar_%' AND (prosecdef OR NOT ('search_path=pg_catalog, public'=ANY(proconfig)));"),'0');
   assert.equal(await sql('SELECT count(*) FROM staff_avatar_audit;'),'1');
  });
  await t.test('OWNER can attach to ADMIN, suspended MEMBER target allowed; concurrent different keys have one CAS winner',async()=>{
   const k=randomUUID(),l=randomUUID();
   const a=await claim(payload({memberCode:'BLU-4'}),k,l,'s1');
   await finish(k,l,url(a.publicId),'s1','BLU-4');assert.equal((await read('BLU-4','s1')).source,'STAFF_UPLOAD');
   await sql("UPDATE members SET status='SUSPENDED' WHERE id=5;");
   const keys=[randomUUID(),randomUUID()],leases=[randomUUID(),randomUUID()];
   const assets=await Promise.all(keys.map((key,i)=>claim(payload({memberCode:'BLU-5'}),key,leases[i])));
   const results=await Promise.allSettled(keys.map((key,i)=>finish(key,leases[i],url(assets[i].publicId),'s2','BLU-5')));
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
   assert.equal((await read('BLU-5')).version,1);assert.equal(await sql('SELECT count(*) FROM staff_avatar_audit WHERE member_id=5;'),'1');
  });
 } finally {if(started)await run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);rmSync(dir,{recursive:true,force:true});}
});
