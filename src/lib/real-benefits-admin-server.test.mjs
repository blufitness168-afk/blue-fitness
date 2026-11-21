// Isolated tests only. Never connects to DATABASE_URL, SMS or payment providers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function load(member = { id: 1, role: 'ADMIN', status: 'ACTIVE' }, failures = [], result = {}, checkoutInstalled = false) {
 const calls = [];
 const filename = new URL('./real-benefits-admin-server.ts', import.meta.url).pathname;
 const source = ts.transpileModule(read('./real-benefits-admin-server.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 const mod = new Module(filename);
 mod.require = name => {
  if (name === 'server-only') return {};
  if (name === './auth/server') return { SESSION_COOKIE: 'blu_session', getCurrentMember: async () => member };
  if (name === 'next/headers') return { cookies: async () => ({ get: () => ({ value: 'a'.repeat(64) }) }) };
  if (name === './auth/http') return { json: (body, status = 200) => ({ body, status }), readBody: async request => request.json() };
  if (name === '@neondatabase/serverless') return { neon: () => async (parts, ...values) => { calls.push({ text: parts.join('?'), values }); const code = failures.shift(); if (code) throw Object.assign(Error('test'), { code }); return [{ result, checkout_installed: checkoutInstalled }]; } };
  return require(name);
 };
 mod._compile(source, filename);
 return { ...mod.exports, calls };
}
const request = (body = {}, method = 'POST') => new Request('https://example.test/api/admin/benefits/grant', { method, ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
test('all admin operations guarded before SQL; invalid actions/methods fail closed', async () => {
 for (const member of [null, { role: 'OWNER', status: 'SUSPENDED' }, { role: 'MEMBER', status: 'ACTIVE' }]) {
  const api = load(member);
  for (const action of ['list','create','create-campaign','deactivate','grant-preview','grant','cancel','consume']) {
   assert.ok([401,403].includes((await api.benefitsAdminAction(request({}, action === 'list' ? 'GET' : 'POST'), action)).status));
  }
  assert.equal(api.calls.length, 0);
 }
 const api = load();
 assert.equal((await api.benefitsAdminAction(request(), 'list')).status, 405);
 assert.equal((await api.benefitsAdminAction(request(), 'unknown')).status, 404);
});
test('campaign create is strict, uses a distinct SQL action, and preserves UUID and policy values', async () => {
 const previous = process.env.DATABASE_URL;
 process.env.DATABASE_URL = 'isolated-mock-only';
 try {
  const safe = { id: 6, campaign_code: 'GIFTS', campaign_total: 7, campaign_per_member: 3, campaign_issued: 0 };
  const api = load(undefined, ['40001'], { ...safe, amount_satang: 42 });
  const spec = { title: 'Water bottle', campaignCode: 'gifts', campaignKind: 'GIFT', description: 'Counter pickup', usesPerCoupon: 4, bonusDays: 0,
   perMember: 3, total: 7, activationDurationMinutes: null, expiresAt: '2099-01-01T00:00:00Z', requestKey: randomUUID() };
  for (const patch of [{ total: 2 }, { usesPerCoupon: 0 }, { bonusDays: 1 }, { activationDurationMinutes: undefined },
    { campaignKind: 'DISCOUNT' }, { actorId: 9 }, { description: ' ' }, { campaignCode: 'invalid code' }]) {
   assert.equal((await api.benefitsAdminAction(request({ ...spec, ...patch }), 'create-campaign')).status, 400);
  }
  assert.equal(api.calls.length, 0);
  assert.deepEqual((await api.benefitsAdminAction(request(spec), 'create-campaign')).body.data, safe);
  assert.deepEqual(api.calls[0], api.calls[1]);
  assert.equal(api.calls[0].values[1], 'create_r6_campaign');
  assert.equal(api.calls[0].values[2], spec.requestKey);
  assert.equal(JSON.parse(api.calls[0].values[3]).campaignCode, 'GIFTS');
  assert.equal(JSON.parse(api.calls[0].values[3]).activationDurationMinutes, null);
 } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});
test('strict validation: enums, whole amounts, bonus quota, forged actor/amounts', () => {
 const api = load();
 const preview = { definitionId: 1, memberCode: 'CARD-123', recipientGroup: '30' };
 assert.deepEqual(api.benefitPayload('grant-preview', preview), preview);
 assert.equal(api.benefitPayload('grant-preview', { ...preview, requestKey: randomUUID() }), null);
 assert.equal(api.benefitPayload('grant-preview', { ...preview, recipientGroup: '31' }), null);
 assert.equal(api.benefitPayload('grant', { definitionId: 1, memberCode: 'BLU-1' }), null);
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
  assert.equal((await api.benefitsAdminAction(request({ definitionId: 1, memberCode: 'BLU-1', recipientGroup: '30', proof: 'a'.repeat(64), requestKey }), 'grant')).status, 200);
  assert.equal(api.calls.length, 3); assert.deepEqual(api.calls[0], api.calls[2]);
  assert.match(api.calls[0].values[0], /^[a-f0-9]{64}$/); assert.notEqual(api.calls[0].values[0], 'a'.repeat(64));
  assert.equal(api.calls[0].values[1], 'grant_targeted');
  assert.equal(api.calls[0].values[2], requestKey);
  assert.equal((await load(undefined, ['42501']).benefitsAdminAction(request({}, 'GET'), 'list')).status, 403);
 } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});
test('role response boundary: OWNER retains histories; ADMIN allowlists list and every mutation, including replay', async () => {
 const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'isolated-mock-only';
 try {
  const secret = { amount_satang: 912345, discount_satang: 12345, totalRevenue: 999999, order_id: 'other-member-order', nested: { amount_satang: 1 } };
  const result = {
   definitions: [{ id: 1, kind: 'PROMO', title: 'Promo', discount_value: 100, min_satang: 1000, ...secret }],
   assignments: [{ id: 2, member_code: 'BLU-2', ...secret }],
   coupons: [{ id: 3, title: 'Pass', ...secret }],
   promoOrders: [{ actor_id: 1, ...secret }, { actor_id: 2, ...secret }],
   audit: [{ actor_id: 1, payload: secret, result: secret }, { actor_id: 2, result: secret }],
   totalRevenue: 999999,
  };
  const owner = load({ id: 3, role: 'OWNER', status: 'ACTIVE' }, [], result);
  assert.deepEqual((await owner.benefitsAdminAction(request({}, 'GET'), 'list')).body.data, result);
  const admin = load(undefined, [], result);
  const listed = await admin.benefitsAdminAction(request({}, 'GET'), 'list');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.data, {
   definitions: [{ id: 1, kind: 'PROMO', title: 'Promo', discount_value: 100, min_satang: 1000 }],
   assignments: [{ id: 2, member_code: 'BLU-2' }], coupons: [{ id: 3, title: 'Pass' }], promoOrders: [], audit: [],
  });
  const mutations = {
   create: { kind: 'PROMO', title: 'Promo', code: 'SAVE', discountType: 'FIXED', discountValue: 100, minSatang: 0, maxDiscountSatang: null, usageLimit: 2, expiresAt: '2099-01-01T00:00:00Z' },
   deactivate: { definitionId: 1 }, grant: { definitionId: 1, memberCode: 'BLU-2', recipientGroup: 'ALL', proof: 'a'.repeat(64) }, cancel: { assignmentId: 2 }, consume: { couponId: 3, guestReference: 'guest' },
  };
  const safe = { create: { id: 1 }, deactivate: { definitionId: 1 }, grant: { id: 1 }, cancel: { assignmentId: 2 }, consume: { couponId: 3 } };
  for (const [action, payload] of Object.entries(mutations)) {
   const raw = { id: 1, definitionId: 1, assignmentId: 2, couponId: 3, ...secret, audit: result.audit, promoOrders: result.promoOrders };
   const api = load(undefined, [], raw);
   const body = { ...payload, requestKey: randomUUID() };
   for (let replay = 0; replay < 2; replay++) {
    const response = await api.benefitsAdminAction(request(body), action);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, safe[action], action);
   }
   assert.deepEqual(api.calls[0], api.calls[1]);
   assert.deepEqual((await load({ id: 3, role: 'OWNER', status: 'ACTIVE' }, [], raw).benefitsAdminAction(request(body), action)).body.data, raw);
  }
  const malformed = load(undefined, [], { definitions: [{ id: { amount_satang: 1 }, title: ['hidden-order'] }], assignments: null, coupons: {} });
  assert.deepEqual((await malformed.benefitsAdminAction(request({}, 'GET'), 'list')).body.data, { definitions: [{}], assignments: [], coupons: [], promoOrders: [], audit: [] });
 } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('R6 admin create distinguishes blank, zero and omitted without enabling promo activation', async () => {
 const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'isolated-mock-only';
 try {
  const api = load(undefined, [], { couponActivationReady: true, definitions: [{ id: 1, requires_activation: true, activation_duration_minutes: 0 }], coupons: [{ id: 2, activation_status: 'PENDING_ACTIVATION', campaign_expires_at: '2099-01-01' }] });
  const coupon = { kind: 'COUPON', title: 'Pass', couponType: 'FRIEND_PASS', quota: 1, bonusDays: 0, expiresAt: '2099-01-01T00:00:00Z' };
  for (const duration of [null, 0, 35, undefined]) {
   const body = { ...coupon, activationDurationMinutes: duration, requestKey: randomUUID() };
   assert.equal((await api.benefitsAdminAction(request(body), 'create')).status, 200);
   const call = api.calls.at(-1);
   assert.equal(call.values[1], duration === undefined ? 'create' : 'create_r6_coupon');
   assert.equal(JSON.parse(call.values[3]).activationDurationMinutes, duration);
  }
  for (const value of [-1, 1.1, '0', 2147483648]) {
   assert.equal(api.benefitPayload('create', { ...coupon, activationDurationMinutes: value }), null);
  }
  const promo = { kind: 'PROMO', title: 'Promo', code: 'SAVE', discountType: 'FIXED', discountValue: 100, minSatang: 0, maxDiscountSatang: null, usageLimit: 2, expiresAt: coupon.expiresAt };
  assert.ok(api.benefitPayload('create', promo));
  assert.equal(api.benefitPayload('create', { ...promo, activationDurationMinutes: null }), null);
  const { data } = (await api.benefitsAdminAction(request({}, 'GET'), 'list')).body;
  assert.equal(data.couponActivationReady, true);
  assert.equal(data.definitions[0].activation_duration_minutes, 0);
  assert.equal(data.coupons[0].activation_status, 'PENDING_ACTIVATION');
 } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('scoped promo create validates fields, keeps request identity, and filters list responses', async () => {
 const previous = process.env.DATABASE_URL;
 process.env.DATABASE_URL = 'stub';
 try {
  const allowed = { id: 7, kind: 'PROMO', max_satang: 110000, eligible_package_ids: [2, 7] };
  const api = load(undefined, ['40001'], { definitions: [allowed, { kind: 'PROMO', eligible_package_ids: [{ amount_satang: 10 }] }], promoOrders: [{ amount_satang: 10 }] });
  const promo = { kind: 'PROMO', title: 'Scope', code: 'scope', discountType: 'PERCENT', discountValue: 5, minSatang: 99000, maxDiscountSatang: 10000, usageLimit: 1, expiresAt: '2099-01-01T00:00:00Z' };
  for (const patch of [{ maxSatang: 98999 }, { maxSatang: '110000' }, { eligiblePackageIds: [] }, { eligiblePackageIds: [7, 7] }, { eligiblePackageIds: ['7'] }]) {
   assert.equal((await api.benefitsAdminAction(request({ ...promo, ...patch, requestKey: randomUUID() }), 'create')).status, 400);
  }
  assert.equal(api.calls.length, 0);
  const requestKey = randomUUID();
  const response = await api.benefitsAdminAction(request({ ...promo, maxSatang: 110000, eligiblePackageIds: [2, 7], requestKey }), 'create');
  assert.equal(response.status, 200);
  assert.match(api.calls[0].text, /r6_create_scoped_promo/);
  assert.deepEqual(api.calls[0], api.calls[1]);
  assert.equal(api.calls[0].values[1], requestKey);
  assert.deepEqual(JSON.parse(api.calls[0].values[2]), { ...promo, code: 'SCOPE', maxSatang: 110000, eligiblePackageIds: [2, 7] });
  const listed = await api.benefitsAdminAction(request({}, 'GET'), 'list');
  assert.deepEqual(listed.body.data.definitions, [allowed, { kind: 'PROMO' }]);
  assert.deepEqual(listed.body.data.promoOrders, []);
  const missing = load(undefined, ['42883']);
  assert.equal((await missing.benefitsAdminAction(request({ ...promo, maxSatang: 110000, requestKey }), 'create')).status, 503);
  assert.equal(missing.calls.length, 1);
 } finally {
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
 }
});

test('promo recipient quota and description use the scoped writer even without package or subtotal scope', async () => {
 const previous = process.env.DATABASE_URL;
 process.env.DATABASE_URL = 'isolated-mock-only';
 try {
  const fields = { id: 11, kind: 'PROMO', promo_description: 'Terms', promo_recipient_limit: 3, max_discount_satang: 2500 };
  const api = load(undefined, [], { ...fields, amount_satang: 999 });
  const body = { kind: 'PROMO', title: 'Fixture', code: 'promo11', discountType: 'PERCENT', discountValue: 5, minSatang: 0,
   maxDiscountSatang: 2500, usageLimit: 1, expiresAt: '2099-01-01T00:00:00Z', requestKey: randomUUID(), promoDescription: ' Terms ', promoRecipientLimit: 3 };
  for (const patch of [{ promoDescription: ' ' }, { promoRecipientLimit: 0 }, { promoRecipientLimit: '3' }]) {
   assert.equal((await api.benefitsAdminAction(request({ ...body, ...patch }), 'create')).status, 400);
  }
  assert.equal(api.calls.length, 0);
  assert.deepEqual((await api.benefitsAdminAction(request(body), 'create')).body.data, fields);
  assert.match(api.calls[0].text, /r6_create_scoped_promo/);
  assert.equal(JSON.parse(api.calls[0].values[2]).promoDescription, 'Terms');
  assert.equal(JSON.parse(api.calls[0].values[2]).promoRecipientLimit, 3);
 } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('checkout campaign readiness requires the rollout flag and installed migration; ADMIN sees only definition values', async () => {
 const previous = { DATABASE_URL: process.env.DATABASE_URL, R6_CHECKOUT_COUPONS_ENABLED: process.env.R6_CHECKOUT_COUPONS_ENABLED };
 process.env.DATABASE_URL = 'isolated-mock-only';
 try {
  const definition = { id: 8, kind: 'COUPON', campaign_kind: 'POINTS', checkout_unit: 'POINTS', checkout_value: 50, checkout_cap: 20 };
  for (const role of ['ADMIN', 'OWNER']) {
   for (const [enabled, installed] of [[false, true], [true, false], [true, true]]) {
    process.env.R6_CHECKOUT_COUPONS_ENABLED = String(enabled);
    const api = load({ id: 1, role, status: 'ACTIVE' }, [], { definitions: [{ ...definition, amount_satang: 100 }], couponCampaignReady: true }, installed);
    const { data } = (await api.benefitsAdminAction(request({}, 'GET'), 'list')).body;
    assert.equal(data.checkoutCampaignReady === true, enabled && installed);
    assert.equal(api.calls[0].text.includes('to_regprocedure'), enabled);
    if (role === 'ADMIN') assert.deepEqual(data.definitions, [definition]);
   }
  }
 } finally {
  for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
 }
});

test('production pages detached from browser mocks; policy never uses marketing promos', () => {
 for (const path of ['../app/admin/coupons/page.tsx','../app/admin/coupons/BenefitsAdminClient.tsx','../app/admin/promo-codes/page.tsx']) assert.doesNotMatch(read(path), /localStorage|mock-data|CouponsAdmin|PromoCodesAdmin|admin-mock/);
 const policy = read('./payment-policy.ts'); assert.doesNotMatch(policy, /mockPromoCodes/);
 // Promo normalization and the authoritative quote are exercised by payment-server.test.mjs.
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
  const sqlList = await call('list');
  const audit = sqlList.audit; assert.ok(audit.some(a=>a.actor_id===1 && a.action==='consume'));
  assert.ok(sqlList.promoOrders.length > 0);
  assert.ok(sqlList.promoOrders.every(order => Object.hasOwn(order, 'amount_satang') && Object.hasOwn(order, 'discount_satang')));
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'isolated-mock-only';
  try {
   const adminResponse = await load(undefined, [], sqlList).benefitsAdminAction(request({}, 'GET'), 'list');
   assert.equal(adminResponse.status, 200);
   assert.deepEqual(adminResponse.body.data.promoOrders, []);
   assert.deepEqual(adminResponse.body.data.audit, []);
   assert.doesNotMatch(JSON.stringify(adminResponse.body.data), /"(?:amount_satang|discount_satang|order_id|request_key)":/);
   assert.equal(adminResponse.body.data.definitions.length, sqlList.definitions.length);
   assert.equal(adminResponse.body.data.assignments.length, sqlList.assignments.length);
   assert.equal(adminResponse.body.data.coupons.length, sqlList.coupons.length);
   const ownerResponse = await load({ id: 3, role: 'OWNER', status: 'ACTIVE' }, [], await call('list', {}, randomUUID(), 3)).benefitsAdminAction(request({}, 'GET'), 'list');
   assert.equal(ownerResponse.status, 200);
   assert.deepEqual(ownerResponse.body.data, sqlList);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
  await db.exec("UPDATE auth_sessions SET expires_at=now()-interval '1 day' WHERE member_id=1");
  await assert.rejects(call('list'), /Forbidden/);
  await db.exec("UPDATE members SET status='SUSPENDED' WHERE id=3");
  await assert.rejects(call('list',{},randomUUID(),3), /Forbidden/);
 } finally { await db.close(); }
});
