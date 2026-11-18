import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
function load(path,imports,env={DATABASE_URL:'OFFLINE',SMS_API_SECRET:'SYNTHETIC_KEY_NOT_PRODUCTION',ENABLE_ADMIN_PASSWORD_RESET:'true'}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:n=>{assert.ok(n in imports,n);return imports[n];},process:{env},Buffer,Date});
 return exports;
}
const registration=load('./auth/registration.ts',{zod:require('zod')});
const body=()=>({requestKey:'11111111-1111-4111-8111-111111111111',reason:'Staff correction',password:'Synthetic Password 123'});
const req=(b=body(),headers={})=>new Request('https://offline.invalid/api/admin/members/PW-3/password',{
 method:'POST',headers:{origin:'https://offline.invalid','content-type':'application/json',...headers},body:JSON.stringify(b)});
class WorkLimit extends Error {}
function harness({role='ADMIN',status='ACTIVE',actor=true,token='a'.repeat(64),states=['claimed','done'],error,hashError,env}={}) {
 const calls=[];let hashes=0;let authCalls=0;let sqlClients=0;let digestCalls=0;
 const lib=load('./admin-member-password-server.ts',{
  'server-only':{},'node:crypto':{...require('node:crypto'),createHash:(...args)=>{digestCalls++;return require('node:crypto').createHash(...args);},createHmac:(...args)=>{digestCalls++;return require('node:crypto').createHmac(...args);}},zod:require('zod'),
  '@neondatabase/serverless':{neon:()=>{sqlClients++;return async(parts,...values)=>{calls.push({sql:parts.join('?'),values});if(error)throw error;return [{result:states[calls.length-1]}];};}},
  'next/headers':{cookies:async()=>({get:()=>({value:token})})},
  './auth/server':{SESSION_COOKIE:'blu_session',getCurrentMember:async()=>{authCalls++;return actor?{id:2,role,status}:null;}},
  './auth/http':{json:(data,status=200)=>({data,status}),sameOrigin:r=>r.headers.get('sec-fetch-site')!=='cross-site'&&r.headers.get('origin')===new URL(r.url).origin},
  './auth/registration':registration,
  './auth/password':{PasswordWorkLimitError:WorkLimit,hashPassword:async()=>{hashes++;if(hashError)throw hashError;return 'SYNTHETIC_CREDENTIAL_HASH';}},
  './payment-server':{boundedBody:async(r,max)=>{const b=Buffer.from(await r.text());if(b.length>max)throw Error('large');return b;}},
 },env);
 return {run:lib.resetAdminMemberPassword,enabled:lib.isAdminPasswordResetEnabled,calls,get hashes(){return hashes;},get authCalls(){return authCalls;},get sqlClients(){return sqlClients;},get digestCalls(){return digestCalls;}};
}
test('password reset defaults off with no auth, SQL client/query, digest or scrypt work',async()=>{
 for(const value of [undefined,'','false','TRUE','1',' true','true ']) {
  const env={DATABASE_URL:'OFFLINE',SMS_API_SECRET:'SYNTHETIC_KEY_NOT_PRODUCTION'};
  if(value!==undefined)env.ENABLE_ADMIN_PASSWORD_RESET=value;
  const h=harness({env});assert.equal(h.enabled(),false);
  assert.equal((await h.run(req(),'PW-3')).status,503);
  assert.equal(h.authCalls,0);assert.equal(h.sqlClients,0);assert.equal(h.calls.length,0);assert.equal(h.digestCalls,0);assert.equal(h.hashes,0);
  assert.equal((await h.run(req(body(),{origin:'https://other.invalid'}),'PW-3')).status,403);
  assert.equal(h.authCalls,0);
 }
 assert.equal(harness().enabled(),true);
});
test('password API auth/origin/schema bounds before SQL or scrypt',async()=>{
 for(const [options,headers,code] of [[{actor:false},{},401],[{role:'MEMBER'},{},403],[{status:'SUSPENDED'},{},403],
  [{token:'bad'},{},401],[{},{origin:'https://other.invalid'},403],[{},{'sec-fetch-site':'cross-site'},403],[{},{'content-type':'text/plain'},400]]){
  const h=harness(options);assert.equal((await h.run(req(body(),headers),'PW-3')).status,code);assert.equal(h.hashes,0);assert.equal(h.calls.length,0);
 }
 const bad=[{...body(),password:'short'},{...body(),password:'x'.repeat(129)},{...body(),reason:' '},
  {...body(),reason:body().password},{...body(),reason:'x'.repeat(241)},{...body(),requestKey:'bad'},{...body(),password:2},
  {...body(),padding:'x'.repeat(5000)}];
 for(const f of ['actorId','role','status','memberCode','phone','passwordHash','bodyMac','token'])bad.push({...body(),[f]:'spoof'});
 for(const b of bad){const h=harness();assert.equal((await h.run(req(b),'PW-3')).status,400);assert.equal(h.hashes,0);assert.equal(h.calls.length,0);}
});
test('claim-before-hash / deny busy limited replay conflict unknown never hash',async()=>{
 for(const [state,status] of [['done',200],['busy',409],['limited',429],['unexpected',503]]) {
  const h=harness({states:[state]});const r=await h.run(req(),'PW-3');assert.equal(r.status,status);assert.equal(h.hashes,0);assert.equal(h.calls.length,1);
  assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC|bodyMac|scrypt|Password 123/);
 }
 for(const [code,status] of [['42501',403],['P0001',409],['22023',400],['40001',503]]) {
  const h=harness({error:{code,message:'SQL SECRET SENTINEL'}});const r=await h.run(req(),'PW-3');assert.equal(r.status,status);assert.equal(h.hashes,0);assert.doesNotMatch(JSON.stringify(r),/SECRET|SQL/);
 }
});
test('HMAC binds fixed UUID body actor target reason password, uses existing secret; no raw password in SQL',async()=>{
 const expected=createHmac('sha256','SYNTHETIC_KEY_NOT_PRODUCTION').update(JSON.stringify([
  'blu:admin-member-password:v1',2,'PW-3',body().requestKey,body().reason,body().password])).digest('hex');
 const macs=[];
 for(const [b,target] of [[body(),'PW-3'],[body(),'PW-3'],[{...body(),password:'Changed Password 456'},'PW-3'],[{...body(),reason:'Other reason'},'PW-3'],[body(),'PW-5']]) {
  const h=harness();const r=await h.run(req(b),target);assert.equal(r.status,200);assert.equal(h.hashes,1);assert.equal(h.calls.length,2);
  const raw=h.calls[0].values[2],p=JSON.parse(raw);macs.push(p.bodyMac);
  assert.deepEqual(Object.keys(p).sort(),['bodyMac','memberCode','reason']);
  assert.doesNotMatch(JSON.stringify(h.calls),/Synthetic Password 123|Changed Password 456|SYNTHETIC_KEY_NOT_PRODUCTION/);
  assert.equal(h.calls[1].values[3],'SYNTHETIC_CREDENTIAL_HASH');
  assert.deepEqual(JSON.parse(JSON.stringify(r)),{data:{ok:true},status:200});
 }
 assert.equal(macs[0],expected);assert.equal(macs[0],macs[1]);assert.equal(new Set(macs).size,4);
 const h=harness({env:{DATABASE_URL:'OFFLINE',ENABLE_ADMIN_PASSWORD_RESET:'true'}});assert.equal((await h.run(req(),'PW-3')).status,503);assert.equal(h.hashes,0);assert.equal(h.calls.length,0);
});
test('hash work saturation/unknown finalize fails closed without fabricated success or retry',async()=>{
 for(const [options,status,calls] of [[{hashError:new WorkLimit()},429,1],[{hashError:new Error('SECRET')},503,1],[{states:['claimed','unexpected']},503,2]]){
  const h=harness(options);const r=await h.run(req(),'PW-3');assert.equal(r.status,status);assert.equal(h.hashes,1);assert.equal(h.calls.length,calls);assert.doesNotMatch(JSON.stringify(r),/SECRET|SYNTHETIC/);
 }
});
test('UI only in allowed member detail, fixed in-memory body, no browser persistence/response echo',()=>{
 const form=read('../app/admin/members/[memberCode]/AdminMemberPasswordForm.tsx');
 assert.match(form,/crypto.randomUUID\(\)/);assert.match(form,/if \(!pending.current\)/);assert.match(form,/body: pending.current/);
 assert.match(form,/pending.current = null/);assert.match(form,/fieldset disabled=\{locked\}/);assert.match(form,/type="password"/);
 assert.doesNotMatch(form,/sessionStorage|localStorage|console\.|data\.error|JSON\.stringify\(data\)/);
 assert.match(form,/redirect: "error"/);assert.match(form,/router.refresh\(\)/);
 const page=read('../app/admin/members/[memberCode]/page.tsx');
 assert.match(page,/isAdminPasswordResetEnabled\(\) && canEdit && caller.memberCode !== m.memberCode && m.status !== "SUSPENDED" && <AdminMemberPasswordForm/);
 assert.match(page,/import \{ isAdminPasswordResetEnabled \} from "@\/lib\/admin-member-password-server"/);
 const helper=read('./admin-member-password-server.ts');
 assert.match(helper,/import "server-only"/);assert.match(helper,/process\.env\.ENABLE_ADMIN_PASSWORD_RESET === "true"/);
 assert.doesNotMatch(helper+page+form,/NEXT_PUBLIC_.*PASSWORD_RESET/);
 const route=read('../app/api/admin/members/[memberCode]/password/route.ts');assert.match(route,/await params/);assert.match(route,/runtime = "nodejs"/);
 assert.doesNotMatch(read('./admin-member-password-server.ts'),/console\.|verifyPassword|\.transaction\(/);
});
