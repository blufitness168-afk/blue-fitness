import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load({normal=null,kiosk=null,password=null,rows=[],capability={visits:true,outSupported:true},error=null}={}) {
 const calls=[]; const filename=new URL('./real-checkin-server.ts',import.meta.url).pathname;
 const compiled=ts.transpileModule(readFileSync(new URL('./real-checkin-server.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const sql=async (parts,...values)=>{const text=parts.join('?');calls.push({text,values});if(error)throw error;if(text.includes('to_regclass'))return capability===null?[]:[capability];return rows;};
 const loaded=new Module(filename);loaded.filename=filename;
 loaded.require=name=>{
  if(name==='server-only') return {};
  if(name==='next/headers') return {cookies:async()=>({get:()=>({value:'a'.repeat(64)})})};
  if(name==='@neondatabase/serverless') return {neon:()=>sql};
  if(name==='./auth/server') return {SESSION_COOKIE:'blu_session',getCurrentMember:async()=>normal,requireKioskSession:async()=>kiosk,loginPassword:async()=>password};
  if(name==='./auth/http') return {readBody:async r=>r.json(),json:(body,status=200)=>({body,status,cookies:{set(){}}})};
  return require(name);
 };loaded._compile(compiled,filename);process.env.DATABASE_URL='mock-only';
 return {run:loaded.exports.realCheckinAction,calls};
}
const request=body=>new Request('http://localhost/api/kiosk/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('only normal ADMIN/OWNER can access frontdesk',async()=>{
 for(const normal of [null,{role:'MEMBER'},{role:'ADMIN',status:'SUSPENDED'}]) {const a=load({normal});assert.equal((await a.run(request({query:''}),'history')).status,403);assert.equal(a.calls.length,0);}
});
test('scan delegates entitlement and ignores client station',async()=>{
 const a=load({normal:{role:'ADMIN'},rows:[{result:{ok:true}}]});const key=crypto.randomUUID();
 assert.equal((await a.run(request({code:' blu-2 ',requestKey:key,station:'evil',points:999}),'scan')).body.ok,true);
 assert.match(a.calls[0].text,/member_scan_admit/);assert.equal(a.calls[0].values[1],process.env.KIOSK_STATION_ID||'LOCAL_FRONT_DESK');assert.equal(a.calls[0].values[2],key);assert.equal(a.calls[0].values[3],'BLU-2');
});
test('physical CARD including USB terminator delegates atomic lookup plus original admission',async()=>{
 const a=load({normal:{role:'ADMIN'},rows:[{result:{ok:false,reason:'SUSPENDED'}}]});
 const key=crypto.randomUUID();
 assert.equal((await a.run(request({code:' card-00123 \r\n',requestKey:key,direction:'IN'}),'scan')).body.reason,'SUSPENDED');
 assert.equal(a.calls.length,1);assert.match(a.calls[0].text,/member_scan_admit/);
 assert.equal(a.calls[0].values[3],'CARD-00123');assert.equal(a.calls[0].values[4],'IN');
 const out=load({normal:{role:'OWNER'},rows:[{result:{ok:true,reason:'EXIT'}}]});
 assert.equal((await out.run(request({code:'CARD-00123',requestKey:crypto.randomUUID(),direction:'OUT'}),'scan')).body.reason,'EXIT');
 assert.equal(out.calls[0].values[4],'OUT');
 for(const code of ['CARD-A1','CARD-','123','CARD-１２','CARD-'+'1'.repeat(96),'https://x/CARD-1']){
  const b=load({normal:{role:'ADMIN'}});assert.equal((await b.run(request({code,requestKey:crypto.randomUUID()}),'scan')).status,400);assert.equal(b.calls.length,0);
 }
});
test('invalid scans never reach SQL',async()=>{const a=load({normal:{role:'OWNER'}});assert.equal((await a.run(request({code:'BLU-2',requestKey:'bad'}),'scan')).status,400);assert.equal(a.calls.length,0);});
test('read queries recheck normal role and escape literal search',async()=>{for(const action of ['members','history']){const a=load({normal:{role:'OWNER'}});assert.equal((await a.run(request({query:'%_'}),action)).status,200);const call=a.calls.at(-1);assert.match(call.text,/s.mode='NORMAL'/);assert.match(call.text,/staff.role IN/);assert.ok(call.values.includes('%' + String.fromCharCode(92) + '%' + String.fromCharCode(92) + '_%'));}});
test('known pre-write OUT unsupported is explicit; unknown/failed mutations never fallback',async()=>{
 const body={code:'BLU-3',requestKey:crypto.randomUUID(),direction:'OUT'};
 const a=load({normal:{role:'ADMIN'},error:{code:'0A000',detail:'MEMBER_SCAN_OUT_UNSUPPORTED_BEFORE_WRITE'}});
 const response=await a.run(request(body),'scan');assert.equal(response.status,422);assert.equal(response.body.operationUnavailable,true);assert.equal(response.body.outSupported,false);assert.equal(a.calls.length,1);
 for(const error of [{code:'0A000'},{code:'42883'},{code:'08006'},{code:'40001'}]){
  const b=load({normal:{role:'ADMIN'},error});assert.equal((await b.run(request(body),'scan')).status,503);assert.equal(b.calls.length,1);
 }
});
test('October history does not reference absent R7 tables; unknown capability fails closed',async()=>{
 const a=load({normal:{role:'ADMIN'},capability:{visits:false,outSupported:false}});
 const r=await a.run(request({query:''}),'history');assert.equal(r.status,200);assert.equal(r.body.outSupported,false);
 assert.match(a.calls[0].text,/to_regclass/);assert.doesNotMatch(a.calls[1].text,/r7_visits/);assert.match(a.calls[1].text,/NULL::timestamptz/);
 const b=load({normal:{role:'ADMIN'},capability:null});assert.equal((await b.run(request({query:''}),'history')).status,503);assert.equal(b.calls.length,1);
});
test('R2 frontdesk UI accepts CARD, marks legacy OUT unavailable and retains unknown request keys',()=>{
 const page=readFileSync(new URL('../app/admin/checkin/page.tsx',import.meta.url),'utf8');
 assert.match(page,/CARD-\[0-9\]/);assert.match(page,/disabled=\{outSupported === false\}/);
 assert.match(page,/response.status === 422 && data.reason === "OUT_UNSUPPORTED"/);
 assert.match(page,/operationUnavailable === true/);assert.match(page,/pending.current = null; setRetryPending\(false\); setOutSupported\(false\)/);
});
test('R7 direction is explicit and unsupported manual/backdate fails closed',async()=>{
 for(const extra of [{direction:'SIDE'},{at:'2026-01-01'},{override:true}]) {
  const a=load({normal:{role:'OWNER'}});
  assert.equal((await a.run(request({code:'BLU-2',requestKey:crypto.randomUUID(),...extra}),'scan')).status,400);
  assert.equal(a.calls.length,0);
 }
 const a=load({normal:{role:'ADMIN'},rows:[{result:{ok:true,reason:'EXIT'}}]});
 assert.equal((await a.run(request({code:'BLU-2',requestKey:crypto.randomUUID(),direction:'OUT'}),'scan')).body.reason,'EXIT');
 assert.equal(a.calls[0].values[4],'OUT');
});
test('R7 datetime requires timezone, increasing bounds and valid pagination',async()=>{
 for(const extra of [{from:'2026-11-18T10:00'},{from:'invalid'},{from:'2026-11-18T10:00+07:00',to:'2026-11-18T09:00+07:00'},{page:0},{page:1.5}]) {
  const a=load({normal:{role:'OWNER'}});
  assert.equal((await a.run(request({query:'',...extra}),'history')).status,400);assert.equal(a.calls.length,0);
 }
});
test('migration preserves entitlement body and changes only frontdesk authorization and label',()=>{
 const original=readFileSync(new URL('../db/migrations/20261024_kiosk.sql',import.meta.url),'utf8');
 const prepared=readFileSync(new URL('../db/migrations/20261024_real_frontdesk.sql',import.meta.url),'utf8');
 const expected=original.slice(original.indexOf('CREATE OR REPLACE FUNCTION kiosk_checkin')).replaceAll('kiosk_checkin','real_frontdesk_checkin').replace("s.mode<>'KIOSK' OR s.device_id IS DISTINCT FROM p_station","s.mode<>'NORMAL'").replace('Kiosk required','Normal admin session required').replace('KIOSK ENTRY_ONLY','FRONTDESK ENTRY_ONLY');
 assert.equal(prepared.slice(prepared.indexOf('CREATE OR REPLACE FUNCTION')),expected);
});
