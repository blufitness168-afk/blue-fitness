import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, imports, globals = {}) {
  const exports = {};
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  vm.runInNewContext(outputText, { exports, require: name => { assert.ok(name in imports, name); return imports[name]; }, ...globals });
  return exports;
}

const owner = { role: 'OWNER', status: 'ACTIVE' };
const code = 'BLU-3';
const token = 'a'.repeat(64);
const digest = createHash('sha256').update(token).digest('hex');
const origin = 'https://blu.example';
const endpoint = `/api/admin/members/${code}/staff-free/cancellation`;
const saleId = '11111111-1111-4111-8111-111111111111';
const requestKey = '22222222-2222-4222-8222-222222222222';
const body = { saleId, requestKey, reason: '  สมาชิกขอยกเลิก  ' };
const term = { saleId, packageName: 'Synthetic', startsAt: '2027-01-01T00:00:00Z', endsAt: '2027-02-01T00:00:00Z' };
const receipt = { saleId, status: 'CANCELLED', source: 'STAFF_FREE_CANCELLATION', amountSatang: 0, cancelledAt: '2026-11-20T00:00:00Z' };
const { sameOrigin, json } = load('./auth/http.ts', { 'server-only': {}, 'next/server': { NextResponse: Response } }, { URL });

function harness({ enabled = true, actor = owner, cookie = token, dbCode, rows = [{ candidates: [term], receipt }] } = {}) {
  const queries = [];
  const server = load('./staff-free-cancellation-server.ts', {
    'server-only': {}, 'node:crypto': { createHash }, 'next/headers': { cookies: async () => ({ get: () => ({ value: cookie }) }) },
    'zod': require('zod'), './auth/http': { sameOrigin, json }, './auth/server': { SESSION_COOKIE: 'test', getCurrentMember: async () => actor },
    './staff-free-server': { isStaffFreeEnabled: () => enabled }, './payment-server': { boundedBody: async (req, limit) => {
      assert.equal(limit, 4096);
      const bytes = Buffer.from(await req.arrayBuffer());
      if (bytes.length > limit) throw Error('oversize');
      return bytes;
    } },
    '@neondatabase/serverless': { neon: () => async (parts, ...values) => {
      queries.push({ statement: parts.join('?'), values });
      if (dbCode) throw Object.assign(new Error('PRIVATE DB DETAIL'), { code: dbCode });
      return rows;
    } },
  }, { URL, process: { env: { DATABASE_URL: 'offline' } } });
  const route = load('../app/api/admin/members/[memberCode]/staff-free/cancellation/route.ts', { '@/lib/staff-free-cancellation-server': server });
  const get = (target = code, suffix = '') => route.GET(new Request(origin + endpoint + suffix), { params: Promise.resolve({ memberCode: target }) });
  const post = (payload = body, headers = { origin, 'content-type': 'application/json' }, target = code) => route.POST(
    new Request(origin + endpoint, { method: 'POST', body: JSON.stringify(payload), headers }), { params: Promise.resolve({ memberCode: target }) });
  return { get, post, queries, read: server.readStaffFreeCancellationCandidates };
}

test('flag, normal OWNER session and canonical route code gate both operations', async () => {
  for (const [options, status] of [[{ enabled: false }, 503], [{ actor: null }, 401], [{ actor: { role: 'ADMIN' } }, 403],
      [{ actor: { ...owner, status: 'SUSPENDED' } }, 403], [{ cookie: 'bad' }, 401]]) {
    const h = harness(options);
    assert.equal((await h.get()).status, status);
    assert.equal((await h.post()).status, status);
    assert.equal((await h.read(code)).length, 0);
    assert.deepEqual(h.queries, []);
  }
  const h = harness();
  assert.equal((await h.get('3')).status, 400);
  assert.equal((await h.get(code, '?all=true')).status, 400);
  assert.equal((await h.post(body, undefined, '3')).status, 400);
  assert.deepEqual(h.queries, []);
});

test('strict request body and same-origin POST; no legacy sale-ID-only SQL path', async () => {
  const h = harness();
  for (const headers of [{}, { origin: 'https://elsewhere.example' }, { origin, 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await h.post(body, headers)).status, 403);
  }
  for (const bad of [{ ...body, memberCode: 'BLU-4' }, { ...body, reason: ' ' }, { ...body, reason: 'x'.repeat(5000) }, { ...body, requestKey: 'bad' }]) {
    assert.equal((await h.post(bad)).status, 400);
  }
  assert.deepEqual(h.queries, []);
  for (let retry = 0; retry < 2; retry++) {
    const res = await h.post();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { receipt });
  }
  const expected = { statement: 'SELECT r4_staff_private.cancel_member_free_sale(?,?,?::uuid,?::uuid,?) AS receipt',
    values: [digest, code, requestKey, saleId, 'สมาชิกขอยกเลิก'] };
  assert.deepEqual(h.queries, [expected, expected]);
});

test('scoped list is uncached, and rejects unexpected finance/history or mismatched receipts', async () => {
  const h = harness();
  const res = await h.get('BLU-4');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { candidates: [term] });
  assert.deepEqual(h.queries, [{ statement: 'SELECT r4_staff_private.list_free_sale_cancellations(?,?) AS candidates', values: [digest, 'BLU-4'] }]);
  const badList = harness({ rows: [{ candidates: [{ ...term, predecessorOrderId: saleId }] }] });
  assert.equal((await badList.get()).status, 503);
  assert.equal((await badList.read(code)).length, 0);
  const badReceipt = harness({ rows: [{ receipt: { ...receipt, saleId: requestKey } }] });
  assert.equal((await badReceipt.post()).status, 503);
});

test('DB is final authority; missing stack fails closed and errors never expose SQL detail', async () => {
  for (const [dbCode, expected] of [['0A000', 503], ['42883', 503], ['42501', 403], ['55000', 409], ['40001', 503]]) {
    const h = harness({ dbCode });
    const res = await h.post();
    assert.equal(res.status, expected);
    assert.doesNotMatch(await res.text(), /PRIVATE DB DETAIL/);
    assert.equal((await h.read(code)).length, 0);
  }
});

test('confirmation freezes the selected term and resends the same payload after an ambiguous response', async () => {
  let cursor = 0, refreshes = 0, generatedKeys = 0;
  const cells = [], requests = [];
  const element = (type, props) => ({ type, props });
  const { default: Section } = load('../app/admin/members/[memberCode]/StaffFreeCancellationSection.tsx', {
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'next/navigation': { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in cells)) cells[index] = initial;
        return [cells[index], value => { cells[index] = value; }];
      },
      useRef(initial) {
        const index = cursor++;
        return cells[index] ??= { current: initial };
      },
    },
  }, {
    FormData: class { constructor(form) { this.form = form; } get(name) { return this.form[name]; } },
    crypto: { randomUUID: () => { generatedKeys++; return requestKey; } },
    fetch: async (url, opts) => {
      requests.push([url, opts.body]);
      return requests.length === 1 ? new Response(null, { status: 503 }) : Response.json({ receipt });
    },
  });
  function* nodes(node) {
    if (Array.isArray(node)) { for (const child of node) yield* nodes(child); }
    else if (node?.props) { yield node; yield* nodes(node.props.children); }
  }
  const render = () => { cursor = 0; return [...nodes(Section({ memberCode: code, candidates: [term] }))]; };
  const submit = async reason => render().find(node => node.type === 'form').props.onSubmit({
    preventDefault() {}, currentTarget: { reason },
  });
  assert.equal(render().some(node => node.type === 'form'), false);
  render().find(node => node.type === 'button').props.onClick();
  await submit('   ');
  assert.equal(requests.length, 0);
  await submit(body.reason);
  assert.ok(render().find(node => node.type === 'input').props.readOnly);
  assert.equal(render().find(node => node.props.type === 'submit').props.children, 'ส่งคำขอเดิมซ้ำ');
  await submit('changed reason');
  const expected = [endpoint, JSON.stringify({ saleId, requestKey, reason: body.reason.trim() })];
  assert.deepEqual(requests, [expected, expected]);
  assert.equal(generatedKeys, 1);
  assert.equal(refreshes, 1);
  assert.equal(render().some(node => node.type === 'button'), false);
});
