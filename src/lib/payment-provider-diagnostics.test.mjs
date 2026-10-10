import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const source = ts.transpileModule(fs.readFileSync(new URL('./payment-provider-diagnostics.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(responses, key = 'OFFLINE-SECRET') {
  const calls = [], exports = {};
  vm.runInNewContext(source, { exports, Buffer, AbortSignal, process: { env: { EASYSLIP_V2_API_KEY: key, PAYMENT_RECEIVER_BANK_CODE: '004', PAYMENT_RECEIVER_BANK_ACCOUNT: '0528938965' } }, require: name => name === 'server-only' ? {} : name === './payment-server' ? { boundedBody: async response => { const b = Buffer.from(await response.text()); if (b.length > 65536) throw Error('large'); return b; } } : require(name), fetch: async (url, init) => { calls.push({ url, init }); const r = responses.shift(); if (!r) throw Error('Unexpected fetch'); return Response.json(r.body, { status: r.status ?? 200 }); } });
  return { ...exports, calls };
}
const info = { success: true, data: { branch: { name: 'PRIVATE-BRANCH', isActive: true }, account: { email: 'PRIVATE-EMAIL', credit: 123 } } };
const accounts = { success: true, data: { page: 1, total: 1, items: [{ bankCode: '004', bankNumber: '052-8-93896-5', nameTh: 'PRIVATE-RECEIVER', id: 123 }] } };
test('v2 diagnostics use only bounded read-only GETs, return linkage without approving payments or leaking PII', async () => {
  const app = setup([{ body: info }, { body: accounts }]); const result = await app.readV2Diagnostics();
  assert.equal(result.keyAccepted, true); assert.equal(result.branchActive, true); assert.equal(result.receiverLinkedToBranch, true);
  assert.equal(result.automaticV2, false); assert.equal(result.strongReceiverContractConfirmed, false);
  assert.equal(app.calls.length, 2);
  for (const call of app.calls) { assert.equal(call.init.method, 'GET'); assert.ok(call.init.signal); assert.equal(call.init.redirect, 'error'); assert.doesNotMatch(call.url, /verify/); }
  assert.equal(app.calls[0].url, 'https://api.easyslip.com/v2/info');
  assert.match(app.calls[1].url, /v2\/bank-accounts\?bankCode=004&page=1&limit=100/);
  assert.doesNotMatch(JSON.stringify(result), /OFFLINE-SECRET|PRIVATE-BRANCH|PRIVATE-EMAIL|PRIVATE-RECEIVER|0528938965/);
});
test('missing key, rejected key, malformed success and provider timeout never enable transfers', async () => {
  const none = setup([], ''); assert.equal((await none.readV2Diagnostics()).keyConfigured, false); assert.equal(none.calls.length, 0);
  for (const responses of [[{ status: 401, body: { success: false } }], [{ body: { status: 200 } }], []]) {
    const app = setup(responses); const result = await app.readV2Diagnostics();
    assert.equal(result.automaticV2, false); assert.equal(result.receiverLinkedToBranch, null); assert.equal(app.calls.length, 1);
  }
});
test('masked branch accounts and incomplete pagination never constitute exact linkage or a strong contract', async () => {
  const masked = structuredClone(accounts); masked.data.items[0].bankNumber = '052xxx8965';
  let app = setup([{ body: info }, { body: masked }]); assert.equal((await app.readV2Diagnostics()).receiverLinkedToBranch, false);
  masked.data.total = 101;
  app = setup([{ body: info }, { body: masked }]); assert.equal((await app.readV2Diagnostics()).receiverLinkedToBranch, null);
});
