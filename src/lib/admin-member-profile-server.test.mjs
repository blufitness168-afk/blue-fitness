import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
function load(path,imports) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:name=>{assert.ok(name in imports,name);return imports[name];},process:{env:{DATABASE_URL:'OFFLINE_STUB'}},Buffer,Date});
 return exports;
}
const registration=load('./auth/registration.ts',{zod:require('zod')});
const profile={fullName:'Synthetic Member',nickname:'',gender:'OTHER',birthDay:29,birthMonth:2,
 emergencyName:'Contact',emergencyPhone:'0812345678',emergencyRelation:'Sibling'};
const expected={...profile,nickname:null,birthDay:null,birthMonth:null};
const body=()=>({requestKey:'11111111-1111-4111-8111-111111111111',reason:'Correction',profile:{...profile},expected:{...expected}});
const request=(payload,headers={})=>new Request('https://offline.invalid/api/admin/members/R2-3/profile',{
 method:'PATCH',headers:{origin:'https://offline.invalid','content-type':'application/json',...headers},body:JSON.stringify(payload)});
function harness({role='ADMIN',actor=true,status='ACTIVE',token='a'.repeat(64),error,result=[{secret:'SECRET'}]}={}) {
 const calls=[];
 const http={json:(data,status=200)=>({data,status}),sameOrigin:r=>r.headers.get('sec-fetch-site')!=='cross-site'&&(!r.headers.get('origin')||r.headers.get('origin')===new URL(r.url).origin)};
 const exports=load('./admin-member-profile-server.ts',{
  'server-only':{},'node:crypto':require('node:crypto'),zod:require('zod'),
  '@neondatabase/serverless':{neon:()=>async(parts,...values)=>{calls.push({sql:parts.join('?'),values});if(error)throw error;return result;}},
  'next/headers':{cookies:async()=>({get:()=>({value:token})})},
  './auth/server':{SESSION_COOKIE:'blu_session',getCurrentMember:async()=>actor?{id:2,role,status}:null},
  './auth/http':http,'./auth/registration':registration,
  './payment-server':{boundedBody:async(r,max)=>{const bytes=Buffer.from(await r.text());if(bytes.length>max)throw Error('large');return bytes;}},
 });
 return {run:exports.updateAdminMemberProfile,calls};
}
test('API denies no auth, MEMBER, suspended, invalid cookie, cross-site/origin before mutation SQL',async()=>{
 for(const [options,headers,code] of [[{actor:false},{},401],[{role:'MEMBER'},{},403],[{status:'SUSPENDED'},{},403],
  [{token:'invalid'},{},401],[{}, {origin:'https://other.invalid'},403],[{}, {'sec-fetch-site':'cross-site'},403]]) {
  const h=harness(options);assert.equal((await h.run(request(body(),headers),'R2-3')).status,code);assert.equal(h.calls.length,0);
 }
});
test('API strict nested allowlists reject phone/role/expiry/etc, malformed date/phone, reason/body limits',async()=>{
 const bad=[];
 for(const field of ['phone','role','expireDate','points','email','person_type','password','avatar','card','birthYear','actorId'])
  for(const level of ['root','profile','expected']) {
   const b=body(); if(level==='root')b[field]='spoof';else b[level][field]='spoof';bad.push(b);
  }
 for(const patch of [{birthDay:31,birthMonth:4},{birthDay:30,birthMonth:2},{birthYear:2000},{emergencyPhone:'+66812345678'},
  {emergencyPhone:'081-234-5678'},{fullName:'X'},{fullName:'x'.repeat(101)},{gender:'UNKNOWN'}])bad.push({...body(),profile:{...profile,...patch}});
 bad.push({...body(),reason:' '},{...body(),reason:'x'.repeat(241)},{...body(),requestKey:'bad'},{...body(),expected:null},{...body(),large:'x'.repeat(9000)});
 for(const b of bad){const h=harness();assert.equal((await h.run(request(b),'R2-3')).status,400);assert.equal(h.calls.length,0);}
 const h=harness();assert.equal((await h.run(request(body(),{'content-type':'text/plain'}),'R2-3')).status,400);
});
test('API reuses registration trim/default rules, preserves exact nullable snapshot, hashes token and returns allowlisted success',async()=>{
 for(const role of ['ADMIN','OWNER']) {
  const h=harness({role});const b=body();b.profile.fullName='  Synthetic Member  ';delete b.profile.nickname;b.reason=' Correction ';
  assert.deepEqual(JSON.parse(JSON.stringify(await h.run(request(b),'R2-3'))),{data:{ok:true},status:200});
  assert.equal(h.calls.length,1);
  const [digest,key,raw]=h.calls[0].values,payload=JSON.parse(raw);
  assert.equal(digest,createHash('sha256').update('a'.repeat(64)).digest('hex'));assert.equal(key,b.requestKey);
  assert.equal(payload.memberCode,'R2-3');assert.equal(payload.profile.fullName,'Synthetic Member');assert.equal(payload.profile.nickname,'');
  assert.equal(payload.reason,'Correction');assert.deepEqual(payload.expected,expected);
  assert.doesNotMatch(raw,/SECRET|token|password|birthYear/);
 }
});
test('API errors never expose DB detail/audit/session; unknown outcome not automatically retried',async()=>{
 for(const [code,status] of [['42501',403],['P0001',409],['22023',400],['08006',503],['40001',503]]) {
  const h=harness({error:{code,message:'SECRET SQL SESSION AUDIT'}}),b=body();
  const response=await h.run(request(b),'R2-3');assert.equal(response.status,status);assert.doesNotMatch(JSON.stringify(response),/SECRET|SQL|AUDIT/);
  assert.equal(h.calls.length,1);
  await h.run(request(b),'R2-3');assert.deepEqual(h.calls[0].values,h.calls[1].values);
 }
});
test('page embeds separate snapshot-only form without modifying detail money/history/role implementation',()=>{
 const page=read('../app/admin/members/[memberCode]/page.tsx');
 assert.match(page,/AdminMemberProfileForm/);assert.match(page,/data\.callerRole === "ADMIN" && m\.role === "MEMBER"/);
 assert.match(page,/\["MEMBER", "ADMIN"\]\.includes\(m\.role\)/);
 assert.match(page,/<Client data=\{data\} callerRole=\{caller.role\}/);
 const form=read('../app/admin/members/[memberCode]/AdminMemberProfileForm.tsx');
 assert.match(form,/crypto.randomUUID\(\)/);assert.match(form,/body: pending.current/);assert.match(form,/router.refresh\(\)/);
 assert.match(form,/fieldset disabled=\{locked\}/);assert.match(form,/if \(!pending.current\)/);
 assert.doesNotMatch(form,/type="password"|name="phone"|name="role"|name="expireDate"|name="points"/);
 const route=read('../app/api/admin/members/[memberCode]/profile/route.ts');
 assert.match(route,/await params/);assert.match(route,/updateAdminMemberProfile\(request, memberCode\)/);
});
