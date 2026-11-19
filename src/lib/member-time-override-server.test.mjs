import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function load(path, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require: name => { assert.ok(name in imports, name); return imports[name]; },
    process: { env: { DATABASE_URL: 'OFFLINE_STUB' } }, Buffer, URL });
  return exports;
}
const order = '11111111-1111-4111-8111-111111111111';
const payload = { requestKey: '22222222-2222-4222-8222-222222222222', expectedOrderId: order,
  expectedVersion: 0, timeSlot: '00:00-24:00', reason: '  Temporary window  ' };
const state = { version: 0, entitlement: { orderId: order, baseSlot: '07:00-14:00', overrideSlot: null,
  expiresAt: '2027-01-02T05:04:03.123456+00:00' } };
const http = load('./auth/http.ts', { 'server-only': {}, 'next/server': { NextResponse: {
  json: (data, options) => Response.json(data, options),
} } });
function harness({ actor = { role: 'ADMIN', status: 'ACTIVE' }, token = 'a'.repeat(64), error, dbState = state } = {}) {
  const calls = [];
  const { memberTimeOverrideRequest } = load('./member-time-override-server.ts', {
    'server-only': {}, 'node:crypto': require('node:crypto'), zod: require('zod'), './auth/http': http,
    './package-catalog': load('./package-catalog.ts'),
    'next/headers': { cookies: async () => ({ get: () => ({ value: token }) }) },
    './auth/server': { getCurrentMember: async () => actor, SESSION_COOKIE: 'session' },
    '@neondatabase/serverless': { neon: () => async (parts, ...values) => {
      calls.push({ sql: parts.join('?'), values }); if (error) throw error;
      return [{ state: dbState, result: { ok: true, version: 1, internal: 'SECRET' } }];
    } },
    './payment-server': { boundedBody: async (request, max) => {
      const body = Buffer.from(await request.text()); if (body.length > max) throw Error('too large'); return body;
    } },
  });
  return { calls, run: ({ method = 'PATCH', body = payload, headers = {}, query = '', code = 'BLU-3' } = {}) =>
    memberTimeOverrideRequest(new Request('https://offline.invalid/time-override' + query, { method,
      headers: { 'content-type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }), code) };
}

test('staff-only and same-origin, with no client identity trusted', async () => {
  for (const method of ['GET', 'PATCH']) {
    for (const [opts, headers, expected] of [[{ actor: null }, { 'x-role': 'OWNER' }, 401],
      [{ actor: { role: 'MEMBER' } }, {}, 403], [{ actor: { role: 'ADMIN', status: 'SUSPENDED' } }, {}, 403],
      [{ token: 'bad' }, {}, 401], [{}, { origin: 'https://remote.invalid' }, 403], [{}, { 'sec-fetch-site': 'cross-site' }, 403]]) {
      const h = harness(opts);
      assert.equal((await h.run({ method, headers })).status, expected);
      assert.equal(h.calls.length, 0);
    }
  }
});
test('strict payload and Bangkok slot shape; never passes money, dates or member overrides from body', async () => {
  const h = harness();
  for (const bad of [{ amount: 0 }, { expireDate: '2099-01-01' }, { actorId: 1 }, { memberCode: 'BLU-8' },
    { timeSlot: '24:00-24:00' }, { timeSlot: '23:00-01:00' }, { timeSlot: '00:00-24:01' },
    { reason: ' ' }, { reason: 'a'.repeat(4100) }, { expectedOrderId: 'bad' }, { expectedVersion: '0' }, { requestKey: order.replace('4111', '7111') }]) {
    assert.equal((await h.run({ body: { ...payload, ...bad } })).status, 400);
  }
  assert.equal((await h.run({ query: '?memberCode=BLU-8' })).status, 400);
  assert.equal((await h.run({ code: 'CARD-123' })).status, 400);
  assert.equal(h.calls.length, 0);
});
test('versioned read and exact replay of normalized set/clear; response allowlist', async () => {
  const h = harness();
  const response = await h.run({ method: 'GET' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { state });
  for (const timeSlot of [null, '00:00-24:00']) {
    const args = { body: { ...payload, timeSlot } };
    assert.deepEqual(await (await h.run(args)).json(), { ok: true, version: 1 });
    await h.run(args);
    assert.deepEqual(h.calls.at(-1), h.calls.at(-2));
    const { values: [digest, key, raw] } = h.calls.at(-1);
    assert.equal(digest, createHash('sha256').update('a'.repeat(64)).digest('hex'));
    assert.equal(key, payload.requestKey);
    assert.deepEqual(JSON.parse(raw), { memberCode: 'BLU-3', expectedOrderId: order,
      expectedVersion: 0, timeSlot, reason: 'Temporary window' });
  }
});
test('missing migration and stale/current authorization failures do not leak details', async () => {
  for (const [code, status] of [['40001', 409], ['42501', 403], ['P0002', 404], ['22023', 400], ['42883', 503], ['08006', 503]]) {
    const h = harness({ error: { code, message: 'SECRET token order details' } });
    const response = await h.run();
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /SECRET/);
  }
  assert.equal((await harness({ dbState: { ...state, secret: 'SECRET' } }).run({ method: 'GET' })).status, 503);
});
