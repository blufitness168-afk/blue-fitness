import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
function load(path,imports) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:n=>{assert.ok(n in imports,n);return imports[n];},process:{env:{DATABASE_URL:'OFFLINE_STUB'}},Buffer,URL});
 return exports;
}
const http=load('./auth/http.ts',{'server-only':{},'next/server':{NextResponse:{json:(data,options)=>({data,...options})}}});
const body=()=>({requestKey:'11111111-1111-4111-8111-111111111111',reason:'Correction',expectedVersion:0,email:'  Contact@Example.COM  '});
const request=(payload=body(),{method='PATCH',headers={},query=''}={})=>new Request('https://offline.invalid/api/admin/members/CE-3/contact-email'+query,{
 method,headers:{origin:'https://offline.invalid','content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(payload)})});
function harness({role='ADMIN',actor=true,status='ACTIVE',token='a'.repeat(64),error,contact={email:null,version:0},result={ok:true,secret:'SECRET'}}={}) {
 const calls=[];
 const exports=load('./member-contact-email-server.ts',{
  'server-only':{},'node:crypto':require('node:crypto'),zod:require('zod'),
  '@neondatabase/serverless':{neon:()=>async(parts,...values)=>{calls.push({sql:parts.join('?'),values});if(error)throw error;return [{result,contact}];}},
  'next/headers':{cookies:async()=>({get:()=>({value:token})})},
  './auth/server':{SESSION_COOKIE:'blu_session',getCurrentMember:async()=>actor?{id:2,role,status}:null},
  './auth/http':http,'./payment-server':{boundedBody:async(r,max)=>{const b=Buffer.from(await r.text());if(b.length>max)throw Error('large');return b;}},
 });
 return {run:exports.memberContactEmailRequest,read:exports.getMemberContactEmail,calls};
}
test('GET/PATCH auth, method, origin and cross-site denied; no spoofed identity headers trusted',async()=>{
 for(const method of ['GET','PATCH'])for(const [options,headers,code] of [
  [{actor:false},{'x-role':'OWNER','x-member-id':'1'},401],[{role:'MEMBER'},{},403],[{status:'SUSPENDED'},{},403],
  [{token:'invalid'},{},401],[{},{origin:'https://other.invalid'},403],[{},{origin:'','sec-fetch-site':'cross-site'},403]]) {
  const h=harness(options);assert.equal((await h.run(request(body(),{method,headers}),'CE-3')).status,code);assert.equal(h.calls.length,0);
 }
 for(const method of ['POST','PUT','DELETE']){const h=harness();assert.equal((await h.run(request(body(),{method}),'CE-3')).status,405);assert.equal(h.calls.length,0);}
});
test('strict API fields, bounded JSON, invalid email/version/key and content type',async()=>{
 const bad=[];
 for(const field of ['actorId','role','phone','password','personType','amount','verified','version'])bad.push({...body(),[field]:'spoof'});
 for(const email of ['bad','อีเมล@example.com','a..b@example.com','a@bad_domain.com','a@-bad.com','x'.repeat(255)+'@example.com',{},42])bad.push({...body(),email});
 bad.push({...body(),expectedVersion:-1},{...body(),expectedVersion:'0'},{...body(),expectedVersion:0.1},
  {...body(),reason:''},{...body(),requestKey:'bad'},{...body(),extra:'x'.repeat(5000)});
 for(const p of bad){const h=harness();assert.equal((await h.run(request(p),'CE-3')).status,400);assert.equal(h.calls.length,0);}
 const h=harness();assert.equal((await h.run(request(body(),{headers:{'content-type':'text/plain'}}),'CE-3')).status,400);
 assert.equal((await h.run(request(body(),{method:'GET',query:'?actorId=1'}),'CE-3')).status,400);
});
test('trim ASCII casefold, empty/null clearing, exact UUID replay and response allowlist',async()=>{
 for(const [email,expected] of [[' Contact@Example.COM ','contact@example.com'],['   ',null],[null,null]]) {
  const h=harness(),p={...body(),email};
  const response=await h.run(request(p),'CE-3');assert.equal(response.status,200);assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{ok:true});
  assert.equal(response.headers['Cache-Control'],'no-store');
  const [digest,key,raw]=h.calls[0].values;
  assert.equal(digest,createHash('sha256').update('a'.repeat(64)).digest('hex'));assert.equal(key,p.requestKey);
  assert.deepEqual(JSON.parse(raw),{memberCode:'CE-3',email:expected,expectedVersion:0,reason:'Correction'});
  await h.run(request(p),'CE-3');assert.deepEqual(h.calls[0].values,h.calls[1].values);
 }
});
test('separate guarded read; unavailable migration never returns null-success or DB/PII details',async()=>{
 const h=harness({contact:{email:'contact@example.com',version:7}});
 const r=await h.run(request(body(),{method:'GET'}),'CE-3');assert.equal(r.status,200);
 assert.deepEqual(JSON.parse(JSON.stringify(r.data)),{contact:{email:'contact@example.com',version:7}});
 assert.match(h.calls[0].sql,/member_contact_email_read/);
 for(const [code,status] of [['42501',403],['P0001',409],['23505',409],['22023',400],['42883',503],['42P01',503],['08006',503]]) {
  const h=harness({error:{code,message:'SECRET contact@example.com token SQL'}});
  const r=await h.run(request(),'CE-3');assert.equal(r.status,status);assert.doesNotMatch(JSON.stringify(r),/SECRET|contact@example.com|token|SQL/);
  if(code==='23505')assert.doesNotMatch(JSON.stringify(r),/อีเมลติดต่อซ้ำ|บัญชีที่ซ้ำ|duplicate|email/i);
    if(status===503){await assert.rejects(h.read('CE-3'));assert.equal((await h.run(request(body(),{method:'GET'}),'CE-3')).status,503);}
 }
 const invalid=harness({contact:{email:null,version:0,secret:'SECRET'}});
 assert.equal((await invalid.run(request(body(),{method:'GET'}),'CE-3')).status,503);
});
test('UI separate contact-only form preserves existing page components and guarded load',()=>{
 const page=read('../app/admin/members/[memberCode]/page.tsx');
 for(const name of ['AdminMemberProfileForm','AdminMemberPasswordForm','AdminMemberContactEmailForm','getMemberContactEmail'])assert.match(page,new RegExp(name));
 assert.match(page,/await requireAdminPage\("\/admin\/members"\)[\s\S]*canEdit\s*\?\s*(?:await\s+)?getMemberContactEmail\(m\.memberCode\)\.catch\(\(\) => null\)\s*:\s*null/);
 assert.match(page,/\{canEdit && \(contact/);assert.match(page,/contact\.version/);
 const form=read('../app/admin/members/[memberCode]/AdminMemberContactEmailForm.tsx');
 assert.match(form,/body: pending.current/);assert.match(form,/crypto.randomUUID/);assert.match(form,/router.refresh/);
 assert.match(form,/fieldset disabled=\{locked\}/);assert.doesNotMatch(form,/localStorage|sessionStorage|console\.|name="password"|name="phone"/);
 const route=read('../app/api/admin/members/[memberCode]/contact-email/route.ts');
 assert.match(route,/await params/);assert.match(route,/export const GET = handle/);assert.match(route,/export const PATCH = handle/);
});
