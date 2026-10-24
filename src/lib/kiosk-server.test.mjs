import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load({normal=null,kiosk=null,password=null,rows=[]}={}) {
 const calls=[]; const filename=new URL('./kiosk-server.ts',import.meta.url).pathname;
 const compiled=ts.transpileModule(readFileSync(new URL('./kiosk-server.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const sql=async (parts,...values)=>{calls.push({text:parts.join('?'),values});return rows;};
 const loaded=new Module(filename);loaded.filename=filename;
 loaded.require=name=>{
  if(name==='server-only') return {};
  if(name==='next/headers') return {cookies:async()=>({get:()=>({value:'a'.repeat(64)})})};
  if(name==='@neondatabase/serverless') return {neon:()=>sql};
  if(name==='./auth/server') return {SESSION_COOKIE:'blu_session',getCurrentMember:async()=>normal,requireKioskSession:async()=>kiosk,loginPassword:async()=>password};
  if(name==='./auth/http') return {readBody:async r=>r.json(),json:(body,status=200)=>({body,status,cookies:{set(){}}})};
  return require(name);
 };loaded._compile(compiled,filename);process.env.DATABASE_URL='mock-only';
 return {run:loaded.exports.kioskAction,calls};
}
const request=body=>new Request('http://localhost/api/kiosk/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('MEMBER cannot enter; missing/restricted session cannot scan',async()=>{
 const a=load({normal:{role:'MEMBER'}});assert.equal((await a.run(request({}),'enter')).status,403);assert.equal(a.calls.length,0);
 const b=load();assert.equal((await b.run(request({code:'BLU-2',requestKey:crypto.randomUUID()}),'scan')).status,401);assert.equal(b.calls.length,0);
});
test('wrong or throttled exit password cannot change kiosk or issue normal cookie',async()=>{
 for(const password of [null,{limited:true}]) {
  const a=load({kiosk:{member:{phone:'0990000000'}},password});
  assert.equal((await a.run(request({password:'wrong'}),'exit')).status,password?429:401);assert.equal(a.calls.length,0);
 }
});
test('server owns station identity; UUID binds scan and SQL enforces auth again',async()=>{
 const a=load({kiosk:{member:{role:'ADMIN'}},rows:[{result:{ok:true,reason:'FREE_ENTRY'}}]});
 const key=crypto.randomUUID();const response=await a.run(request({code:' blu-2 ',requestKey:key,deviceId:'BYPASS'}),'scan');
 assert.equal(response.body.ok,true);assert.equal(a.calls.length,1);
 assert.match(a.calls[0].text,/kiosk_checkin/);assert.equal(a.calls[0].values[1],process.env.KIOSK_STATION_ID||'LOCAL_FRONT_DESK');
 assert.equal(a.calls[0].values[2],key);assert.equal(a.calls[0].values[3],'BLU-2');
});
test('normal-member guard excludes kiosk centrally; welcome SQL cannot bypass purpose',()=>{
 const auth=readFileSync(new URL('./auth/server.ts',import.meta.url),'utf8');
 assert.match(auth,/current\?\.session\.mode === "NORMAL" \? current.member : null/);
 const benefit=readFileSync(new URL('./benefits-server.ts',import.meta.url),'utf8');assert.match(benefit,/s.mode = 'NORMAL'/);
});
