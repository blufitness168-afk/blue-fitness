import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load({normal=null,kiosk=null,password=null,rows=[]}={}) {
 const calls=[]; const filename=new URL('./real-checkin-server.ts',import.meta.url).pathname;
 const compiled=ts.transpileModule(readFileSync(new URL('./real-checkin-server.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
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
 return {run:loaded.exports.realCheckinAction,calls};
}
const request=body=>new Request('http://localhost/api/kiosk/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('only normal ADMIN/OWNER can access frontdesk',async()=>{
 for(const normal of [null,{role:'MEMBER'},{role:'ADMIN',status:'SUSPENDED'}]) {const a=load({normal});assert.equal((await a.run(request({query:''}),'history')).status,403);assert.equal(a.calls.length,0);}
});
test('scan delegates entitlement and ignores client station',async()=>{
 const a=load({normal:{role:'ADMIN'},rows:[{result:{ok:true}}]});const key=crypto.randomUUID();
 assert.equal((await a.run(request({code:' blu-2 ',requestKey:key,station:'evil',points:999}),'scan')).body.ok,true);
 assert.match(a.calls[0].text,/real_frontdesk_checkin/);assert.equal(a.calls[0].values[1],process.env.KIOSK_STATION_ID||'LOCAL_FRONT_DESK');assert.equal(a.calls[0].values[2],key);assert.equal(a.calls[0].values[3],'BLU-2');
});
test('invalid scans never reach SQL',async()=>{const a=load({normal:{role:'OWNER'}});assert.equal((await a.run(request({code:'BLU-2',requestKey:'bad'}),'scan')).status,400);assert.equal(a.calls.length,0);});
test('read queries recheck normal role and escape literal search',async()=>{for(const action of ['members','history']){const a=load({normal:{role:'OWNER'}});assert.equal((await a.run(request({query:'%_'}),action)).status,200);assert.match(a.calls[0].text,/s.mode='NORMAL'/);assert.match(a.calls[0].text,/staff.role IN/);assert.ok(a.calls[0].values.includes('%' + String.fromCharCode(92) + '%' + String.fromCharCode(92) + '_%'));}});
test('migration preserves entitlement body and changes only frontdesk authorization and label',()=>{
 const original=readFileSync(new URL('../db/migrations/20261024_kiosk.sql',import.meta.url),'utf8');
 const prepared=readFileSync(new URL('../db/migrations/20261024_real_frontdesk.sql',import.meta.url),'utf8');
 const expected=original.slice(original.indexOf('CREATE OR REPLACE FUNCTION kiosk_checkin')).replaceAll('kiosk_checkin','real_frontdesk_checkin').replace("s.mode<>'KIOSK' OR s.device_id IS DISTINCT FROM p_station","s.mode<>'NORMAL'").replace('Kiosk required','Normal admin session required').replace('KIOSK ENTRY_ONLY','FRONTDESK ENTRY_ONLY');
 assert.equal(prepared.slice(prepared.indexOf('CREATE OR REPLACE FUNCTION')),expected);
});
