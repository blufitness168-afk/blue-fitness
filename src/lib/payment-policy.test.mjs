import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const modules = new Map();
function load(name) {
  if (!name.startsWith('./')) return require(name);
  if (modules.has(name)) return modules.get(name);
  const exports = {}; modules.set(name, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(`${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: load, Buffer, Date, Error, Number });
  return exports;
}
const { satang, quotePackage, validateSlip, validImageSignature, paymentReadiness } = load('./payment-policy');
const receiver = { promptpay: '0973355322', bankCode: '004', bankAccount: '0528938965', name: 'นาย ณัฐนที รุ่งทองใบสุรีย์' };
const order = { id: 'offline-order', amount_satang: 2000, receiver_snapshot: receiver, created_at: '2026-10-10T11:20:00Z', expires_at: '2026-10-10T11:35:00Z' };
const now = Date.parse('2026-10-10T11:25:00Z');
// Offline reproduction of the user-reported v2 shape, not real settlement evidence.
function slip() { return { success: true, data: { remark: order.id, isDuplicate: false, amountInSlip: 20, amountInOrder: 20, isAmountMatched: true, matchedAccount: { bank: { code: '004' }, bankNumber: '052-8-93896-5', nameTh: 'ณัฐนที รุ่งทองใบสุรีย์' }, rawSlip: { countryCode: 'TH', transRef: 'KSA00000000983426085f1c4e', date: '2026-10-10T18:23:28+07:00', amount: { amount: 20, local: { currency: '' } }, receiver: { bank: { id: '004' }, account: { name: { en: 'MR NATNATEE R' }, bank: { type: 'BANKAC', account: 'XXXXX3896X' } } } } } }; }
test('integer satang rejects precision, exponent, negatives and nonnumeric values', () => {
  assert.equal(satang('900.01'), 90001);
  for (const x of [NaN, Infinity, -1, '1e2', '900.001', '', null, {}, '21474836.48']) assert.throws(() => satang(x));
});
test('server quote uses catalog and net amount, rejects invalid promos and zero totals', () => {
  assert.equal(quotePackage(2, ' blu100 ', now).amountSatang, 80000);
  assert.equal(quotePackage(2, 'BLU100', now).pointsEarned, 40);
  assert.equal(quotePackage(10, 'FITNESS10', now).discountSatang, 30000);
  for (const [id, code] of [[100, ''], [1, 'BLU100'], [2, 'EXPIRED'], [2, 'UNKNOWN']]) assert.throws(() => quotePackage(id, code, now));
  const data = load('./mock-data'), promo = data.mockPromoCodes.find(p => p.code === 'BLU100');
  const previous = promo.discountValue; promo.discountValue = 900;
  assert.throws(() => quotePackage(2, 'BLU100', now)); promo.discountValue = previous;
  const pkg = data.mockPackages.find(p => p.id === 2); pkg.isActive = false;
  assert.throws(() => quotePackage(2, '', now)); pkg.isActive = true;
});
test('v2 registered full identity accepts matching mask and truncated raw English name', () => {
  const proof = validateSlip(slip(), order, now);
  assert.equal(proof.receiverEvidence, 'REGISTERED_ACCOUNT_V2');
  assert.equal(proof.providerStrategy, 'EASYSLIP_V2_REGISTERED_ACCOUNT');
  assert.equal(proof.receiverIdentity.bankAccount, receiver.bankAccount);
  assert.equal(proof.receiverIdentity.name, 'ณัฐนที รุ่งทองใบสุรีย์');
    assert.equal(proof.receiverIdentity.expectedName, receiver.name);
  assert.equal(proof.orderId, order.id);
  const s = slip(); s.data.isDuplicate = true;
  assert.ok(validateSlip(s, order, now)); // DB uniqueness decides replay, not this flag.
});
test('null registered match, altered full identity/name/bank and contradictory mask reject', () => {
  for (const change of [
    s => s.data.matchedAccount = null,
    s => s.data.matchedAccount.bankNumber = 'xxx6134',
    s => s.data.matchedAccount.bankNumber = '0528938966',
    s => s.data.matchedAccount.nameTh = 'ชื่อคนอื่น',
    s => s.data.matchedAccount.bank.code = '014',
    s => s.data.rawSlip.receiver.bank.id = '014',
    s => s.data.rawSlip.receiver.account.bank.account = 'XXXXX6134X',
    s => s.data.rawSlip.receiver.account.bank.account = '3896',
    s => s.data.rawSlip.receiver.account.bank.type = 'TOKEN',
  ]) { const s = slip(); change(s); assert.throws(() => validateSlip(s, order, now)); }
  assert.throws(() => validateSlip(slip(), { ...order, receiver_snapshot: { ...receiver, name: 'เปลี่ยนชื่อผู้รับ' } }, now));
});
test('v2 success, transRef, all exact amount fields and domestic currency required', () => {
  for (const change of [
    s => s.success = false, s => delete s.data.rawSlip.transRef,
        
        s => { s.data.rawSlip.amount.local = { currency: 'THB', amount: 19 }; },
    s => s.data.rawSlip.transRef = 'x\n', s => s.data.rawSlip.countryCode = 'US',
    s => s.data.rawSlip.amount.local.currency = 'USD', s => s.data.rawSlip.amount.currency = 'USD',
    s => s.data.currency = 'USD', s => s.data.rawSlip.amount.amount = 19.99,
    s => s.data.amountInSlip = 20.001, s => s.data.amountInOrder = 21,
    s => s.data.isAmountMatched = false,
  ]) { const s = slip(); change(s); assert.throws(() => validateSlip(s, order, now)); }
});
test('old transfer, late transfer, future and invalid timestamps reject across orders', () => {
  for (const date of ['2026-10-10T11:18:59Z', '2026-10-10T11:35:01Z', '2026-10-10T11:26:01Z', '2026-10-10 18:23:28', '2026-02-30T03:05:00Z']) {
    const s = slip(); s.data.rawSlip.date = date; assert.throws(() => validateSlip(s, order, now));
  }
  assert.throws(() => validateSlip(slip(), { ...order, id: 'new-order', created_at: '2026-10-10T11:30:00Z' }, now));
});
test('readiness requires explicit v2 strategy and enable flag, never legacy contract', () => {
  for (const env of [{}, { PAYMENT_TRANSFERS_ENABLED: 'true' }, { PAYMENT_TRANSFERS_ENABLED: 'true', PAYMENT_RECEIVER_CONTRACT: 'FULL_V1_CONFIRMED' }, { PAYMENT_PROVIDER_STRATEGY: 'EASYSLIP_V2_REGISTERED_ACCOUNT' }]) assert.equal(paymentReadiness(env).transfersEnabled, false);
  assert.equal(paymentReadiness({ PAYMENT_TRANSFERS_ENABLED: 'true', PAYMENT_PROVIDER_STRATEGY: 'EASYSLIP_V2_REGISTERED_ACCOUNT' }).transfersEnabled, true);
});
test('image signature and MIME must agree', () => {
  assert.ok(validImageSignature('image/png', Buffer.from([137,80,78,71,13,10,26,10])));
  assert.ok(validImageSignature('image/jpeg', Buffer.from([255,216,255])));
  assert.ok(validImageSignature('image/gif', Buffer.from('GIF89a')));
  assert.ok(validImageSignature('image/webp', Buffer.from('RIFF1234WEBP')));
  assert.equal(validImageSignature('image/svg+xml', Buffer.from('<svg>')), false);
  assert.equal(validImageSignature('image/png', Buffer.from([255,216,255])), false);
});
test('migration binds full registered identity, strategy, order and global references', () => {
  const sql = fs.readFileSync(new URL('../db/migrations/20261009_real_package_payments.sql', import.meta.url), 'utf8');
  for (const text of ['REGISTERED_ACCOUNT_V2', 'EASYSLIP_V2_REGISTERED_ACCOUNT', "a.evidence->>'orderId' IS DISTINCT FROM o.id::text", "receiverIdentity'->>'bankAccount' IS DISTINCT FROM", "receiverIdentity'->>'expectedName' IS DISTINCT FROM", 'Verified evidence is immutable', 'Payment order snapshot is immutable', 'ON CONFLICT(trans_ref) DO NOTHING', 'DUPLICATE_TRANS_REF', 'MEMBER_SUSPENDED', "interval '2 minutes'", 'provider_calls<2', "m.role='OWNER'"]) assert.ok(sql.includes(text), text);
});
