import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';

const source = ts.transpileModule(readFileSync(new URL('./staff-paid-transfer-server.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const rolloutSource = ts.transpileModule(readFileSync(new URL('./staff-paid-rollout-server.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const origin = 'https://test.invalid';
const url = origin + '/api/admin/members/BLU-3/staff-transfer';
const token = 'a'.repeat(64);
const interval = { startsAt: '2026-11-21T09:00:00+00:00', endsAt: '2026-11-22T09:00:00+00:00', dailySlot: '07:00-14:00' };
const offer = { ...interval, source: 'ONLINE_PAID', orderId: '3a60c926-479e-4359-9e90-c686263b83ab', packageName: 'Synthetic', packageId: 1, catalogVersion: 2, amountSatang: 9000 };
const receipt = { ...interval, source: 'STAFF_TRANSFER', saleId: '3bb079f9-34ce-4035-a69c-57f0b70cf28c', amountSatang: 9000,
  pointsEarned: 4, occurredAt: '2026-11-20T08:00:00+00:00', recordedAt: '2026-11-20T08:00:01+00:00' };
const body = { requestKey: '472258a9-7d13-4319-9cae-d0b831d64c4f', confirmedTransfer: true, offer, reason: 'Transfer confirmed' };
function post(payload, from = origin) {
  return new Request(url, { method: 'POST', body: JSON.stringify(payload), headers: { Origin: from, 'Content-Type': 'application/json' } });
}
function harness({ flag = 'true', reads = 'true', role = 'ADMIN', row = { offer, receipt }, fail } = {}) {
  const calls = [], exports = {}, rollout = {};
  const process = { env: { ENABLE_STAFF_PAID_TRANSFER: flag, ENABLE_STAFF_PAID_READS: reads, DATABASE_URL: 'offline' } };
  if (reads === null) delete process.env.ENABLE_STAFF_PAID_READS;
  vm.runInNewContext(rolloutSource, { exports: rollout, require: () => ({}), process });
  const imports = {
    'server-only': {}, zod, 'node:crypto': { createHash }, './staff-paid-rollout-server': rollout,
    'next/headers': { cookies: async () => ({ get: () => ({ value: token }) }) },
    './auth/server': { SESSION_COOKIE: 'test', getCurrentMember: async () => ({ role, status: 'ACTIVE' }) },
    './auth/http': { sameOrigin: req => !req.headers.get('origin') || req.headers.get('origin') === origin, json: (data, status = 200) => ({ data, status }) },
    './package-catalog': { packageCatalogDailySlot: s => s === interval.dailySlot ? s : null },
    './payment-server': { boundedBody: async req => Buffer.from(await req.text()) },
    '@neondatabase/serverless': { neon: () => async (parts, ...values) => {
      calls.push({ sql: parts.join('?'), values });
      if (fail) throw Object.assign(new Error('private evidence'), { code: fail });
      return [row];
    } },
  };
  vm.runInNewContext(source, { exports, require: name => imports[name], URL, process });
  return { call: request => exports.staffPaidTransferRequest(request, 'BLU-3'), calls };
}

test('default-off, role and origin gates do not call SQL', async () => {
  for (const [h, req, status] of [[harness({ flag: '' }), post(body), 503], [harness({ role: 'MEMBER' }), post(body), 403], [harness(), post(body, 'https://other.invalid'), 403]]) {
    assert.equal((await h.call(req)).status, status);
    assert.equal(h.calls.length, 0);
  }
});
test('transfer flag alone cannot reach preview or writer SQL until paid reads are enabled', async () => {
  for (const reads of [null, 'false', 'TRUE', '1']) {
    const h = harness({ reads, role: 'OWNER' });
    assert.equal((await h.call(new Request(url))).status, 503);
    assert.equal((await h.call(post(body))).status, 503);
    assert.equal(h.calls.length, 0);
  }
});
test('strict transfer confirmation and OWNER-only backdate; no slip, cash or custom reference accepted', async () => {
  const h = harness();
  for (const payload of [{ ...body, confirmedTransfer: false }, { ...body, method: 'CASH' }, { ...body, slip: 'fake' }, { ...body, reference: 'unused' }]) {
    assert.equal((await h.call(post(payload))).status, 400);
  }
  assert.equal((await h.call(post({ ...body, transferAt: receipt.occurredAt }))).status, 403);
  assert.equal(h.calls.length, 0);
});
test('quote and receipt use narrow authenticated RPCs and fail closed on malformed DB responses', async () => {
  const h = harness({ role: 'OWNER' });
  assert.equal((await h.call(new Request(url))).status, 200);
  assert.equal((await h.call(post({ ...body, transferAt: receipt.occurredAt }))).status, 200);
  assert.match(h.calls[0].sql, /preview_paid_transfer/);
  assert.match(h.calls[1].sql, /record_paid_transfer/);
  const [digest, key, member, quote, reason, confirmed, occurred] = h.calls[1].values;
  assert.deepEqual([digest, key, member, JSON.parse(quote), reason, confirmed, occurred],
    [createHash('sha256').update(token).digest('hex'), body.requestKey, 'BLU-3', offer, body.reason, true, receipt.occurredAt]);
  assert.equal((await harness({ row: { receipt: { ...receipt, source: 'PAID' } } }).call(post(body))).status, 503);
  const denied = await harness({ fail: '42501' }).call(post(body));
  assert.equal(denied.status, 403);
  assert.doesNotMatch(JSON.stringify(denied), /private evidence/);
});
