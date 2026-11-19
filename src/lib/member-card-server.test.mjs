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
const body=()=>({requestKey:'11111111-1111-4111-8111-111111111111',reason:'Replace damaged card',expectedVersion:0,cardCode:' card-00123 \r\n'});
const request=(payload=body(),{method='PATCH',headers={},query=''}={})=>new Request('https://offline.invalid/api/admin/members/BLU-3/card'+query,{
 method,headers:{origin:'https://offline.invalid','content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(payload)})});
function harness({role='ADMIN',actor=true,status='ACTIVE',token='a'.repeat(64),error,card={cardCode:null,version:0},result={ok:true,secret:'SECRET'}}={}) {
 const calls=[];
 const exports=load('./member-card-server.ts',{
  'server-only':{},'node:crypto':require('node:crypto'),zod:require('zod'),
  '@neondatabase/serverless':{neon:()=>async(parts,...values)=>{calls.push({sql:parts.join('?'),values});if(error)throw error;return [{result,card}];}},
  'next/headers':{cookies:async()=>({get:()=>({value:token})})},
  './auth/server':{SESSION_COOKIE:'blu_session',getCurrentMember:async()=>actor?{id:2,role,status}:null},
  './auth/http':http,'./payment-server':{boundedBody:async(r,max)=>{const b=Buffer.from(await r.text());if(b.length>max)throw Error('large');return b;}},
 });
 return {run:exports.memberCardRequest,read:exports.getMemberCard,calls};
}
test('card GET/PATCH authenticate before DB; origin/method/actor spoofing denied',async()=>{
 for(const method of ['GET','PATCH'])for(const [options,headers,code] of [
  [{actor:false},{'x-role':'OWNER'},401],[{role:'MEMBER'},{},403],[{status:'SUSPENDED'},{},403],
  [{token:'invalid'},{},401],[{},{origin:'https://other.invalid'},403],[{},{origin:'','sec-fetch-site':'cross-site'},403]]) {
  const h=harness(options);assert.equal((await h.run(request(body(),{method,headers}),'BLU-3')).status,code);assert.equal(h.calls.length,0);
 }
 for(const method of ['POST','PUT','DELETE'])assert.equal((await harness().run(request(body(),{method}),'BLU-3')).status,405);
});
test('strict card grammar, bounded payload, version and reason validation',async()=>{
 const bad=[];
 for(const field of ['actorId','memberCode','role','phone','password','personType','points','expiry','version'])bad.push({...body(),[field]:'spoof'});
 for(const cardCode of ['', '123','CARD-A1','CARD-1-2','CARD-１２','BLU-3','https://x/CARD-1',42,{},'CARD-'+'1'.repeat(96)])bad.push({...body(),cardCode});
 for(const patch of [{expectedVersion:-1},{expectedVersion:0.1},{expectedVersion:'0'},{expectedVersion:2147483647},{reason:' '},{reason:'x'.repeat(241)},{requestKey:'bad'},{extra:'x'.repeat(5000)}])bad.push({...body(),...patch});
 for(const p of bad){const h=harness();assert.equal((await h.run(request(p),'BLU-3')).status,400);assert.equal(h.calls.length,0);}
 assert.equal((await harness().run(request(body(),{headers:{'content-type':'text/plain'}}),'BLU-3')).status,400);
 assert.equal((await harness().run(request(body(),{method:'GET',query:'?actorId=1'}),'BLU-3')).status,400);
});
test('canonical CARD keeps leading zeros, null unbind, frozen UUID and safe responses',async()=>{
 for(const [cardCode,expected] of [[body().cardCode,'CARD-00123'],[null,null],['CARD-'+'1'.repeat(95),'CARD-'+'1'.repeat(95)]]) {
  const h=harness(),p={...body(),cardCode};
  const response=await h.run(request(p),'BLU-3');assert.equal(response.status,200);assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{ok:true});
  assert.equal(response.headers['Cache-Control'],'no-store');
  const [digest,key,raw]=h.calls[0].values;
  assert.equal(digest,createHash('sha256').update('a'.repeat(64)).digest('hex'));assert.equal(key,p.requestKey);
  assert.deepEqual(JSON.parse(raw),{memberCode:'BLU-3',cardCode:expected,expectedVersion:0,reason:p.reason});
  await h.run(request(p),'BLU-3');assert.deepEqual(h.calls[0].values,h.calls[1].values);
 }
});
test('read uses SQL target guard; absent schema is unavailable; errors never expose another binding',async()=>{
 const h=harness({card:{cardCode:'CARD-9',version:7}});
 const r=await h.run(request(body(),{method:'GET'}),'BLU-3');assert.equal(r.status,200);
 assert.deepEqual(JSON.parse(JSON.stringify(r.data)),{card:{cardCode:'CARD-9',version:7}});assert.match(h.calls[0].sql,/member_card_read/);
 for(const [code,status] of [['42501',403],['P0001',409],['23505',409],['22023',400],['42883',503],['42P01',503],['08006',503]]) {
  const h=harness({error:{code,message:'SECRET CARD-987 BLU-444 token SQL'}});
  const r=await h.run(request(),'BLU-3');assert.equal(r.status,status);assert.doesNotMatch(JSON.stringify(r),/SECRET|CARD-987|BLU-444|token|SQL/);
  if(status===503){await assert.rejects(h.read('BLU-3'));assert.equal((await h.run(request(body(),{method:'GET'}),'BLU-3')).status,503);}
 }
 assert.equal((await harness({card:{cardCode:null,version:0,secret:'SECRET'}}).run(request(body(),{method:'GET'}),'BLU-3')).status,503);
});
test('additive migration delegates authority and limits writes/ACL to the card registry',()=>{
 const migration=read('../db/migrations/20261118_R2_member_cards.sql');
 assert.doesNotMatch(migration,/CREATE OR REPLACE|ALTER TABLE (?:members|auth_sessions)|UPDATE (?:public\.)?(?:members|auth_sessions|package_payment_orders)|PAID_ENTRY|FREE_ENTRY|SECURITY DEFINER|GRANT /i);
 assert.match(migration,/public\.kiosk_checkin\(/);assert.match(migration,/public\.r7_visit_action\(/);
 assert.match(migration,/card_code text UNIQUE/);assert.match(migration,/member_id integer PRIMARY KEY/);
 assert.match(migration,/UNIQUE\(actor_id,request_key\)/);assert.match(migration,/current_version\+1/);
 assert.equal((migration.match(/SET search_path=pg_catalog,public/g)||[]).length,6);
  assert.match(migration,/public\.real_frontdesk_checkin\(/);assert.match(migration,/to_regprocedure\('public\.r7_visit_action/);
  assert.match(migration,/MEMBER_SCAN_OUT_UNSUPPORTED_BEFORE_WRITE/);
  assert.doesNotMatch(migration,/EXCEPTION\s+WHEN/i);
 assert.equal((migration.match(/pg_advisory_xact_lock\(724192,2\)/g)||[]).length,2);
 assert.match(migration,/REVOKE ALL ON member_cards,member_card_audit,member_card_scan_requests FROM PUBLIC/);
});
test('separate UI fragment uses guarded read, freezes retry, no browser persistence and guarded parent wiring',()=>{
 const form=read('../app/admin/members/[memberCode]/AdminMemberCardForm.tsx');
 for(const pattern of [/pending \?\? JSON.stringify/,/body, signal:/,/crypto.randomUUID/,/expectedVersion: initial.version/,/fieldset disabled=/,/window.location.reload/])assert.match(form,pattern);
 assert.doesNotMatch(form,/localStorage|sessionStorage|console\./);
 assert.match(read('../app/admin/members/[memberCode]/MemberCardSection.tsx'),/await getMemberCard\(memberCode\)/);
 assert.match(read('../app/admin/members/[memberCode]/page.tsx'), /canEdit && <MemberCardSection/);
 const route=read('../app/api/admin/members/[memberCode]/card/route.ts');assert.match(route,/await context.params/);assert.match(route,/handle as GET, handle as PATCH/);
});
