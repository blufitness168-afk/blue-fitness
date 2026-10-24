// Isolated tests only. Never connects to DATABASE_URL, SMS or payment providers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function load(member = { id: 1, role: 'ADMIN', status: 'ACTIVE' }, failures = []) {
 const calls = [];
 const filename = new URL('./real-benefits-admin-server.ts', import.meta.url).pathname;
 const source = ts.transpileModule(read('./real-benefits-admin-server.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 const mod = new Module(filename);
 mod.require = name => {
  if (name === 'server-only') return {};
  if (name === './auth/server') return { SESSION_COOKIE: 'blu_session', getCurrentMember: async () => member };
  if (name === 'next/headers') return { cookies: async () => ({ get: () => ({ value: 'a'.repeat(64) }) }) };
  if (name === './auth/http') return { json: (body, status = 200) => ({ body, status }), readBody: async request => request.json() };
  if (name === '@neondatabase/serverless') return { neon: () => async (parts, ...values) => { calls.push({ text: parts.join('?'), values }); const code = failures.shift(); if (code) throw Object.assign(Error('test'), { code }); return [{ result: {} }]; } };
  return require(name);
 };
 mod._compile(source, filename);
 return { ...mod.exports, calls };
}
const request = (body = {}, method = 'POST') => new Request('https://example.test/api/admin/benefits/grant', { method, ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
test('all admin operations guarded before SQL; invalid actions/methods fail closed', async () => {
 for (const member of [null, { role: 'OWNER', status: 'SUSPENDED' }, { role: 'MEMBER', status: 'ACTIVE' }]) {
  const api = load(member);
  for (const action of ['list','create','deactivate','grant','cancel','consume']) {
   assert.ok([401,403].includes((await api.benefitsAdminAction(request({}, action === 'list' ? 'GET' : 'POST'), action)).status));
  }
  assert.equal(api.calls.length, 0);
 }
 const api = load();
 assert.equal((await api.benefitsAdminAction(request(), 'list')).status, 405);
 assert.equal((await api.benefitsAdminAction(request(), 'unknown')).status, 404);
});
test('strict validation: enums, whole amounts, bonus quota, forged actor/amounts', () => {
 const api = load();
 const coupon = { kind: 'COUPON', title: 'Bonus', couponType: 'EXTRA_DAYS', quota: 1, bonusDays: 15, expiresAt: '2099-01-01T00:00:00Z' };
 assert.equal(api.benefitPayload('create', coupon).bonusDays, 15);
 for (const patch of [{ couponType: 'BONUS_DAYS' }, { couponType: 'FREE_ENTRY' }, { quota: 2 }, { bonusDays: 0 }, { bonusDays: 1.5 }, { actorId: 2 }]) assert.equal(api.benefitPayload('create', { ...coupon, ...patch }), null);
 assert.equal(api.benefitPayload('grant', { definitionId: 1, memberCode: 'BLU-1', actorId: 99 }), null);
 assert.equal(api.benefitPayload('consume', { couponId: '1' }), null);
 assert.deepEqual(api.benefitPayload('consume', { couponId: 1 }), { couponId: 1, guestReference: '' });
 const promo = { kind: 'PROMO', title: 'Real', code: 'save10', discountType: 'PERCENT', discountValue: 10, minSatang: 0, maxDiscountSatang: null, usageLimit: 2, expiresAt: coupon.expiresAt };
 assert.equal(api.benefitPayload('create', promo).code, 'SAVE10');
 assert.equal(api.benefitPayload('create', { ...promo, discountValue: 101 }), null);
 assert.equal(api.benefitPayload('create', { ...promo, discountValue: 0.5 }), null);
});
test('hashed session, stable idempotency on transient retry, no fake success', async () => {
 const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'isolated-mock-only';
 try {
  const api = load(undefined, ['40001','40P01']); const requestKey = randomUUID();
  assert.equal((await api.benefitsAdminAction(request({ definitionId: 1, memberCode: 'BLU-1', requestKey }), 'grant')).status, 200);
  assert.equal(api.calls.length, 3); assert.deepEqual(api.calls[0], api.calls[2]);
  assert.match(api.calls[0].values[0], /^[a-f0-9]{64}$/); assert.notEqual(api.calls[0].values[0], 'a'.repeat(64));
  assert.equal(api.calls[0].values[2], requestKey);
  assert.equal((await load(undefined, ['42501']).benefitsAdminAction(request({}, 'GET'), 'list')).status, 403);
 } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});
test('production pages detached from browser mocks; quote never uses marketing promos', () => {
 for (const path of ['../app/admin/coupons/page.tsx','../app/admin/coupons/BenefitsAdminClient.tsx','../app/admin/promo-codes/page.tsx']) assert.doesNotMatch(read(path), /localStorage|mock-data|CouponsAdmin|PromoCodesAdmin|admin-mock/);
 const policy = read('./payment-policy.ts'); assert.doesNotMatch(policy, /mockPromoCodes/);
 assert.match(read('./payment-server.ts'), /promo: parsed.data.promoCode.trim\(\)/);
 assert.match(read('./auth/http.ts'), /if \(!sameOrigin\(request\)\) return null/);
});

test('payment policy returns base catalog quote only; rejects every offline/mock promo', () => {
 const filename = new URL('./payment-policy.ts', import.meta.url).pathname;
 const mod = new Module(filename);
 mod.require = name => name === './mock-data' ? { mockPackages: [{ id: 2, name: 'Catalog', price: 900, isActive: true, durationDays: 30 }] } : require(name);
 mod._compile(ts.transpileModule(read('./payment-policy.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
 const { quotePackage } = mod.exports;
 const quote = quotePackage(2, '');
 assert.equal(quote.subtotalSatang, 90000); assert.equal(quote.amountSatang, 90000); assert.equal(quote.discountSatang, 0); assert.equal(quote.pointsEarned, 45); assert.equal(quote.promo, null);
 for (const code of ['SAVE100','REAL10','UNKNOWN']) assert.throws(() => quotePackage(2, code), /ต้องตรวจโค้ดส่วนลด/);
 assert.throws(() => quotePackage(999, ''), /ไม่พบแพ็กเกจ/);
});

// Use the already available local WASM harness; no install and no live DB fallback.
const { PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite');
test('SQL integration: actual payment migrations + enum coupons, auth, atomic replay, expiry, guest tracking and promo reservations', async () => {
 const db = new PGlite();
 try {
  await db.exec(`
   CREATE TYPE coupon_type AS ENUM ('FREE_ENTRY','FRIEND_PASS','EXTRA_DAYS','CUSTOM');
   CREATE TYPE coupon_status AS ENUM ('AVAILABLE','USED','EXPIRED');
   CREATE TABLE members(id serial PRIMARY KEY,phone text,full_name text,member_code text UNIQUE,status text,role text,points integer DEFAULT 0,expire_date timestamptz,updated_at timestamptz,avatar_url text);
   CREATE TABLE auth_sessions(id serial PRIMARY KEY,member_id integer REFERENCES members(id),token_hash text,expires_at timestamptz,revoked_at timestamptz);
   CREATE TABLE payments(id serial PRIMARY KEY,easyslip_trans_ref varchar(100));
   CREATE TABLE coupons(id serial PRIMARY KEY,member_id integer REFERENCES members(id),type coupon_type,source text,title text,status coupon_status DEFAULT 'AVAILABLE',total_quota integer,used_count integer,bonus_days_value integer DEFAULT 0,created_at timestamptz DEFAULT now(),expire_date timestamptz,UNIQUE(member_id,source));
   CREATE TABLE checkins(id serial PRIMARY KEY,member_id integer,scanner_type text,scanner_device_id text,points_awarded integer,notes text,checkin_time timestamptz DEFAULT now());
  `);
  await db.exec("CREATE FUNCTION benefit_test_now() RETURNS timestamptz LANGUAGE sql AS $$ SELECT COALESCE(NULLIF(current_setting('benefits.test_now',true),'')::timestamptz,clock_timestamp()) $$");
  for (const file of ['20261009_real_package_payments.sql','20261010_payment_promptpay.sql','20261024_kiosk.sql','20261024_real_benefits_admin.sql']) await db.exec(read('../db/migrations/'+file).replaceAll('clock_timestamp()', 'benefit_test_now()'));
  // Verify actual PostgreSQL ACLs, not just migration text. A newly created role
  // inherits PUBLIC privileges; granting wrapper EXECUTE must not expose the helper.
  await db.exec('CREATE ROLE benefits_untrusted NOLOGIN');
  const functions = ['create_package_payment_order','create_package_payment_order_before_benefits'];
  for (const name of functions) {
   const signature = `${name}(uuid,integer,text,uuid,jsonb,jsonb)`;
   const { rows } = await db.query("SELECT has_function_privilege('benefits_untrusted',$1,'EXECUTE') AS allowed,proconfig,prosecdef,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE oid=$1::regprocedure", [signature]);
   assert.equal(rows[0].allowed,false,signature);
   assert.ok(rows[0].proconfig.includes('search_path=public, pg_catalog'),signature);
   assert.equal(rows[0].prosecdef,false); // Preserve SECURITY INVOKER.
   assert.match(rows[0].definition,/mode\s*=\s*'NORMAL'/); // Preserve existing auth predicate.
  }
  await db.exec('SET ROLE benefits_untrusted');
  try {
   for (const name of functions) await assert.rejects(db.query(`SELECT * FROM ${name}($1::uuid,2,'forged',$2::uuid,'{}'::jsonb,'{}'::jsonb)`,[randomUUID(),randomUUID()]), /permission denied for function/);
  } finally { await db.exec('RESET ROLE'); }
  await db.exec('GRANT EXECUTE ON FUNCTION create_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb) TO benefits_untrusted');
  assert.equal((await db.query("SELECT has_function_privilege('benefits_untrusted','create_package_payment_order_before_benefits(uuid,integer,text,uuid,jsonb,jsonb)','EXECUTE') AS allowed")).rows[0].allowed,false);
  await db.exec('SET ROLE benefits_untrusted');
  try {
   await assert.rejects(db.query("SELECT * FROM create_package_payment_order_before_benefits($1::uuid,2,'forged',$2::uuid,'{}'::jsonb,'{}'::jsonb)",[randomUUID(),randomUUID()]), /permission denied for function/);
  } finally { await db.exec('RESET ROLE'); }
  await db.exec('REVOKE EXECUTE ON FUNCTION create_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb) FROM benefits_untrusted');
  await db.exec(`
   INSERT INTO members(member_code,full_name,status,role,expire_date) VALUES ('ADMIN','Staff','ACTIVE','ADMIN',now()+interval '1 year'),('BLU-1','One','ACTIVE','MEMBER',now()+interval '30 days'),('OWNER','Owner','ACTIVE','OWNER',now()+interval '1 year'),('BLU-2','Two','PENDING','MEMBER',NULL),('SUSPENDED','No','SUSPENDED','MEMBER',NULL);
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'token-'||id,now()+interval '1 day' FROM members;
  `);
  const call = async (action, payload = {}, key = randomUUID(), actor = 1) => (await db.query('SELECT real_benefits_admin_action($1,$2,$3::uuid,$4::jsonb) AS result', [`token-${actor}`,action,key,JSON.stringify(payload)])).rows[0].result;
  const scalar = async sql => (await db.query(sql)).rows[0].value;
  const definition = (type, extra = {}) => ({ kind:'COUPON', title:type, couponType:type,quota:1,bonusDays:type==='EXTRA_DAYS'?15:0,expiresAt:'2099-01-01T00:00:00Z',...extra });
  await assert.rejects(call('list',{},randomUUID(),2), /Forbidden/);
  await db.exec("UPDATE auth_sessions SET mode='KIOSK',device_id='LOCAL_FRONT_DESK' WHERE member_id=1");
  await assert.rejects(call('list'), /Forbidden/);
  await db.exec("UPDATE auth_sessions SET mode='NORMAL',device_id=NULL WHERE member_id=1");
  const bonus = await call('create', definition('EXTRA_DAYS'));
  const key = randomUUID(); const grant = await call('grant',{definitionId:bonus.id,memberCode:'BLU-1'},key);
  assert.deepEqual(await call('grant',{definitionId:bonus.id,memberCode:'BLU-1'},key),grant);
  await assert.rejects(call('grant',{definitionId:bonus.id,memberCode:'BLU-2'},key), /Request key reused/);
  await assert.rejects(call('grant',{definitionId:bonus.id,memberCode:'BLU-1'}), /Already assigned/);
  const before = await scalar('SELECT expire_date::text AS value FROM members WHERE id=2');
  const consumeKey=randomUUID(); const consumed=await call('consume',{couponId:grant.coupon_id,guestReference:''},consumeKey);
  assert.equal(consumed.status,'USED');
  assert.deepEqual(await call('consume',{couponId:grant.coupon_id,guestReference:''},consumeKey),consumed);
  await assert.rejects(call('consume',{couponId:grant.coupon_id,guestReference:''},randomUUID(),3), /Coupon unavailable/);
  assert.equal(Date.parse(consumed.membershipExpiresAt)-Date.parse(before),15*86400000);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM benefit_consumptions'),1);
  await assert.rejects(call('cancel',{assignmentId:grant.id}), /Cannot cancel consumed/);
  const inactive = await call('grant',{definitionId:bonus.id,memberCode:'BLU-2'});
  await assert.rejects(call('consume',{couponId:inactive.coupon_id}), /Active membership required/);
  const friend = await call('create',definition('FRIEND_PASS',{quota:2}));
  const fg=await call('grant',{definitionId:friend.id,memberCode:'BLU-2'});
  await assert.rejects(call('consume',{couponId:fg.coupon_id}), /Guest reference required/);
  const fk=randomUUID(); await call('consume',{couponId:fg.coupon_id,guestReference:'VISIT-001'},fk);
  await call('consume',{couponId:fg.coupon_id,guestReference:'VISIT-001'},fk);
  assert.equal(await scalar(`SELECT used_count AS value FROM coupons WHERE id=${fg.coupon_id}`),1);
  assert.equal(await scalar('SELECT expire_date AS value FROM members WHERE id=4'),null);
  assert.equal(await scalar('SELECT status AS value FROM members WHERE id=4'),'PENDING');
  assert.equal(await scalar("SELECT guest_reference AS value FROM benefit_consumptions WHERE guest_reference='VISIT-001'"),'VISIT-001');
  await db.exec(`UPDATE coupons SET expire_date=now()-interval '1 day' WHERE id=${fg.coupon_id}`);
  await assert.rejects(call('consume',{couponId:fg.coupon_id,guestReference:'VISIT-002'}), /Coupon unavailable/);
  const cancelDef=await call('create',definition('FRIEND_PASS'));
  const cancelGrant=await call('grant',{definitionId:cancelDef.id,memberCode:'BLU-1'});
  await call('cancel',{assignmentId:cancelGrant.id});
  assert.equal(await scalar(`SELECT status AS value FROM coupons WHERE id=${cancelGrant.coupon_id}`),'EXPIRED');
  await assert.rejects(call('consume',{couponId:cancelGrant.coupon_id,guestReference:'blocked'}), /Coupon unavailable/);
  await call('deactivate',{definitionId:cancelDef.id});
  await assert.rejects(call('grant',{definitionId:cancelDef.id,memberCode:'BLU-2'}), /Definition unavailable/);
  await assert.rejects(call('grant',{definitionId:friend.id,memberCode:'SUSPENDED'}), /Member unavailable/);
  await db.exec("INSERT INTO coupons(member_id,type,source,title,status,total_quota,used_count,expire_date) VALUES(4,'FREE_ENTRY','WELCOME_REGISTRATION','Welcome','AVAILABLE',1,0,now()+interval '30 days')");
  const welcomeId=await scalar("SELECT id AS value FROM coupons WHERE source='WELCOME_REGISTRATION'");
  await assert.rejects(call('consume',{couponId:welcomeId,guestReference:'no'}), /Coupon unavailable/);
  assert.equal(await scalar(`SELECT used_count AS value FROM coupons WHERE id=${welcomeId}`),0);

  const promo=await call('create',{kind:'PROMO',title:'Ten percent',code:'REAL10',discountType:'PERCENT',discountValue:10,minSatang:50000,maxDiscountSatang:7000,usageLimit:1,expiresAt:'2099-01-01T00:00:00Z'});
  const pa=await call('grant',{definitionId:promo.id,memberCode:'BLU-1'});
  await call('grant',{definitionId:promo.id,memberCode:'BLU-2'});
  const base={package:{id:2,name:'Test',durationDays:30,timeSlot:'07:00-14:00',friendCoupons:0,bonusDays:0},subtotalSatang:90000,discountSatang:89999,amountSatang:1,pointsEarned:99999,promo:{code:'REAL10',discountValue:999}};
  const receiver={promptpay:'0973355322',bankCode:'004',bankAccount:'0528938965',name:'OFFLINE TEST'};
  const order=async (member=2,quote=base,key=randomUUID()) => (await db.query('SELECT * FROM create_package_payment_order($1::uuid,$2,$3,$4::uuid,$5::jsonb,$6::jsonb)',[randomUUID(),member,`token-${member}`,key,JSON.stringify(quote),JSON.stringify(receiver)])).rows[0];
  await assert.rejects(order(3), /Promo unavailable/);
  await assert.rejects(order(2,{...base,promo:{code:'MOCK_ONLY'}}), /Promo unavailable/);
  await assert.rejects(order(2,{...base,subtotalSatang:49999}), /Promo unavailable/);
  const orderKey=randomUUID(); const first=await order(2,base,orderKey);
  assert.equal(first.discount_satang,7000); assert.equal(first.amount_satang,83000); assert.equal(first.points_earned,41); assert.equal(first.status,'PENDING');
  assert.equal((await order(2,base,orderKey)).id,first.id);
  await assert.rejects(order(2,{...base,promo:null},orderKey), /Request key reused/);
  await assert.rejects(order(4), /Promo quota exhausted/);
  await assert.rejects(call('cancel',{assignmentId:pa.id}), /Promo already reserved/);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM benefit_promo_reservations'),1);
  assert.equal((await call('list')).promoOrders[0].status,'PENDING');
  await db.exec(`INSERT INTO package_payment_attempts(id,order_id,image_sha256,lease_token,state) VALUES(gen_random_uuid(),'${first.id}','hash',gen_random_uuid(),'UNKNOWN')`);
  // Only this disposable DB has a controllable clock; production has no override.
  await db.query("SELECT set_config('benefits.test_now',$1,false)",[new Date(Date.parse(first.upload_deadline)+3600000).toISOString()]);
  await assert.rejects(order(4), /Promo quota exhausted/);
  await assert.rejects(call('cancel',{assignmentId:pa.id}), /Promo already reserved/);
  await db.exec("UPDATE package_payment_orders SET status='REJECTED',rejection_reason='ISOLATED_TEST' WHERE id='"+first.id+"'");
  await call('cancel',{assignmentId:pa.id});
  const second=await order(4); assert.equal(second.discount_satang,7000);
  await call('deactivate',{definitionId:promo.id});
  assert.equal((await order(4,base,second.request_key)).id,second.id); // replay despite deactivation
  assert.equal(await scalar('SELECT count(*)::int AS value FROM package_payment_point_ledger'),0);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM payments'),0);
  await assert.rejects(db.exec('DELETE FROM benefit_action_audit'),/append-only/);
  await assert.rejects(db.exec('DELETE FROM benefit_consumptions'),/append-only/);
  await assert.rejects(db.exec('DELETE FROM benefit_promo_reservations'),/append-only/);
  const audit = (await call('list')).audit; assert.ok(audit.some(a=>a.actor_id===1 && a.action==='consume'));
  await db.exec("UPDATE auth_sessions SET expires_at=now()-interval '1 day' WHERE member_id=1");
  await assert.rejects(call('list'), /Forbidden/);
  await db.exec("UPDATE members SET status='SUSPENDED' WHERE id=3");
  await assert.rejects(call('list',{},randomUUID(),3), /Forbidden/);
 } finally { await db.close(); }
});
