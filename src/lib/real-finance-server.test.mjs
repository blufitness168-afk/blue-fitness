import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const types = new Module('finance-types');
types._compile(ts.transpileModule(readFileSync(new URL('../app/admin/finance/types.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, 'finance-types');
function load(member = { role: 'OWNER', status: 'ACTIVE' }, failures = []) {
 const calls = [];
 const mod = new Module('finance');
 mod.require = name => {
  if(name === 'server-only') return {};
  if(name.endsWith('/finance/types')) return types.exports;
  if(name === './auth/server') return { SESSION_COOKIE: 'session', getCurrentMember: async () => member };
  if(name === 'next/headers') return { cookies: async () => ({ get: () => ({ value: 'a'.repeat(64) }) }) };
  if(name === './auth/http') return { json: (body,status=200) => ({body,status}), readBody: async r => r.json() };
  if(name === '@neondatabase/serverless') return { neon: () => async (sql,...values) => { calls.push(values); const code=failures.shift(); if(code) throw Object.assign(new Error('test'),{code}); return [{result:{records:[],audit:[]}}]; } };
  return require(name);
 };
 mod._compile(ts.transpileModule(readFileSync(new URL('./real-finance-server.ts', import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,'finance');
 return {...mod.exports,calls};
}
const entry = {date:'2026-10-24',type:'INCOME',category:'รายได้อื่น (ไม่ใช่แพ็กเกจ)',amount:12.34,note:'Water sale'};
const request = (body,method='POST') => new Request('https://example.test/api/admin/finance/create',{method,...(method==='POST'?{body:JSON.stringify(body)}:{})});
test('owner-only before SQL, method and action guards',async()=>{
 for(const member of [null,{role:'ADMIN'},{role:'MEMBER'},{role:'OWNER',status:'SUSPENDED'}]) { const api=load(member); assert.ok([401,403].includes((await api.financeAction(request({},'GET'),'read')).status)); assert.equal(api.calls.length,0); }
 assert.equal((await load().financeAction(request({}),'read')).status,405);
 assert.equal((await load().financeAction(request({}),'unknown')).status,404);
});
test('canonical satang, real dates, category and version validation; no forged payment/member data',()=>{
 const api=load(); assert.deepEqual(api.financePayload('create',{...entry,memberId:99,source:'MEMBERSHIP'}),{date:entry.date,type:entry.type,category:entry.category,amountSatang:1234,note:entry.note});
 for(const patch of [{date:'2026-02-30'},{amount:0},{amount:1.001},{amount:Infinity},{category:'แพ็กเกจ'},{note:''},{type:'EXPENSE'}]) assert.equal(api.financePayload('create',{...entry,...patch}),null);
 assert.equal(api.financePayload('update',{...entry,id:'package:foo',version:1}),null);
 assert.equal(api.financePayload('delete',{id:randomUUID(),version:1,reason:''}),null);
});
test('transient retries preserve idempotency key and hashed session',async()=>{
 const old=process.env.DATABASE_URL; process.env.DATABASE_URL='mock-only';
 try {const api=load(undefined,['40001','40P01']); const key=randomUUID(); assert.equal((await api.financeAction(request({...entry,requestKey:key}),'create')).status,200); assert.equal(api.calls.length,3); assert.deepEqual(api.calls[0],api.calls[2]); assert.equal(api.calls[0][2],key); assert.notEqual(api.calls[0][0],'a'.repeat(64));} finally {if(old===undefined) delete process.env.DATABASE_URL;else process.env.DATABASE_URL=old;}
});
let PGlite;
try { ({PGlite}=createRequire(new URL('../../.local-db/payment-sql-tests/package.json',import.meta.url))('@electric-sql/pglite')); } catch {}
test('isolated PostgreSQL CRUD, audit, replay, stale edits, package read-only and no side effects',{skip:!PGlite},async()=>{
 const db=new PGlite();
 try {
 await db.exec(`CREATE TABLE members(id serial PRIMARY KEY,role text,status text,member_code text,full_name text,points int DEFAULT 42,expire_date date DEFAULT '2027-01-01');
 CREATE TABLE auth_sessions(id serial PRIMARY KEY,member_id int,token_hash text,mode text DEFAULT 'NORMAL',revoked_at timestamptz,expires_at timestamptz);
 CREATE TABLE package_payment_orders(id uuid PRIMARY KEY,member_id int,package_snapshot jsonb,amount_satang int,status text,paid_at timestamptz,created_at timestamptz DEFAULT now());
 INSERT INTO members(role,status,member_code,full_name) VALUES('OWNER','ACTIVE','O','Owner'),('ADMIN','ACTIVE','A','Staff'),('OWNER','ACTIVE','O2','Other');
 INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'token-'||id,now()+interval '1 day' FROM members;
 INSERT INTO package_payment_orders VALUES('${randomUUID()}',1,'{"name":"Actual"}',12345,'PAID','2026-10-23 18:00Z',now()),('${randomUUID()}',1,'{}',999,'PENDING',NULL,now());`);
 await db.exec(readFileSync(new URL('../db/migrations/20261024_real_finance.sql',import.meta.url),'utf8'));
 const call=async(action,payload={},key=randomUUID(),actor=1)=>(await db.query('SELECT real_finance_action($1,$2,$3::uuid,$4::jsonb) AS data',[`token-${actor}`,action,key,JSON.stringify(payload)])).rows[0].data;
 const payload=load().financePayload('create',entry),key=randomUUID();
 const created=await call('create',payload,key); assert.deepEqual(await call('create',payload,key),created);
 await assert.rejects(call('create',{...payload,amountSatang:99},key),/Request key reused/);
 let data=await call('read'); assert.equal(data.records.length,2); assert.equal(data.audit.length,1);
 const paid=data.records.find(x=>x.source==='MEMBERSHIP'); assert.equal(paid.amount,123.45); assert.equal(paid.date,'2026-10-24');
 await assert.rejects(call('update',{...payload,id:paid.id,version:0}));
 await assert.rejects(call('read',{},randomUUID(),2),/Owner session required/);
 const changed=await call('update',{...payload,id:created.id,version:1,amountSatang:500}); assert.equal(changed.version,2);
 await assert.rejects(call('update',{...payload,id:created.id,version:1},randomUUID(),3),/changed/);
 const deletion={id:created.id,version:2,reason:'Incorrect entry'}; const dk=randomUUID();
 await call('delete',deletion,dk); await call('delete',deletion,dk);
 data=await call('read'); assert.equal(data.records.length,1);assert.equal(data.audit.length,3);assert.equal(data.audit[0].before.amount_satang,500);
 assert.deepEqual((await db.query('SELECT points,expire_date::text FROM members WHERE id=1')).rows[0],{points:42,expire_date:'2027-01-01'});
 await db.exec("CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$; CREATE TRIGGER fail_audit BEFORE INSERT ON finance_audit FOR EACH ROW EXECUTE FUNCTION fail_audit();");
 await assert.rejects(call('create',payload),/audit failure/); assert.equal((await call('read')).records.length,1);
 await db.exec("UPDATE auth_sessions SET mode='KIOSK' WHERE member_id=1"); await assert.rejects(call('read'),/Owner session required/);
 } finally {await db.close();}
});
test('no browser mock stores or writes to package/member tables',()=>{
 const client=readFileSync(new URL('../app/admin/finance/FinanceClient.tsx',import.meta.url),'utf8'); assert.doesNotMatch(client,/localStorage|admin-finance|member-account|readFinanceRecords/);assert.match(client,/crypto.randomUUID/);
 const sql=readFileSync(new URL('../db/migrations/20261024_real_finance.sql',import.meta.url),'utf8'); assert.doesNotMatch(sql,/(?:INSERT INTO|UPDATE|DELETE FROM) (?:members|payments|package_payment_orders)\b/i);
 assert.match(sql,/o.status='PAID'/); assert.match(sql,/AT TIME ZONE 'Asia\/Bangkok'/);
});
