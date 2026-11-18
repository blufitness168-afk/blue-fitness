import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('./time-supplement-server.ts',import.meta.url),'utf8');
function harness({role='MEMBER',member=true,failures=[],result=[]}={}) {
 const calls=[], exports={};
 const sql=async (parts,...values) => { calls.push(values); const code=failures.shift(); if(code) throw Object.assign(Error(code),{code}); return [{result}]; };
 const imports={
  'server-only':{}, 'node:crypto':require('node:crypto'),
  'next/headers':{cookies:async()=>({get:()=>({value:'a'.repeat(64)})})},
  '@neondatabase/serverless':{neon:()=>sql}, zod:require('zod'),
  './auth/server':{SESSION_COOKIE:'blu_session',getCurrentMember:async()=>member?{id:3,status:'ACTIVE',role}:null},
  './auth/http':{json:(data,status=200)=>({data,status}),sameOrigin:r=>r.headers.get('origin')===new URL(r.url).origin},
  './payment-server':{boundedBody:async(r,limit)=>{const b=Buffer.from(await r.text());if(b.length>limit)throw Error('large');return b;}},
  './package-catalog':{packageCatalogDailySlot:s=>/^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s)?{}:null},
 };
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:name=>{assert.ok(name in imports,name);return imports[name];},process:{env:{DATABASE_URL:'OFFLINE_MOCK'}},Buffer});
 return {run:exports.timeSupplement,calls};
}
const key='11111111-1111-4111-8111-111111111111';
const request=(body,origin='https://offline.invalid')=>new Request('https://offline.invalid/api/member/time-supplement',{
 method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body),
});
test('API denies cross-origin, unauthenticated and MEMBER staff grants before SQL',async()=>{
 for(const [options,req,staff,status] of [ [{},request({requestKey:key,couponId:1},'https://other.invalid'),false,403],
  [{member:false},request({}),false,401], [{},request({}),true,403] ]) {
  const h=harness(options); assert.equal((await h.run(req,staff)).status,status);assert.equal(h.calls.length,0);
 }
});
test('API validates unknown fields, member selection, price and client clocks',async()=>{
 for(const extra of [{memberId:4},{price:0},{at:'2026-01-01'},{couponId:1.5}]){
  const h=harness();assert.equal((await h.run(request({requestKey:key,couponId:1,...extra}))).status,400);assert.equal(h.calls.length,0);
 }
});
test('API retries only confirmed rollback codes with identical UUID/payload',async()=>{
 const h=harness({failures:['40001','40P01'],result:{couponId:1}});
 assert.equal((await h.run(request({requestKey:key,couponId:1}))).status,200);
 assert.equal(h.calls.length,3);
 for(const call of h.calls){assert.equal(call[1],'activate');assert.equal(call[2],key);assert.equal(call[3],'{"couponId":1}');}
});
test('API unknown outcome is not auto-retried; errors fail closed',async()=>{
 for(const [code,status] of [['08006',503],['42501',403],['P0001',409],['22023',409]]){
  const h=harness({failures:[code]});assert.equal((await h.run(request({requestKey:key,couponId:1}))).status,status);assert.equal(h.calls.length,1);
 }
});
test('ADMIN and OWNER grant only explicit one-shot payload, no price response enrichment',async()=>{
 for(const role of ['ADMIN','OWNER']){
  const h=harness({role,result:{couponId:1}});
  const r=await h.run(request({requestKey:key,memberCode:'TS-3',title:'Synthetic',reason:'Test',timeSlot:'14:00-22:00'}),true);
  assert.equal(r.status,200);assert.equal(h.calls[0][1],'grant');
  assert.deepEqual(Object.keys(JSON.parse(h.calls[0][3])).sort(),['memberCode','reason','timeSlot','title']);
 }
});
