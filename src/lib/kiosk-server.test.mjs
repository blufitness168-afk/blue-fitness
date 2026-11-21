import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load({normal=null,kiosk=null,password=null,rows=[],supported=false,scanError=null}={}) {
 const calls=[]; const filename=new URL('./kiosk-server.ts',import.meta.url).pathname;
 const compiled=ts.transpileModule(readFileSync(new URL('./kiosk-server.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const sql=async (parts,...values)=>{
  const text=parts.join('?');calls.push({text,values});
  if(text.startsWith('SELECT to_regprocedure')) return [{supported}];
  if(scanError) throw scanError;
  return rows;
 };
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
 assert.equal(response.body.ok,true);assert.equal(a.calls.length,2);
 assert.match(a.calls[1].text,/kiosk_checkin/);assert.equal(a.calls[1].values[1],process.env.KIOSK_STATION_ID||'LOCAL_FRONT_DESK');
 assert.equal(a.calls[1].values[2],key);assert.equal(a.calls[1].values[3],'BLU-2');
});
test('kiosk CARD USB input uses lookup/admission wrapper, never client member or entitlement',async()=>{
 const a=load({kiosk:{member:{role:'ADMIN'}},rows:[{result:{ok:false,reason:'NO_ENTITLEMENT'}}]});
 const key=crypto.randomUUID();
 assert.equal((await a.run(request({code:' card-00123 \r\n',requestKey:key}),'scan')).body.reason,'NO_ENTITLEMENT');
 assert.equal(a.calls.length,2);assert.match(a.calls[1].text,/member_card_admit/);
 assert.equal(a.calls[1].values[3],'CARD-00123');assert.equal(a.calls[1].values[4],null);
 for(const code of ['CARD-A1','CARD-','123','CARD-１２','CARD-'+'1'.repeat(96),'https://x/CARD-1']){
  const b=load({kiosk:{member:{role:'ADMIN'}}});assert.equal((await b.run(request({code,requestKey:crypto.randomUUID()}),'scan')).status,400);assert.equal(b.calls.length,0);
 }
});
test('paired station forwards raw normalized identity, explicit direction and original retry UUID',async()=>{
 const kiosk={member:{role:'ADMIN'},session:{expiresAt:'2099-01-01'}};
 const a=load({kiosk,supported:true,rows:[{result:{ok:true,reason:'EXIT',visitId:9}}]});
 assert.equal((await a.run(request({}),'status')).body.outSupported,true);
 const body={code:' card-002 ',direction:'OUT',requestKey:crypto.randomUUID(),station:'IGNORED'};
 for(let i=0;i<2;i++) assert.equal((await a.run(request(body),'scan')).body.reason,'EXIT');
 const calls=a.calls.filter(x=>!x.text.startsWith('SELECT to_regprocedure'));
 assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
 assert.match(calls[0].text,/public\.r7_kiosk_scan/);
 assert.deepEqual(calls[0].values.slice(1),[process.env.KIOSK_STATION_ID||'LOCAL_FRONT_DESK',body.requestKey,'CARD-002','OUT']);
 await a.run(request({code:'BLU-2',requestKey:crypto.randomUUID()}),'scan');
 assert.equal(a.calls.at(-1).values.at(-1),'IN');
 const autoRes = await a.run(request({code:' card-002 ',direction:'AUTO',requestKey:crypto.randomUUID()}),'scan');
 assert.equal(autoRes.status,200);
 assert.equal(a.calls.at(-1).values.at(-1),'AUTO');
});
test('entry-only mode and failed paired statements never downgrade a directional request',async()=>{
 const kiosk={member:{role:'ADMIN'},session:{expiresAt:'2099-01-01'}};
 const body={code:'BLU-2',requestKey:crypto.randomUUID()};
 assert.equal((await load({kiosk}).run(request({}),'status')).body.outSupported,false);
 for(const direction of ['IN','OUT','AUTO',null,'out']) {
  const a=load({kiosk});
  assert.equal((await a.run(request({...body,direction}),'scan')).status,direction===null||direction==='out'?400:503);
  assert.ok(a.calls.every(x=>x.text.startsWith('SELECT to_regprocedure')));
 }
 for(const [code,message,status] of [['42883','undefined function',503],['42501','permission denied',503],['42501','Kiosk required',401],['22023','key reused',409]]) {
  const a=load({kiosk,supported:true,scanError:Object.assign(new Error(message),{code})});
  assert.equal((await a.run(request({...body,direction:'OUT'}),'scan')).status,status);
  assert.equal(a.calls.length,2);assert.match(a.calls[1].text,/public\.r7_kiosk_scan/);
 }
});
test('kiosk UI auto-detects IN/OUT on a paired station without toggle buttons or browser sound',()=>{
 const ui=readFileSync(new URL('../app/kiosk/KioskClient.tsx',import.meta.url),'utf8');
 assert.match(ui,/direction:\s*"AUTO"/);
 assert.match(ui,/crypto\.randomUUID\(\), \.\.\.\(outSupported \? \{ direction: "AUTO" \} : \{\}\)/);
 assert.doesNotMatch(ui,/role="group"|เสียงยืนยัน|AudioContext|useState<Direction>/);
 assert.match(ui,/setPending\(payload\)/);
 assert.match(ui,/void scan\(pending\)/);
});
test('normal-member guard excludes kiosk centrally; welcome SQL cannot bypass purpose',()=>{
 const auth=readFileSync(new URL('./auth/server.ts',import.meta.url),'utf8');
 assert.match(auth,/current\?\.session\.mode === "NORMAL" \? current.member : null/);
 const benefit=readFileSync(new URL('./benefits-server.ts',import.meta.url),'utf8');assert.match(benefit,/s.mode = 'NORMAL'/);
});
