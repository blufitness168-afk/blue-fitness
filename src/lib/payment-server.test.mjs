import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const code = name => ts.transpileModule(fs.readFileSync(new URL(`./${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const orderId = '3c1f10a6-55de-4ad1-b8bc-37bded452778';
const receiver = { promptpay: '0973355322', bankCode: '004', bankAccount: '0528938965', name: 'ชื่อผู้รับทดสอบ' };
function setup({ authenticated = true, masked = false, timeout = false, failFinalize = false, status = 200, transfersEnabled = true, role = 'MEMBER', terminalReason = null, currency = '' } = {}) {
  const modules = new Map(), calls = [], queries = [];
  const state = { order: { id: orderId, member_id: 1, package_snapshot: { id: 2, name: 'BLU 30 วัน', durationDays: 30 }, receiver_snapshot: receiver, amount_satang: 90000, subtotal_satang: 90000, discount_satang: 0, created_at: new Date(Date.now() - 300000).toISOString(), expires_at: new Date(Date.now() + 600000).toISOString(), upload_deadline: new Date(Date.now() + 2400000).toISOString(), status: 'PENDING', points_earned: 45 }, attempt: null, benefits: 0, failFinalize };
  const sql = async (parts, ...values) => {
    const text = parts.join('?'); queries.push({ text, values });
    if (text.includes('create_package_payment_order')) return [state.order];
    if (text.includes('prepare_owner_payment_currency_recheck') || text.includes('prepare_owner_payment_recheck')) { state.recheckPrepared = true; return [{ id: 'offline-attempt' }]; }
    if (text.includes('FROM package_payment_resolution_audit')) return state.recheckPrepared ? [{ id: 'offline-audit' }] : [];
    if (text.includes('reject_unresolved_package_payment')) { state.order.status = 'REJECTED'; state.order.rejection_reason = 'OWNER_RECONCILED_REJECTION'; state.audit = (state.audit ?? 0) + 1; return [state.order]; }
    if (text.includes('claim_package_payment_attempt')) {
      if (state.attempt) return [state.attempt];
      if (Date.parse(state.order.upload_deadline) <= Date.now()) throw Error('Upload deadline elapsed');
      state.attempt = { id: values[3], lease_token: values[3], state: 'PROCESSING', provider_calls: 1 };
      return [state.attempt];
    }
    if (text.includes("SET state = 'UNKNOWN'")) { state.attempt.state = 'UNKNOWN'; return []; }
    if (text.includes("SET state = 'REJECTED'")) { state.attempt.state = 'REJECTED'; return []; }
    if (text.includes("SET state = 'VERIFIED'")) { state.attempt.state = 'VERIFIED'; state.attempt.evidence = JSON.parse(values[0]); return [{ id: state.attempt.id }]; }
    if (text.includes('finalize_package_payment')) {
      if (state.failFinalize) { state.failFinalize = false; throw Error('DB connection lost'); }
      if (terminalReason) { state.attempt.state = 'REJECTED'; state.order.status = 'REJECTED'; state.order.rejection_reason = terminalReason; return [state.order]; }
      if (state.order.status !== 'PAID') { state.benefits++; state.order.status = 'PAID'; state.order.paid_at = state.attempt.evidence.paidAt; state.order.membership_expires_at = new Date(Date.now() + 30 * 86400000).toISOString(); }
      return [state.order];
    }
    if (text.includes('FROM package_payment_orders')) return [state.order];
    if (text.includes('FROM package_payment_attempts')) return state.attempt ? [state.attempt] : [];
    throw Error('Unexpected SQL');
  };
  const globals = { Buffer, Request, Response, File, FormData, URL, AbortSignal, Date, setTimeout, clearTimeout, Uint8Array, process: { env: { DATABASE_URL: 'offline', EASYSLIP_API_KEY: 'offline-secret', PAYMENT_PROMPTPAY_MOBILE: receiver.promptpay, PAYMENT_RECEIVER_BANK_CODE: '004', PAYMENT_RECEIVER_BANK_ACCOUNT: receiver.bankAccount, PAYMENT_RECEIVER_NAME: receiver.name, PAYMENT_TRANSFERS_ENABLED: transfersEnabled ? 'true' : 'false', PAYMENT_PROVIDER_STRATEGY: 'EASYSLIP_V2_REGISTERED_ACCOUNT', EASYSLIP_PAYMENT_V2_API_KEY: 'offline-payment-v2-secret' } } };
  function load(name) {
    if (name === 'server-only') return {};
    if (name === '@neondatabase/serverless') return { neon: () => sql };
    if (name === 'next/headers') return { cookies: async () => ({ get: () => ({ value: 'a'.repeat(64) }) }) };
    if (name === './auth/server') return { SESSION_COOKIE: 'blu_session', getCurrentMember: async () => authenticated ? { id: 1, memberCode: 'BLU-1', status: 'ACTIVE', points: 0, role } : null };
    if (name === './auth/http') return { json: (body, status = 200) => Response.json(body, { status }), sameOrigin: request => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin };
    if (!name.startsWith('./')) return require(name);
    if (!modules.has(name)) {
      const exports = {}; modules.set(name, exports);
      vm.runInNewContext(code(name.slice(2)), { ...globals, exports, require: load, fetch: async (url, init) => {
        calls.push({ url, init });
        if (timeout) throw Error('timeout');
        return Response.json({ success: true, data: { remark: state.providerRemark ?? orderId, isDuplicate: false, amountInOrder: 900, amountInSlip: 900, isAmountMatched: true, matchedAccount: masked ? null : { bank: { code: '004' }, bankNumber: receiver.bankAccount, nameTh: receiver.name }, rawSlip: { transRef: 'OFFLINE-REF', date: state.providerPaidAt ?? new Date().toISOString(), countryCode: 'TH', amount: { amount: 900, local: { amount: 900, currency } }, receiver: { bank: { id: '004' }, account: { bank: { type: 'BANKAC', account: 'XXXXX3896X' }, name: { en: 'MR NATNATEE R' } } } } } }, { status });
      } });
    }
    return modules.get(name);
  }
  return { ...load('./payment-server'), calls, queries, state, load, env: globals.process.env };
}
function upload({ spoof = false, reconcile = false, extra = false } = {}) {
  const form = new FormData();
  form.append('file', new File([spoof ? 'not a png' : Buffer.from([137,80,78,71,13,10,26,10,1,2,3])], 'user-private-filename.png', { type: 'image/png' }));
  if (reconcile) form.append('reconcile', 'true');
  if (extra) form.append('amount', '1');
  return new Request('https://local/api/payments/verify', { method: 'POST', body: form });
}
test('unauthenticated and cross-origin requests never consume quota', async () => {
  const app = setup({ authenticated: false }); assert.equal((await app.verifyOrder(upload(), orderId)).status, 401); assert.equal(app.calls.length, 0);
  const other = setup(); const req = upload(); req.headers.set('origin', 'https://evil'); assert.equal((await other.verifyOrder(req, orderId)).status, 403); assert.equal(other.calls.length, 0);
});
test('client price, unknown fields, invalid UUID and forged signature are rejected', async () => {
  const app = setup();
  const req = new Request('https://local/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageId: 2, requestKey: randomUUID(), amount: 1 }) });
  assert.equal((await app.createOrder(req)).status, 400);
  assert.equal((await app.verifyOrder(upload(), 'invalid')).status, 404);
  assert.equal((await app.verifyOrder(upload({ spoof: true }), orderId)).status, 400);
  assert.equal((await app.verifyOrder(upload({ extra: true }), orderId)).status, 400);
  assert.equal(app.calls.length, 0);
});
test('order creation sends server base quote and normalized promo; response uses DB discount and points', async () => {
  const app = setup();
  // Model the DB-resolved result, deliberately different from the input base quote.
  Object.assign(app.state.order, { amount_satang: 80000, discount_satang: 10000, points_earned: 40 });
  const requestKey = randomUUID();
  const req = new Request('https://local/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageId: 2, promoCode: ' blu100 ', requestKey }) });
  const response = await app.createOrder(req);
  assert.equal(response.status, 201);
  const query = app.queries.find(q => q.text.includes('create_package_payment_order'));
  const quote = JSON.parse(query.values[4]);
  assert.equal(quote.package.id, 2);
  assert.equal(quote.subtotalSatang, 90000);
  assert.equal(quote.amountSatang, 90000);
  assert.equal(quote.discountSatang, 0);
  assert.equal(quote.pointsEarned, 45);
  assert.deepEqual(quote.promo, { code: 'BLU100' });
  assert.equal(query.values[1], 1);
  assert.match(query.values[2], /^[a-f0-9]{64}$/);
  assert.notEqual(query.values[2], 'a'.repeat(64));
  assert.equal(query.values[3], requestKey);
  assert.deepEqual(JSON.parse(query.values[5]), receiver);
  const { order } = await response.json();
  assert.equal(order.amountSatang, 80000);
  assert.equal(order.subtotalSatang, 90000);
  assert.equal(order.discountSatang, 10000);
  assert.equal(order.pointsEarned, 40);
  assert.equal(order.status, 'PENDING');
  assert.equal(order.qrPayload, app.load('./promptpay').generatePromptPayPayload(receiver.promptpay, 800));
  assert.equal(app.calls.length, 0);
  assert.equal(app.state.benefits, 0);
});
test('exact v2 image FormData + timeout, no private filename/raw data exposed; replay does not credit twice', async () => {
  const app = setup(); const result = await (await app.verifyOrder(upload(), orderId)).json();
  assert.equal(result.order.status, 'PAID'); assert.equal(app.state.benefits, 1);
  assert.equal(app.calls[0].url, 'https://api.easyslip.com/v2/verify/bank');
  assert.equal(app.calls[0].init.body.get('image').name, 'slip.png');
  assert.equal(app.calls[0].init.body.get('file'), null);
  assert.equal(app.calls[0].init.body.get('checkDuplicate'), 'true');
  assert.equal(app.calls[0].init.body.get('matchAccount'), 'true');
  assert.equal(app.calls[0].init.body.get('matchAmount'), '900.00');
  assert.equal(app.calls[0].init.body.get('remark'), orderId);
  assert.equal(app.calls[0].init.headers.Authorization, 'Bearer offline-payment-v2-secret');
  assert.ok(app.calls[0].init.signal); assert.equal(app.calls[0].init.redirect, 'error');
  assert.equal((await app.verifyOrder(upload(), orderId)).status, 200);
  assert.equal(app.calls.length, 1); assert.equal(app.state.benefits, 1);
  assert.doesNotMatch(JSON.stringify(result), /offline-secret|user-private-filename|sender|payload/);
});
test('provider ISO 4217 THB currency code 764 reaches settlement and replay without extra provider calls', async () => {
  for (const currency of ['764', 764]) {
    const app = setup({ currency });
    const response = await app.verifyOrder(upload(), orderId);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).order.status, 'PAID');
    assert.equal(app.state.benefits, 1);
    assert.equal((await app.verifyOrder(upload(), orderId)).status, 200);
    assert.equal(app.calls.length, 1);
    assert.equal(app.state.benefits, 1);
  }
});
test('masked receiver without registered account match never credits member', async () => {
  const app = setup({ masked: true }); assert.equal((await app.verifyOrder(upload(), orderId)).status, 422);
  assert.equal(app.state.benefits, 0); assert.equal(app.state.attempt.state, 'REJECTED');
  assert.equal((await app.verifyOrder(upload(), orderId)).status, 422); assert.equal(app.calls.length, 1);
});
test('cached remark is not order binding; server evidence binds owned request', async () => {
  const app = setup(); app.state.providerRemark = 'another-order';
  assert.equal((await app.verifyOrder(upload(), orderId)).status, 200);
  assert.equal(app.state.attempt.evidence.orderId, orderId);
  assert.equal(app.state.benefits, 1);
});
test('payment v2 requires its dedicated key, never falls back to diagnostics or v1', async () => {
  const app = setup(); app.env.EASYSLIP_PAYMENT_V2_API_KEY = '';
  app.env.EASYSLIP_V2_API_KEY = 'diagnostic-secret';
  assert.equal((await app.verifyOrder(upload(), orderId)).status, 503);
  assert.equal(app.calls.length, 0); assert.equal(app.state.attempt, null);
});
test('currency recovery is explicit owner-only, rejects forged reasons and prepares no credit/provider call', async () => {
  const request = body => new Request('https://local/api/admin/payments/recheck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const role of ['MEMBER', 'ADMIN']) {
    const app = setup({ role });
    assert.equal((await app.prepareOwnerRecheck(request({ confirmed: true, reason: 'THB_NUMERIC_CURRENCY_FIX' }), orderId)).status, 403);
    assert.equal(app.queries.length, 0);
  }
  const app = setup({ role: 'OWNER' });
  for (const body of [{ confirmed: false, reason: 'THB_NUMERIC_CURRENCY_FIX' }, { confirmed: true, reason: 'MANUAL_PAID' }, { confirmed: true, reason: 'THB_NUMERIC_CURRENCY_FIX', paid: true }])
    assert.equal((await app.prepareOwnerRecheck(request(body), orderId)).status, 400);
  assert.equal((await app.prepareOwnerRecheck(request({ confirmed: true, reason: 'THB_NUMERIC_CURRENCY_FIX' }), orderId)).status, 200);
  assert.equal(app.queries.filter(q => q.text.includes('prepare_owner_payment_currency_recheck')).length, 1);
  assert.equal(app.calls.length, 0);
  assert.equal(app.state.benefits, 0);
  assert.equal(app.state.order.status, 'PENDING');
});
test('owner recovery is advertised on initial payment account load without extra user refresh', async () => {
  const app = setup({ role: 'OWNER' });
  app.state.attempt = { state: 'REJECTED', rejection_reason: 'PROVIDER_VALIDATION_FAILED', provider_calls: 1 };
  assert.equal((await app.paymentAccount()).ownerRecheckAvailable, true);
  app.state.recheckPrepared = true;
  app.state.attempt.state = 'UNKNOWN';
  const prepared = await app.paymentAccount();
  assert.equal(prepared.ownerRecheckAvailable, false);
  assert.equal(prepared.ownerRecheckPrepared, true);
  assert.equal(app.calls.length, 0);
});
test('provider timeout or error remains pending; repeated requests do not consume quota', async () => {
  for (const options of [{ timeout: true }, { status: 500 }]) {
    const app = setup(options); assert.equal((await app.verifyOrder(upload(), orderId)).status, 202);
    assert.equal(app.state.attempt.state, 'UNKNOWN'); assert.equal(app.state.benefits, 0);
    assert.equal((await app.verifyOrder(upload(), orderId)).status, 202); assert.equal(app.calls.length, 1);
  }
});
test('DB failure after verification can reconcile cached evidence without another provider call', async () => {
  const app = setup({ failFinalize: true }); assert.equal((await app.verifyOrder(upload(), orderId)).status, 409);
  assert.equal(app.state.attempt.state, 'VERIFIED'); assert.equal(app.state.benefits, 0);
  assert.equal((await app.verifyOrder(upload(), orderId)).status, 200);
  assert.equal(app.calls.length, 1); assert.equal(app.state.benefits, 1);
});
test('cached VERIFIED evidence can finish with transfers disabled without paid provider calls', async () => {
  const app = setup({ failFinalize: true });
  assert.equal((await app.verifyOrder(upload(), orderId)).status, 409);
  app.env.PAYMENT_TRANSFERS_ENABLED = 'false'; app.env.EASYSLIP_PAYMENT_V2_API_KEY = '';
  assert.equal((await app.verifyOrder(upload(), orderId)).status, 200);
  assert.equal(app.calls.length, 1); assert.equal(app.state.benefits, 1);
});
test('owner-only operations reject staff, unapproved evidence and manual PAID', async () => {
  for (const role of ['MEMBER', 'ADMIN']) {
    const app = setup({ role }); const ops = app.load('./payment-operations');
    assert.equal((await ops.unresolvedPayments()).status, 403);
    const req = new Request('https://local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await ops.rejectUnresolvedPayment(req, orderId)).status, 403);
    assert.equal(app.calls.length, 0); assert.equal(app.queries.length, 0);
  }
  const app = setup({ role: 'OWNER' }); const ops = app.load('./payment-operations');
  for (const body of [{ status: 'PAID' }, { reason: 'reason long enough', evidence: { approved: false } }]) {
    const req = new Request('https://local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await ops.rejectUnresolvedPayment(req, orderId)).status, 400);
  }
  const evidence = { source: 'BANK', outcome: 'NO_TRANSFER_CONFIRMED', caseReference: 'OFFLINE-CASE-1', summary: 'Bank confirmed no matching transfer', approved: true };
  const req = new Request('https://local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Reviewed bank reconciliation report', evidence }) });
  assert.equal((await ops.rejectUnresolvedPayment(req, orderId)).status, 200);
  assert.equal(app.state.order.status, 'REJECTED'); assert.equal(app.state.audit, 1); assert.equal(app.state.benefits, 0); assert.equal(app.calls.length, 0);
});
test('owner diagnostics require explicit read-only confirmation before network requests', async () => {
  const app = setup({ role: 'OWNER' }); const ops = app.load('./payment-operations');
  const req = new Request('https://local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await ops.providerDiagnostics(req)).status, 400); assert.equal(app.calls.length, 0);
});
test('simultaneous uploads use one provider claim', async () => {
  const app = setup(); const responses = await Promise.all([app.verifyOrder(upload(), orderId), app.verifyOrder(upload(), orderId)]);
  assert.ok(responses.some(r => r.status === 200)); assert.equal(app.calls.length, 1); assert.equal(app.state.benefits, 1);
});
test('upload grace accepts first image after transfer expiry but rejects late transfers and closed uploads', async () => {
  const app = setup();
  app.state.order.created_at = new Date(Date.now() - 20 * 60000).toISOString();
  app.state.order.expires_at = new Date(Date.now() - 5 * 60000).toISOString();
  app.state.order.upload_deadline = new Date(Date.now() + 25 * 60000).toISOString();
  app.state.providerPaidAt = new Date(Date.now() - 6 * 60000).toISOString();
  const response = await app.verifyOrder(upload(), orderId);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).order.uploadDeadline, app.state.order.upload_deadline);
  const late = setup(); Object.assign(late.state.order, app.state.order, { status: 'PENDING' });
  assert.equal((await late.verifyOrder(upload(), orderId)).status, 422); assert.equal(late.state.benefits, 0);
  const closed = setup(); closed.state.order.upload_deadline = new Date(Date.now() - 1000).toISOString();
  assert.equal((await closed.verifyOrder(upload(), orderId)).status, 409); assert.equal(closed.calls.length, 0);
});
test('receiver blocker disables creating orders, QR and new provider calls by default', async () => {
  const app = setup({ transfersEnabled: false });
  const req = new Request('https://local/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageId: 2, requestKey: randomUUID() }) });
  assert.equal((await app.createOrder(req)).status, 503);
  assert.equal(app.publicOrder(app.state.order).qrPayload, null);
  assert.equal((await app.verifyOrder(upload(), orderId)).status, 503);
  assert.equal(app.calls.length, 0); assert.equal(app.state.attempt, null);
});
test('definitive duplicate or suspension is terminal, never reported as successful payment', async () => {
  for (const terminalReason of ['DUPLICATE_TRANS_REF', 'MEMBER_SUSPENDED']) {
    const app = setup({ terminalReason }); const result = await app.verifyOrder(upload(), orderId);
    assert.equal(result.status, 422); assert.equal((await result.json()).order.status, 'REJECTED');
    assert.equal(app.state.benefits, 0); assert.equal(app.state.attempt.state, 'REJECTED');
    assert.equal((await app.verifyOrder(upload(), orderId)).status, 422); assert.equal(app.calls.length, 1);
  }
});
test('bounded body rejects actual chunked size without trusting Content-Length', async () => {
  const app = setup();
  const request = new Request('https://local', { method: 'POST', body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(64)); c.enqueue(new Uint8Array(64)); c.close(); } }), duplex: 'half' });
  await assert.rejects(app.boundedBody(request, 100));
});
