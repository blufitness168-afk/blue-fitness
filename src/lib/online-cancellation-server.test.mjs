import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';

const code = name => ts.transpileModule(readFileSync(new URL(`./${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const orderId = '3bb079f9-34ce-4035-a69c-57f0b70cf28c';
const requestKey = '472258a9-7d13-4319-9cae-d0b831d64c4f';
const token = 'a'.repeat(64);
const digest = createHash('sha256').update(token).digest('hex');
const origin = 'https://test.invalid';
const url = `${origin}/api/owner/online-cancellations/${orderId}`;
const preview = { orderId, memberCode: 'BLU-3', packageName: '30 days', amountSatang: 90000, pointsToReverse: 4,
  confirmedAt: '2026-11-25T08:00:00+00:00', eligible: true, blocker: null };
const receipt = { orderId, source: 'ONLINE_REFUND', status: 'CANCELLED', cancelledAt: preview.confirmedAt, refundSatang: 90000, pointsReversed: 4 };
const payload = { requestKey, reason: ' external payment ref ', refundSatang: 90000, confirmedFullExternalRefund: true };
const post = (patch = {}, headers = { Origin: origin }) => new Request(url, { method: 'POST',
  body: JSON.stringify({ ...payload, ...patch }), headers: { ...headers, 'Content-Type': 'application/json' } });

function setup({ role = 'OWNER', status = 'ACTIVE', enabled = 'true', reads = 'true', result = { preview, receipt }, failures = [] } = {}) {
  const calls = [], modules = new Map();
  const imports = {
    'server-only': {}, zod, 'node:crypto': { createHash },
    'next/headers': { cookies: async () => ({ get: () => ({ value: token }) }) },
    './auth/server': { SESSION_COOKIE: 'test', getCurrentMember: async () => role ? { role, status } : null },
    './auth/http': { json: (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }),
      sameOrigin: request => request.headers.get('sec-fetch-site') !== 'cross-site' && (!request.headers.get('origin') || request.headers.get('origin') === origin) },
    './payment-server': { boundedBody: async (request, maxBytes) => {
      assert.equal(maxBytes, 4096); const buf = Buffer.from(await request.text());
      if (buf.length > maxBytes) throw Error('too large'); return buf;
    } },
    '@neondatabase/serverless': { neon: () => {
      const sql = (parts, ...values) => ({ then(resolve, reject) {
        calls.push({ statement: parts.join('?'), values });
        if (failures.length) reject(Object.assign(Error('private details'), { code: failures.shift() }));
        else resolve([result]);
      } });
      sql.transaction = (queries, options) => {
        assert.equal(options.isolationLevel, 'ReadCommitted');
        return Promise.all(queries);
      };
      return sql;
    } },
  };
  function load(name) {
    if (name in imports) return imports[name];
    if (modules.has(name)) return modules.get(name);
    const exports = {};
    vm.runInNewContext(code(name.slice(2)), { exports, require: load, URL, process: { env: {
      DATABASE_URL: 'offline', ENABLE_ONLINE_CANCELLATION: enabled, ENABLE_ONLINE_CANCELLATION_READS: reads,
    } } });
    modules.set(name, exports);
    return exports;
  }
  const { onlineCancellationRequest } = load('./online-cancellation-server');
  return { calls, run: (request = new Request(url), id = orderId) => onlineCancellationRequest(request, id) };
}

test('only NORMAL OWNER, both flags, valid same-origin JSON and positive integer satang can reach RPC', async () => {
  for (const [config, request, status] of [
    [{ role: null }, post(), 401], [{ role: 'ADMIN' }, post(), 403], [{ role: 'MEMBER' }, new Request(url), 403],
    [{ status: 'SUSPENDED' }, post(), 403], [{ enabled: '1' }, post(), 503], [{ reads: 'false' }, post(), 503],
    [{}, post({}, {}), 403], [{}, post({}, { Origin: 'https://other.invalid' }), 403],
    [{}, post({ confirmedFullExternalRefund: false }), 400], [{}, post({ refundSatang: 1.01 }), 400],
    [{}, post({ refundSatang: 2147483648 }), 400], [{}, post({ reason: ' '.repeat(5000) }), 400],
    [{}, post({ memberCode: 'BLU-5' }), 400],
  ]) {
    const app = setup(config);
    assert.equal((await app.run(request)).status, status);
    assert.equal(app.calls.length, 0);
  }
});

test('preview validates SQL contract, typed blockers and no-store; not found and unavailable never fake success', async () => {
  const app = setup();
  const response = await app.run();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { preview });
  assert.match(app.calls[0].statement, /r4_online_private\.preview_online_cancellation\(\?, \?::uuid\)/);
  assert.deepEqual(app.calls[0].values, [digest, orderId]);
  for (const blocker of ['ALREADY_CANCELLED', 'READERS_NOT_ENABLED', 'REVIEW_REQUIRED']) {
    const blocked = { ...preview, eligible: false, blocker };
    assert.deepEqual(await (await setup({ result: { preview: blocked } }).run()).json(), { preview: blocked });
  }
  assert.equal((await setup({ result: { preview: null } }).run()).status, 404);
  assert.equal((await setup({ failures: ['42883'] }).run()).status, 503);
});

test('record uses actual RPC signature, checks receipt, and distinguishes conflict from same-request retry', async () => {
  const app = setup({ failures: ['08006'] });
  const uncertain = await app.run(post());
  assert.equal(uncertain.status, 503);
  assert.equal((await uncertain.json()).code, 'RETRY_SAME_REQUEST');
  const retry = await app.run(post());
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { receipt });
  assert.deepEqual(app.calls[0], app.calls[1]);
  assert.match(app.calls[0].statement, /r4_online_private\.cancel_online_order\(\?, \?::uuid, \?::uuid, \?::integer, \?, \?\)/);
  assert.deepEqual(app.calls[0].values, [digest, orderId, requestKey, 90000, 'external payment ref', true]);
  for (const [code, status] of [['55000', 409], ['22023', 409], ['42501', 403], ['55P03', 503], ['42883', 503]]) {
    const fail = await setup({ failures: [code] }).run(post());
    assert.equal(fail.status, status);
    assert.doesNotMatch(await fail.text(), /private details/);
  }
  assert.equal((await setup({ result: { receipt: { ...receipt, refundSatang: 1 } } }).run(post())).status, 503);
});
