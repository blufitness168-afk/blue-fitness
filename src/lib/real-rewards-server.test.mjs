import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(member = { id: 1, role: 'MEMBER', status: 'ACTIVE' }, failures = []) {
  const calls = [];
  const filename = new URL('./real-rewards-server.ts', import.meta.url).pathname;
  const source = ts.transpileModule(readFileSync(new URL('./real-rewards-server.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(filename);
  loaded.require = name => {
    if (name === 'server-only') return {};
    if (name === './auth/server') return { SESSION_COOKIE: 'blu_session', getCurrentMember: async () => member };
    if (name === 'next/headers') return { cookies: async () => ({ get: () => ({ value: 'a'.repeat(64) }) }) };
    if (name === './auth/http') return { json: (body, status = 200) => ({ body, status }), readBody: async request => request.json() };
    if (name === '@neondatabase/serverless') return { neon: () => async (parts, ...values) => {
      calls.push({ text: parts.join('?'), values });
      const code = failures.shift(); if (code) throw Object.assign(new Error('test'), { code });
      return [{ result: { points: 12 } }];
    } };
    return require(name);
  };
  loaded._compile(source, filename);
  return { ...loaded.exports, calls };
}
const request = (body = {}, method = 'POST') => new Request('https://example.test/api/rewards/redeem', { method, ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
test('guards reject unauthenticated, suspended and member staff access before SQL', async () => {
  for (const member of [null, { role: 'MEMBER', status: 'SUSPENDED' }]) {
    const api = load(member); assert.equal((await api.rewardsAction(request(), 'redeem')).status, 401); assert.equal(api.calls.length, 0);
  }
  for (const action of ['admin', 'save', 'deliver']) {
    const api = load(); assert.equal((await api.rewardsAction(request({}, action === 'admin' ? 'GET' : 'POST'), action)).status, 403); assert.equal(api.calls.length, 0);
  }
});
test('payload strips forged member, balance, cost and code; rejects invalid integers/UUID', async () => {
  const api = load();
  assert.deepEqual(api.rewardPayload('redeem', { rewardId: 2, memberId: 99, pointCost: 0, points: 999 }), { rewardId: 2 });
  for (const rewardId of [-1, 0, 1.5, '2', Infinity]) assert.equal(api.rewardPayload('redeem', { rewardId }), null);
  assert.equal(api.rewardPayload('deliver', { rewardCode: 'BLU-1' }), null);
  assert.equal((await api.rewardsAction(request({ rewardId: 2, requestKey: 'invalid' }), 'redeem')).status, 400);
  assert.equal(api.calls.length, 0);
});
test('SQL receives session digest and canonical UUID; transient retries retain exact request', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'isolated-mock-only';
  try {
    const api = load(undefined, ['40001', '40P01']); const key = randomUUID();
    assert.equal((await api.rewardsAction(request({ rewardId: 2, memberId: 100, requestKey: key }), 'redeem')).status, 200);
    assert.equal(api.calls.length, 3); assert.deepEqual(api.calls[0], api.calls[2]);
    assert.match(api.calls[0].text, /real_rewards_action/);
    assert.match(api.calls[0].values[0], /^[a-f0-9]{64}$/);
    assert.notEqual(api.calls[0].values[0], 'a'.repeat(64));
    assert.equal(api.calls[0].values[2], key);
    assert.deepEqual(JSON.parse(api.calls[0].values[3]), { rewardId: 2 });
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});
test('actual HTTP helper enforces same origin and bounded JSON; clients never import browser mock stores', () => {
  const helper = readFileSync(new URL('./auth/http.ts', import.meta.url), 'utf8');
  assert.match(helper, /if \(!sameOrigin\(request\)\) return null/);
  assert.match(helper, /Buffer.byteLength\(text, "utf8"\) > 4096/);
  for (const path of ['../app/member/rewards/RewardsClient.tsx', '../app/admin/rewards/page.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|reward-catalog|front-desk|admin-mock|mock-data/);
    assert.match(source, /crypto.randomUUID/);
  }
});

// Exercise the component's event handlers with isolated hook state, without a browser/server.
function memberClient(initialData) {
  const filename = new URL('../app/member/rewards/RewardsClient.tsx', import.meta.url).pathname;
  const source = ts.transpileModule(readFileSync(new URL('../app/member/rewards/RewardsClient.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const slots = []; let cursor = 0;
  const hooks = {
    useState(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = value;
      return [slots[index], next => { slots[index] = next; }];
    },
    useRef(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: value };
      return slots[index];
    },
  };
  const loaded = new Module(filename);
  loaded.require = name => {
    if (name === 'react') return hooks;
    if (name === 'next/link') return { __esModule: true, default: 'a' };
    if (name === 'qrcode.react') return { QRCodeSVG: 'svg' };
    return require(name);
  };
  loaded._compile(source, filename);
  const render = () => { cursor = 0; return loaded.exports.default({ initialData }); };
  function nodes(tree, predicate) {
    if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, predicate));
    if (!tree || typeof tree !== 'object') return [];
    return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
  }
  return { render, nodes };
}
test('independent pending retry survives catalog removal and reuses snapshot/UUID', async () => {
  const reward = { id: 7, title: 'Original reward', description: null, imageUrl: null, pointCost: 30, stock: 1, isActive: true };
  const initialData = { points: 100, fullName: 'One', memberCode: 'BLU-1', rewards: [reward], redemptions: [] };
  const client = memberClient(initialData);
  const previousFetch = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/rewards/member') return Response.json({ data: { ...initialData, points: 70, rewards: [] } });
    writes.push(JSON.parse(options.body));
    if (writes.length === 1) return Response.json({ error: 'Unknown result' }, { status: 503 });
    return Response.json({ data: { rewardCode: 'confirmed-original' } });
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const button = (tree, text) => client.nodes(tree, node => node.type === 'button' && node.props.children === text)[0];
  try {
    button(client.render(), 'แลกรางวัล').props.onClick(); await settle();
    let tree = client.render();
    assert.equal(button(tree, 'แลกรางวัล').props.disabled, true);
    // The catalog refresh can remove the deactivated reward entirely.
    button(tree, 'โหลดข้อมูลใหม่').props.onClick(); await settle();
    tree = client.render();
    assert.equal(client.nodes(tree, node => node.type === 'article').length, 0);
    const retry = button(tree, 'ลองคำขอเดิม');
    assert.ok(retry); assert.equal(retry.props.disabled, false);
    const panel = client.nodes(tree, node => node.props?.['aria-label'] === 'คำขอแลกรางวัลที่ยังไม่ทราบผล')[0];
    const status = client.nodes(panel, node => node.props?.role === 'status')[0];
    assert.ok(status.props.children.includes('Original reward'));
    assert.ok(status.props.children.includes(30));
    retry.props.onClick(); await settle();
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1], writes[0]);
    assert.equal(writes[1].rewardId, 7);
    assert.match(writes[1].requestKey, /^[0-9a-f-]{36}$/);
    assert.equal(button(client.render(), 'ลองคำขอเดิม'), undefined);
  } finally { globalThis.fetch = previousFetch; }
});

let PGlite;
try { ({ PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite')); } catch { /* Optional existing isolated SQL harness; never connect to DATABASE_URL. */ }
test('real PostgreSQL migration and atomic redemption invariants (isolated WASM)', { skip: !PGlite && 'Install existing isolated PGlite harness to execute SQL assertions' }, async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE members(id serial PRIMARY KEY, member_code text,full_name text,points integer NOT NULL DEFAULT 0,status text,role text,updated_at timestamptz);
      CREATE TABLE auth_sessions(id serial PRIMARY KEY,member_id integer REFERENCES members(id),token_hash text,mode text DEFAULT 'NORMAL',revoked_at timestamptz,expires_at timestamptz);
      CREATE TABLE rewards(id serial PRIMARY KEY,title text NOT NULL,description text,image_url text,point_cost integer NOT NULL,stock integer NOT NULL DEFAULT 0,is_active boolean NOT NULL DEFAULT true,created_at timestamptz DEFAULT now());
      CREATE TABLE redemptions(id serial PRIMARY KEY,member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,reward_id integer NOT NULL REFERENCES rewards(id) ON DELETE RESTRICT,points_spent integer NOT NULL,redeemed_at timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'COMPLETED');
      INSERT INTO members(member_code,full_name,points,status,role) VALUES('BLU-1','One',100,'ACTIVE','MEMBER'),('BLU-2','Two',100,'ACTIVE','MEMBER'),('BLU-3','Staff',0,'ACTIVE','ADMIN'),('BLU-4','Owner',0,'ACTIVE','OWNER');
      INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'token-'||id,now()+interval '1 day' FROM members;
      INSERT INTO rewards(title,point_cost,stock) VALUES('Physical reward',30,2),('Last item',80,1),('Disabled',1,1);
      UPDATE rewards SET is_active=false WHERE id=3;
    `);
    const migration = readFileSync(new URL('../db/migrations/20261024_real_rewards.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    // Verify actual PostgreSQL ACLs, not just the REVOKE statement's presence.
    const acl = (await db.query(`SELECT p.prosecdef,
      has_function_privilege(p.proowner,p.oid,'EXECUTE') AS owner_execute,
      p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS runtime_is_owner,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
      FROM pg_proc p WHERE p.oid='real_rewards_action(text,text,uuid,jsonb)'::regprocedure`)).rows[0];
    assert.deepEqual(acl, { prosecdef: false, owner_execute: true, runtime_is_owner: true, public_execute: false });
    await db.exec('CREATE ROLE rewards_untrusted NOLOGIN');
    assert.equal((await db.query("SELECT has_function_privilege('rewards_untrusted','real_rewards_action(text,text,uuid,jsonb)','EXECUTE') AS allowed")).rows[0].allowed, false);
    await db.exec('SET ROLE rewards_untrusted');
    try {
      await assert.rejects(db.query("SELECT real_rewards_action('token-1','member',NULL,'{}')"), /permission denied for function/);
    } finally { await db.exec('RESET ROLE'); }
    const call = async (actor, action, payload = {}, key = randomUUID()) => (await db.query('SELECT real_rewards_action($1,$2,$3::uuid,$4::jsonb) AS result', [`token-${actor}`, action, key, JSON.stringify(payload)])).rows[0].result;
    const scalar = async sql => (await db.query(sql)).rows[0].value;
    // SQL must authorize the current persisted actor even if the HTTP guard was bypassed.
    await assert.rejects(call(999, 'member'), /Unauthorized/);
    for (const actor of [3, 4]) {
      await db.exec(`UPDATE members SET status='SUSPENDED' WHERE id=${actor}`);
      for (const action of ['admin', 'save', 'deliver']) await assert.rejects(call(actor, action), /Unauthorized/);
      await db.exec(`UPDATE members SET status='ACTIVE' WHERE id=${actor}`);
    }
    const key = randomUUID(); const first = await call(1, 'redeem', { rewardId: 1 }, key);
    assert.equal(first.points, 70); assert.equal(first.status, 'PENDING');
    assert.deepEqual(await call(1, 'redeem', { rewardId: 1 }, key), first);
    await assert.rejects(call(1, 'redeem', { rewardId: 2 }, key), /Request key reused/);
    assert.equal(await scalar('SELECT stock AS value FROM rewards WHERE id=1'), 1);
    assert.equal(await scalar('SELECT count(*)::int AS value FROM reward_point_spend_ledger'), 1);
    await assert.rejects(call(1, 'redeem', { rewardId: 2 }), /Insufficient points/);
    assert.equal(await scalar('SELECT stock AS value FROM rewards WHERE id=2'), 1);
    await assert.rejects(call(1, 'redeem', { rewardId: 3 }), /Reward unavailable/);
    await call(2, 'redeem', { rewardId: 2 });
    await assert.rejects(call(1, 'redeem', { rewardId: 2 }), /Reward unavailable/);
    const own = await call(1, 'member', { memberId: 2 });
    assert.equal(own.redemptions.length, 1);
    assert.ok(own.redemptions.every(row => row.memberCode === 'BLU-1'));
    const other = await call(2, 'member', { memberId: 1 });
    assert.equal(other.redemptions.length, 1);
    assert.ok(other.redemptions.every(row => row.memberCode === 'BLU-2'));
    for (const action of ['admin','save','deliver']) await assert.rejects(call(1, action, { rewardCode: first.rewardCode }), /Forbidden/);
    await db.exec("UPDATE members SET status='SUSPENDED' WHERE id=1");
    await assert.rejects(call(1, 'redeem', { rewardId: 1 }, key), /Unauthorized/);
    await assert.rejects(call(3, 'deliver', { rewardCode: first.rewardCode }), /Recipient unavailable/);
    await db.exec("UPDATE members SET status='ACTIVE' WHERE id=1");
    const delivered = await call(3, 'deliver', { rewardCode: first.rewardCode });
    assert.equal(delivered.status, 'COMPLETED');
    assert.deepEqual(await call(4, 'deliver', { rewardCode: first.rewardCode }), delivered);
    assert.equal(await scalar('SELECT completed_by AS value FROM redemptions WHERE id=1'), 3);
    assert.equal(await scalar('SELECT points AS value FROM members WHERE id=1'), 70);
    // A ledger failure must roll back both wallet, stock and redemption.
    await db.exec("CREATE FUNCTION fail_rewards_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ledger failure'; END $$; CREATE TRIGGER fail_ledger BEFORE INSERT ON reward_point_spend_ledger FOR EACH ROW EXECUTE FUNCTION fail_rewards_ledger();");
    await assert.rejects(call(1, 'redeem', { rewardId: 1 }), /ledger failure/);
    assert.equal(await scalar('SELECT points AS value FROM members WHERE id=1'), 70);
    assert.equal(await scalar('SELECT stock AS value FROM rewards WHERE id=1'), 1);
    assert.equal(await scalar('SELECT count(*)::int AS value FROM redemptions'), 2);
    await db.exec('DROP TRIGGER fail_ledger ON reward_point_spend_ledger');
    // Editing a stale stock snapshot must not restore spent inventory.
    const old = (await call(3, 'admin')).rewards.find(r => r.id === 1);
    await call(1, 'redeem', { rewardId: 1 });
    await assert.rejects(call(3, 'save', { ...old, stock: 10, expected: old }), /Reward changed/);
    const fresh = (await call(3, 'admin')).rewards.find(r => r.id === 1);
    await call(4, 'save', { ...fresh, stock: 5, expected: fresh });
    assert.equal(await scalar('SELECT stock AS value FROM rewards WHERE id=1'), 5);
    await call(3, 'save', { title: 'New', description: null, imageUrl: null, pointCost: 5, stock: 1, isActive: true });
    for (const update of ["mode='KIOSK'", "mode='NORMAL',revoked_at=now()", "revoked_at=NULL,expires_at=now()-interval '1 day'"]) {
      await db.exec(`UPDATE auth_sessions SET ${update} WHERE member_id=1`);
      await assert.rejects(call(1, 'member'), /Unauthorized/);
    }
    await db.exec("UPDATE members SET role='MEMBER' WHERE id=3");
    for (const action of ['admin', 'save', 'deliver']) await assert.rejects(call(3, action), /Forbidden/);
  } finally { await db.close(); }
});
