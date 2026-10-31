import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const code = name => ts.transpileModule(fs.readFileSync(new URL(`./${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const token = 'a'.repeat(64);
const requestKey = 'A1234567-1234-4123-8123-123456789ABC';
const valid = { requestKey, id: 2, expectedVersion: 7, name: ' BLU 30 ', label: ' Monthly ', description: 'DB catalog', price: 901.25, durationDays: 30, timeSlot: '07:00-22:00', friendCoupons: 2, bonusDays: 3, isActive: true };
const packages = [{ id: 2, catalogVersion: 7, name: 'DB only', price: 901.25 }];
const request = (body = valid, headers = {}) => new Request('https://local/api/admin/packages', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = () => new Request('https://local/api/admin/packages');

function setup({ member = { role: 'OWNER', status: 'ACTIVE' }, session = token, database = true, error = null } = {}) {
  const queries = [], modules = new Map();
  let authCalls = 0, connections = 0;
  const sql = async (parts, ...values) => {
    const text = parts.join('?');
    queries.push({ text, values });
    if (error) throw Object.assign(new Error('offline failure'), { code: error });
    if (text.includes('package_catalog_public')) return [{ packages }];
    if (text.includes("'list'")) return [{ result: packages }];
    if (text.includes("'update'")) return [{ result: { ...packages[0], catalogVersion: 8 } }];
    throw Error(`Unexpected SQL: ${text}`);
  };
  function load(name) {
    if (name === 'server-only') return {};
    if (name === '@neondatabase/serverless') return { neon: () => { connections++; return sql; } };
    if (name === 'next/headers') return { cookies: async () => ({ get: () => session ? { value: session } : undefined }) };
    if (name === 'next/server') return { NextResponse: Response };
    if (name === './auth/server') return { SESSION_COOKIE: 'blu_session', getCurrentMember: async () => { authCalls++; return member; } };
    if (!name.startsWith('./')) return require(name);
    if (!modules.has(name)) {
      const exports = {};
      modules.set(name, exports);
      vm.runInNewContext(code(name.slice(2)), { exports, require: load, Buffer, Request, Response, URL, Uint8Array, AbortSignal, setTimeout, clearTimeout, process: { env: database ? { DATABASE_URL: 'offline' } : {} }, fetch: () => { throw Error('Network forbidden'); } });
    }
    return modules.get(name);
  }
  // Load the real HTTP helpers and payment boundedBody through the same VM loader.
  return { ...load('./package-catalog-server'), queries, counts: () => ({ authCalls, connections }) };
}

function noStore(response, status = 200) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /application\/json/);
}

test('public catalog returns only DB JSON, no-store, without authentication', async () => {
  const app = setup({ member: null });
  const response = await app.publicPackages();
  noStore(response);
  assert.deepEqual(await response.json(), { packages });
  assert.equal(app.counts().authCalls, 0);
  assert.equal(app.queries.length, 1);
  assert.match(app.queries[0].text, /package_catalog_public/);
  assert.deepEqual(app.queries[0].values, []);
});

test('public catalog fails closed with 503 and no static fallback', async () => {
  for (const options of [{ database: false }, { error: '08006' }]) {
    const app = setup(options);
    const response = await app.publicPackages();
    noStore(response, 503);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ['error']);
    assert.equal(typeof body.error, 'string');
    assert.equal(app.counts().authCalls, 0);
  }
});

test('private catalog denies guest, member, admin, suspended owner and invalid sessions before SQL', async () => {
  for (const [options, status] of [
    [{ member: null }, 401],
    [{ member: { role: 'MEMBER', status: 'ACTIVE' } }, 403],
    [{ member: { role: 'ADMIN', status: 'ACTIVE' } }, 403],
    [{ member: { role: 'OWNER', status: 'SUSPENDED' } }, 401],
    [{ session: null }, 401], [{ session: 'forged' }, 401],
  ]) {
    for (const req of [get(), request()]) {
      const app = setup(options);
      noStore(await app.adminPackages(req), status);
      assert.equal(app.queries.length, 0);
      assert.equal(app.counts().connections, 0);
    }
  }
});

test('OWNER active, pending and expired can list and edit; only hashed token and normalized payload reach SQL', async () => {
  for (const status of ['ACTIVE', 'PENDING', 'EXPIRED']) {
    const app = setup({ member: { role: 'OWNER', status } });
    const listed = await app.adminPackages(get());
    noStore(listed);
    assert.deepEqual(await listed.json(), { data: { packages } });
    const updated = await app.adminPackages(request());
    noStore(updated);
    assert.deepEqual(await updated.json(), { data: { package: { ...packages[0], catalogVersion: 8 } } });
    const digest = createHash('sha256').update(token).digest('hex');
    assert.deepEqual(app.queries[0].values, [digest]);
    const query = app.queries[1];
    assert.match(query.text, /package_catalog_action.*'update'/);
    assert.equal(query.values[0], digest);
    assert.notEqual(query.values[0], token);
    assert.equal(query.values[1], requestKey.toLowerCase());
    const { requestKey: ignoredKey, price: ignoredPrice, ...fields } = valid;
    assert.ok(ignoredKey && ignoredPrice);
    assert.deepEqual(JSON.parse(query.values[2]), { ...fields, name: 'BLU 30', label: 'Monthly', priceSatang: 90125 });
    assert.equal(JSON.stringify(app.queries).includes(token), false);
  }
});

test('CSRF and unsupported methods reject before authentication or SQL', async () => {
  for (const req of [request(valid, { Origin: 'https://evil' }), request(valid, { 'Sec-Fetch-Site': 'cross-site' }), new Request('https://local/api/admin/packages', { method: 'DELETE' })]) {
    const app = setup();
    noStore(await app.adminPackages(req), req.method === 'DELETE' ? 405 : 403);
    assert.deepEqual(app.counts(), { authCalls: 0, connections: 0 });
    assert.equal(app.queries.length, 0);
  }
});

test('strict schema rejects precision, forged fields, invalid UUID, id and expectedVersion without mutation SQL', async () => {
  const { expectedVersion: omittedVersion, ...missingVersion } = valid;
  const { id: omittedId, ...missingId } = valid;
  assert.ok(omittedVersion && omittedId);
  for (const body of [missingVersion, missingId, ...[
    { price: 1.001 }, { price: 0 }, { price: -1 }, { price: 1000001 },
    { priceSatang: 1 }, { role: 'OWNER' }, { catalogVersion: 7 }, { requestKey: 'invalid' },
    { id: 0 }, { id: 11 }, { id: 1.5 }, { id: '2' },
    { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: 2147483648 }, { expectedVersion: '7' },
  ].map(patch => ({ ...valid, ...patch }))]) {
    const app = setup();
    noStore(await app.adminPackages(request(body)), 400);
    assert.equal(app.queries.length, 0, JSON.stringify(body));
  }
});

test('real bounded JSON parser rejects wrong content type, malformed JSON and actual oversized chunked body', async () => {
  const malformed = new Request('https://local/api/admin/packages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  const oversized = new Request('https://local/api/admin/packages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '1' }, body: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('{"padding":"')); controller.enqueue(Buffer.alloc(16385, 97)); controller.enqueue(Buffer.from('"}')); controller.close(); } }), duplex: 'half' });
  for (const req of [request(valid, { 'Content-Type': 'text/plain' }), malformed, oversized, request(valid, { 'Content-Length': '16385' })]) {
    const app = setup();
    noStore(await app.adminPackages(req), 400);
    assert.equal(app.queries.length, 0);
  }
});

test('retry explicitly forwards the same UUID and identical payload, preserving expectedVersion', async () => {
  const app = setup();
  const first = await app.adminPackages(request());
  const replay = await app.adminPackages(request());
  noStore(first);
  noStore(replay);
  assert.deepEqual(await replay.json(), await first.json());
  assert.equal(app.queries.length, 2);
  assert.deepEqual(app.queries[1], app.queries[0]);
  assert.equal(app.queries[1].values[1], requestKey.toLowerCase());
  assert.equal(JSON.parse(app.queries[1].values[2]).expectedVersion, 7);
});

test('DB authorization, version/replay conflict, constraints and unavailable errors map without success fallback', async () => {
  for (const [error, status] of [['42501', 403], ['P0001', 409], ['22023', 409], ['23505', 409], ['23514', 400], ['22003', 400], ['08006', 503]]) {
    const app = setup({ error });
    const response = await app.adminPackages(request());
    noStore(response, status);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ['error']);
    if (status === 503) assert.match(body.error, /คำขอเดิมซ้ำ/);
    assert.equal(app.queries.length, 1);
  }
});
