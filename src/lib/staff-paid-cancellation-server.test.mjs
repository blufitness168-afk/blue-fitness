import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';

const code = ts.transpileModule(readFileSync(new URL('./staff-paid-cancellation-server.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const origin = 'https://test.invalid';
const url = origin + '/api/admin/members/BLU-3/staff-transfer/cancellation';
const token = 'a'.repeat(64);
const saleId = '3bb079f9-34ce-4035-a69c-57f0b70cf28c';
const requestKey = '472258a9-7d13-4319-9cae-d0b831d64c4f';
const body = { saleId, requestKey, reason: 'Refund already sent', confirmedFullExternalRefund: true };
const receipt = { saleId, source: 'STAFF_TRANSFER_REFUND', status: 'CANCELLED',
  cancelledAt: '2026-11-20T08:00:00+00:00', refundSatang: 9000, pointsReversed: 4 };

function post(payload = body, from = origin) {
  return new Request(url, { method: 'POST', body: JSON.stringify(payload), headers: { Origin: from, 'Content-Type': 'application/json' } });
}

function harness({ enabled = 'true', role = 'OWNER', row = { receipt, candidates: [] }, fail } = {}) {
  const calls = [], exports = {};
  const imports = {
    'server-only': {}, 'node:crypto': { createHash }, zod,
    'next/headers': { cookies: async () => ({ get: () => ({ value: token }) }) },
    './auth/server': { SESSION_COOKIE: 'test', getCurrentMember: async () => ({ role, status: 'ACTIVE' }) },
    './auth/http': { sameOrigin: req => !req.headers.get('origin') || req.headers.get('origin') === origin,
      json: (data, status = 200) => ({ data, status }) },
    './payment-server': { boundedBody: async req => Buffer.from(await req.text()) },
    '@neondatabase/serverless': { neon: () => async (parts, ...values) => {
      calls.push({ statement: parts.join('?'), values });
      if (fail) throw Object.assign(new Error('private detail'), { code: fail });
      return [row];
    } },
  };
  vm.runInNewContext(code, { exports, require: name => imports[name], URL,
    process: { env: { DATABASE_URL: 'offline', ENABLE_STAFF_PAID_CANCELLATION: enabled } } });
  return { calls, invoke: req => exports.staffPaidCancellationRequest(req, 'BLU-3') };
}

test('feature, role, origin and explicit full-refund confirmation gate the RPC', async () => {
  for (const [h, req, expected] of [
    [harness({ enabled: '' }), post(), 503], [harness({ role: 'ADMIN' }), post(), 403],
    [harness(), post(body, 'https://other.invalid'), 403],
    [harness(), post({ ...body, confirmedFullExternalRefund: false }), 400],
    [harness(), post({ ...body, reason: ' ' }), 400],
    [harness(), post({ ...body, amountSatang: 1 }), 400],
  ]) {
    assert.equal((await h.invoke(req)).status, expected);
    assert.equal(h.calls.length, 0);
  }
});

test('OWNER uses member-bound RPC without a refund reference; validates receipt and sanitizes errors', async () => {
  const h = harness();
  assert.equal((await h.invoke(new Request(url))).status, 200);
  assert.match(h.calls[0].statement, /list_paid_transfer_cancellations/);
  assert.equal((await h.invoke(post())).status, 200);
  assert.match(h.calls[1].statement, /cancel_member_paid_transfer/);
  assert.deepEqual(h.calls[1].values, [createHash('sha256').update(token).digest('hex'), 'BLU-3', requestKey, saleId, body.reason, true]);
  assert.equal((await harness({ row: { receipt: { ...receipt, saleId: requestKey } } }).invoke(post())).status, 503);
  const denied = await harness({ fail: '55000' }).invoke(post());
  assert.equal(denied.status, 409);
  assert.doesNotMatch(JSON.stringify(denied), /private detail/);
});
