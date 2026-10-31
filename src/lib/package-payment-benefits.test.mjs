// Only isolated in-memory PostgreSQL. No DATABASE_URL, provider or production writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
 const filename = new URL(path, import.meta.url).pathname;
 const mod = new Module(filename);
 mod.require = name => dependencies[name] ?? require(name);
 mod._compile(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
 return mod.exports;
}
const catalog = load('./mock-data.ts');
const { quotePackage } = load('./payment-policy.ts', { './mock-data': catalog });
const expected = [[90,0,0],[900,5,0],[2400,5,15],[4200,5,30],[7200,10,60],[100,0,0],[1000,5,0],[2700,5,15],[4800,5,30],[8400,10,60]];
test('all ten initial BUSINESS prices/benefits match the legacy seed and production creation uses versioned DB catalog', () => {
 assert.equal(catalog.mockPackages.length, 10);
 for (const [index, [price, friends, days]] of expected.entries()) {
  const quote = quotePackage(index + 1, '');
  assert.deepEqual([quote.package.price, quote.package.friendCoupons, quote.package.bonusDays], [price, friends, days]);
  assert.equal(quote.amountSatang, price * 100);
  assert.equal(quote.pointsEarned, Math.floor(price / 20));
  assert.notEqual(quote.package, catalog.mockPackages[index]);
 }
 const server = read('./payment-server.ts');
 assert.doesNotMatch(server, /quotePackage\(parsed.data.packageId/);
 assert.match(server, /create_catalog_package_payment_order/);
 assert.match(server, /catalogVersion: parsed.data.catalogVersion/);
 assert.match(server, /JSON.stringify\(quote\)/);
 assert.match(server, /createInput = z.object\(\{ packageId:/);
});

const { PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite');
test('actual incremental SQL chain: paid-only atomic coupons, replay, no backfill, NORMAL auth and redemption', async () => {
 const db = new PGlite();
 try {
  await db.exec(`
   CREATE TYPE member_status AS ENUM ('PENDING','ACTIVE','EXPIRED','SUSPENDED');
   CREATE TYPE coupon_type AS ENUM ('FREE_ENTRY','FRIEND_PASS','EXTRA_DAYS','CUSTOM');
   CREATE TYPE coupon_status AS ENUM ('AVAILABLE','USED','EXPIRED');
   CREATE TABLE members(id serial PRIMARY KEY,phone text,full_name text,member_code text UNIQUE,status member_status,role text,points integer DEFAULT 0,expire_date timestamptz,updated_at timestamptz,avatar_url text);
   CREATE TABLE auth_sessions(id serial PRIMARY KEY,member_id integer REFERENCES members(id),token_hash text,expires_at timestamptz,revoked_at timestamptz);
   CREATE TABLE payments(id serial PRIMARY KEY,easyslip_trans_ref varchar(100));
   CREATE TABLE coupons(id serial PRIMARY KEY,member_id integer REFERENCES members(id),type coupon_type,source text,title text,status coupon_status DEFAULT 'AVAILABLE',total_quota integer,used_count integer,bonus_days_value integer DEFAULT 0,created_at timestamptz DEFAULT now(),expire_date timestamptz,UNIQUE(member_id,source));
   CREATE TABLE checkins(id serial PRIMARY KEY,member_id integer,scanner_type text,scanner_device_id text,points_awarded integer,notes text,checkin_time timestamptz DEFAULT now());
   CREATE TABLE rewards(id serial PRIMARY KEY,title text,description text,image_url text,point_cost integer,stock integer,is_active boolean,created_at timestamptz DEFAULT now());
   CREATE TABLE redemptions(id serial PRIMARY KEY,member_id integer REFERENCES members(id),reward_id integer REFERENCES rewards(id),points_spent integer,redeemed_at timestamptz DEFAULT now(),status text);
  `);
  for (const file of ['20261009_real_package_payments.sql','20261010_payment_promptpay.sql','20261024_kiosk.sql','20261024_real_benefits_admin.sql','20261024_real_rewards.sql','20261024_real_frontdesk.sql']) await db.exec(read('../db/migrations/' + file));
  const scalar = async sql => (await db.query(sql)).rows[0].value;
  const finalizer = await scalar("SELECT pg_get_functiondef('finalize_package_payment(uuid,integer,text,uuid)'::regprocedure) AS value");
  assert.match(finalizer, /mode = 'NORMAL'/);
  await db.exec(`INSERT INTO members(member_code,full_name,status,role,expire_date) SELECT 'M-'||i,'Memory fixture','ACTIVE','MEMBER',now()+interval '10 days' FROM generate_series(1,18) i;
   INSERT INTO members(member_code,full_name,status,role) VALUES('STAFF','Memory staff','ACTIVE','ADMIN');
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'token-'||id,now()+interval '1 day' FROM members;`);
  const receiver = { promptpay:'0973355322',bankCode:'004',bankAccount:'0528938965',name:'MEMORY TEST' };
  const create = async (member, pkg = 3, key = randomUUID(), quote = quotePackage(pkg, '')) => (await db.query('SELECT * FROM create_package_payment_order($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [randomUUID(),member,`token-${member}`,key,JSON.stringify(quote),JSON.stringify(receiver)])).rows[0];
  // Historical fixtures use the old finalizer, never direct/faked PAID updates.
  const settle = async (order, transRef = randomUUID(), beforeFinalize = async () => {}) => {
   const attempt = randomUUID();
   await db.query('SELECT * FROM claim_package_payment_attempt($1,$2,$3,$4,$5,false)', [order.id,order.member_id,`token-${order.member_id}`,attempt,'a'.repeat(64)]);
   const proof = { transRef,paidAt:new Date().toISOString(),amountSatang:order.amount_satang,bankCode:'004',receiverEvidence:'REGISTERED_ACCOUNT_V2',providerStrategy:'EASYSLIP_V2_REGISTERED_ACCOUNT',orderId:order.id,receiverIdentity:{ matchingType:'BANK_ACCOUNT',bankCode:'004',bankAccount:receiver.bankAccount,name:receiver.name,expectedName:receiver.name,normalizedName:'MEMORYTEST' } };
   await db.query("UPDATE package_payment_attempts SET state='VERIFIED',evidence=$2::jsonb WHERE id=$1", [attempt,JSON.stringify(proof)]);
   await beforeFinalize();
   return { attempt, row: (await db.query('SELECT * FROM finalize_package_payment($1,$2,$3,$4)', [order.id,order.member_id,`token-${order.member_id}`,attempt])).rows[0] };
  };
  const historical = await create(11);
  await settle(historical);
  const legacyPending = await create(12);
  await db.exec(read('../db/migrations/20261025_package_payment_benefits.sql'));
  assert.equal(await scalar("SELECT pg_get_functiondef('finalize_package_payment(uuid,integer,text,uuid)'::regprocedure) AS value"), finalizer);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM coupons'), 0);
  await settle(legacyPending);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM coupons'), 0);
  await assert.rejects(db.query('UPDATE package_payment_orders SET package_benefits_version=1 WHERE id=$1', [historical.id]), /immutable/);
  for (const [index, [,friends,days]] of expected.entries()) {
   const member = index + 1;
   const key = randomUUID();
   const order = await create(member, member, key);
   const retry = await create(member, member, key);
   assert.equal(retry.id, order.id);
   assert.equal((await db.query('SELECT * FROM coupons WHERE source LIKE $1', [`PACKAGE_ORDER:${order.id}:%`])).rows.length, 0);
   const expiryBefore = await scalar(`SELECT expire_date AS value FROM members WHERE id=${member}`);
   const paid = await settle(order);
   const coupons = (await db.query('SELECT * FROM coupons WHERE source LIKE $1 ORDER BY type', [`PACKAGE_ORDER:${order.id}:%`])).rows;
   assert.equal(coupons.length, Number(friends>0) + Number(days>0));
   for (const c of coupons) {
    assert.equal(c.member_id, member); assert.equal(c.status, 'AVAILABLE'); assert.equal(c.used_count, 0);
    assert.equal(c.expire_date.getTime(), paid.row.membership_expires_at.getTime());
    assert.equal(c.total_quota, c.type==='FRIEND_PASS' ? friends : 1);
    assert.equal(c.bonus_days_value, c.type==='EXTRA_DAYS' ? days : 0);
   }
   assert.equal(paid.row.membership_expires_at.getTime() - expiryBefore.getTime(), order.package_snapshot.durationDays * 86400000);
   await db.query('SELECT * FROM finalize_package_payment($1,$2,$3,$4)', [order.id,member,`token-${member}`,paid.attempt]);
   assert.equal((await db.query('SELECT * FROM coupons WHERE source LIKE $1', [`PACKAGE_ORDER:${order.id}:%`])).rows.length, coupons.length);
   assert.equal(await scalar(`SELECT count(*)::int AS value FROM package_payment_point_ledger WHERE member_id=${member}`), 1);
  }
  const rejected = await create(13);
  assert.equal((await settle(rejected, randomUUID(), () => db.exec("UPDATE members SET status='SUSPENDED' WHERE id=13"))).row.status, 'REJECTED');
  assert.equal(await scalar('SELECT count(*)::int AS value FROM coupons WHERE member_id=13'), 0);
  const duplicate = await create(16);
  const existingRef = await scalar('SELECT trans_ref AS value FROM package_payment_orders WHERE member_id=1');
  assert.equal((await settle(duplicate, existingRef)).row.rejection_reason, 'DUPLICATE_TRANS_REF');
  assert.equal(await scalar('SELECT count(*)::int AS value FROM coupons WHERE member_id=16'), 0);
  const malformed = await create(17, 3, randomUUID(), { ...quotePackage(3, ''), package: { ...quotePackage(3, '').package, bonusDays: 1.5 } });
  await assert.rejects(settle(malformed), /Invalid package benefit snapshot/);
  assert.equal(await scalar(`SELECT status AS value FROM package_payment_orders WHERE id='${malformed.id}'`), 'PENDING');
  assert.equal(await scalar('SELECT count(*)::int AS value FROM coupons WHERE member_id=17'), 0);
  assert.equal(await scalar('SELECT points AS value FROM members WHERE id=17'), 0);
  const kiosk = await create(14);
  await db.exec("UPDATE auth_sessions SET mode='KIOSK',device_id='isolated' WHERE member_id=14");
  await assert.rejects(settle(kiosk), /Unauthorized/);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM coupons WHERE member_id=14'), 0);
  // A collision must abort the entire settlement, not silently skip issuance.
  const atomic = await create(15);
  await db.query("INSERT INTO coupons(member_id,source,type,title,total_quota,used_count) VALUES(15,$1,'FRIEND_PASS','collision',5,0)", [`PACKAGE_ORDER:${atomic.id}:FRIEND_PASS`]);
  const before = await scalar('SELECT expire_date AS value FROM members WHERE id=15');
  await assert.rejects(settle(atomic), /unique/);
  assert.equal(await scalar(`SELECT status AS value FROM package_payment_orders WHERE id='${atomic.id}'`), 'PENDING');
  assert.equal(await scalar('SELECT points AS value FROM members WHERE id=15'), 0);
  assert.equal((await scalar('SELECT expire_date AS value FROM members WHERE id=15')).getTime(), before.getTime());
  assert.equal(await scalar(`SELECT count(*)::int AS value FROM payment_transfer_refs WHERE source='PACKAGE_ORDER:${atomic.id}'`), 0);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM package_payment_point_ledger WHERE member_id=15'), 0);
  const bonus = (await db.query("SELECT * FROM coupons WHERE member_id=3 AND type='EXTRA_DAYS'")).rows[0];
  const consume = key => db.query("SELECT real_benefits_admin_action('token-19','consume',$1,$2::jsonb)", [key,JSON.stringify({couponId:bonus.id})]);
  const consumeKey = randomUUID(); const oldExpiry = await scalar('SELECT expire_date AS value FROM members WHERE id=3');
  await consume(consumeKey); await consume(consumeKey);
  assert.equal((await scalar('SELECT expire_date AS value FROM members WHERE id=3')).getTime()-oldExpiry.getTime(),15*86400000);
  assert.equal((await scalar(`SELECT expire_date AS value FROM coupons WHERE id=${bonus.id}`)).getTime(), bonus.expire_date.getTime());
  assert.equal(await scalar(`SELECT count(*)::int AS value FROM benefit_consumptions WHERE coupon_id=${bonus.id}`), 1);
  const friend = (await db.query("SELECT * FROM coupons WHERE member_id=3 AND type='FRIEND_PASS'")).rows[0];
  const guestKey = randomUUID();
  const guestPayload = JSON.stringify({couponId:friend.id,guestReference:'Memory guest'});
  await db.query("SELECT real_benefits_admin_action('token-19','consume',$1,$2::jsonb)", [guestKey,guestPayload]);
  await db.query("SELECT real_benefits_admin_action('token-19','consume',$1,$2::jsonb)", [guestKey,guestPayload]);
  assert.equal(await scalar(`SELECT used_count AS value FROM coupons WHERE id=${friend.id}`), 1);
  assert.equal(await scalar(`SELECT guest_reference AS value FROM benefit_consumptions WHERE coupon_id=${friend.id}`), 'Memory guest');
 } finally { await db.close(); }
});
