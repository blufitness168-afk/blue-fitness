import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';

const { outputText } = ts.transpileModule(readFileSync(new URL('./StaffTransferSection.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
});
const url = '/api/admin/members/BLU-3/staff-transfer';
const requestKey = '472258a9-7d13-4319-9cae-d0b831d64c4f';
const saleId = '3bb079f9-34ce-4035-a69c-57f0b70cf28c';
const interval = { startsAt: '2026-11-21T09:00:00+00:00', endsAt: '2026-11-22T09:00:00+00:00' };
const offer = { ...interval, source: 'ONLINE_PAID', orderId: '3a60c926-479e-4359-9e90-c686263b83ab',
  packageName: 'Synthetic', packageId: 1, catalogVersion: 2, amountSatang: 9000, dailySlot: '07:00-14:00' };
const candidate = { ...interval, packageName: 'Synthetic', saleId, amountSatang: 9000, pointsToReverse: 4 };
const transferReceipt = { ...interval, source: 'STAFF_TRANSFER', saleId, amountSatang: 9000, pointsEarned: 4,
  dailySlot: offer.dailySlot, occurredAt: '2026-11-20T08:00:00Z', recordedAt: '2026-11-20T08:00:01Z' };
const cancellationReceipt = { source: 'STAFF_TRANSFER_REFUND', status: 'CANCELLED', saleId, refundSatang: 9000,
  pointsReversed: 4, cancelledAt: '2026-11-20T08:00:00Z' };

function harness(props, replies) {
  const exports = {}, calls = [], hooks = [];
  let index = 0, refreshed = 0, keys = 0;
  const node = (type, props) => ({ type, props });
  const imports = {
    'react/jsx-runtime': { jsx: node, jsxs: node },
    'next/navigation': { useRouter: () => ({ refresh: () => { refreshed++; } }) },
    react: {
      useState(initial) { const slot = index++; if (!(slot in hooks)) hooks[slot] = initial; return [hooks[slot], value => { hooks[slot] = value; }]; },
      useRef(initial) { return hooks[index++] ??= { current: initial }; },
    },
    zod,
  };
  vm.runInNewContext(outputText, {
    exports, require: name => imports[name], FormData: class { constructor(fields) { return fields; } },
    crypto: { randomUUID() { keys++; return requestKey; } },
    fetch: async (path, init) => {
      calls.push({ path, ...init });
      assert.ok(replies.length, 'Unexpected fetch');
      return replies.shift()();
    },
  });
  function render() { index = 0; return exports.default({ memberCode: 'BLU-3', ...props }); }
  function* walk(node) {
    if (Array.isArray(node)) { for (const child of node) yield* walk(child); }
    else if (node?.type) { yield node; yield* walk(node.props.children); }
  }
  const find = (type, match = () => true) => [...walk(render())].find(n => n.type === type && match(n.props))?.props;
  return {
    calls, find, refreshes: () => refreshed, keys: () => keys,
    preview: () => find('button').onClick(),
    select: () => find('button', p => p.children === 'เลือกเทอมนี้').onClick(),
    submit: fields => find('form').onSubmit({ preventDefault() {}, currentTarget: new Map(Object.entries(fields)) }),
    message: () => find('p', p => p.role === 'status').children,
  };
}

const json = (body, status = 200) => () => Response.json(body, { status });
const fields = { reason: '  matched transfer  ', confirmed: 'on', transferAt: '2026-11-20T15:00' };

test('transfer submits the untouched quote; only OWNER can add a Thai-local backdate', async () => {
  for (const canBackdate of [false, true]) {
    const h = harness({ mode: 'transfer', canBackdate }, [json({ offer }), json({ receipt: transferReceipt })]);
    assert.equal(h.find('form'), undefined);
    await h.preview();
    assert.equal(h.calls[0].path, url);
    assert.equal(h.calls[0].cache, 'no-store');
    assert.equal(Boolean(h.find('input', p => p.name === 'transferAt')), canBackdate);
    assert.equal(h.find('input', p => ['amount', 'reference', 'method'].includes(p.name)), undefined);
    await h.submit({ ...fields, reason: '  ' });
    await h.submit({ ...fields, confirmed: '' });
    assert.equal(h.calls.length, 1);
    await h.submit(fields);
    assert.deepEqual(JSON.parse(h.calls[1].body), { requestKey, offer, reason: 'matched transfer', confirmedTransfer: true,
      ...(canBackdate ? { transferAt: '2026-11-20T15:00:00+07:00' } : {}) });
    assert.equal(h.calls[1].method, 'POST');
    assert.equal(h.refreshes(), 1);
    assert.match(h.message(), /บันทึกต่ออายุแบบโอนแล้ว/);
  }
});

test('empty and malformed previews do not open a write form', async () => {
  const h = harness({ mode: 'transfer', canBackdate: true }, [json({ offer: null }), json({ offer: { ...offer, amountSatang: 0 } })]);
  await h.preview();
  assert.match(h.message(), /ไม่พบแพ็กเกจ/);
  await h.preview();
  assert.match(h.message(), /ยังไม่พร้อม/);
  assert.equal(h.find('form'), undefined);
});

test('double submit, network failure, malformed success and 503 preserve one exact request until a valid receipt', async () => {
  let failWrite;
  const h = harness({ mode: 'transfer', canBackdate: true }, [json({ offer }), () => new Promise((_, reject) => { failWrite = reject; }),
    json({ error: 'unavailable' }, 503), json({ receipt: { ...transferReceipt, amountSatang: 8900 } }), json({ receipt: transferReceipt })]);
  await h.preview();
  const first = h.submit(fields);
  await h.submit(fields);
  assert.equal(h.calls.length, 2);
  failWrite(new Error('network'));
  await first;
  for (let i = 0; i < 3; i++) {
    assert.equal(h.find('fieldset').disabled, true);
    assert.equal(h.find('button').disabled, true);
    assert.equal(h.refreshes(), 0);
    assert.match(h.message(), /ยังยืนยันผลไม่ได้/);
    await h.preview();
    await h.submit({ reason: 'Do not change the body' });
  }
  assert.equal(h.keys(), 1);
  assert.equal(h.calls.length, 5);
  for (const call of h.calls.slice(1)) assert.equal(call.body, h.calls[1].body);
  assert.equal(h.refreshes(), 1);
});

test('cancellation requires external-refund confirmation, retries by sale, and never treats a mismatched receipt as success', async () => {
  const h = harness({ mode: 'cancellation' }, [json({ candidates: [candidate] }),
    json({ receipt: { ...cancellationReceipt, saleId: offer.orderId } }), json({ receipt: cancellationReceipt })]);
  await h.preview();
  assert.equal(h.calls[0].path, `${url}/cancellation`);
  h.select();
  await h.submit({ reason: 'คืนแล้ว' });
  assert.equal(h.calls.length, 1);
  await h.submit({ reason: ' คืนแล้ว ', confirmed: 'on' });
  assert.deepEqual(JSON.parse(h.calls[1].body), { requestKey, saleId, reason: 'คืนแล้ว', confirmedFullExternalRefund: true });
  assert.equal(h.calls[1].path, `${url}/cancellation`);
  assert.match(h.message(), /ห้ามคืนเงินซ้ำ/);
  assert.equal(h.refreshes(), 0);
  await h.submit({});
  assert.equal(h.calls[1].body, h.calls[2].body);
  assert.equal(h.refreshes(), 1);
  assert.match(h.message(), /ยกเลิกเทอมแล้ว/);
});

test('cancellation conflict stops writes for owner review; a fresh transfer conflict requires a new quote', async () => {
  const cancel = harness({ mode: 'cancellation' }, [json({ candidates: [candidate] }), json({}, 409)]);
  await cancel.preview();
  cancel.select();
  await cancel.submit(fields);
  assert.match(cancel.message(), /ให้เจ้าของตรวจสอบรายการ ห้ามคืนเงินซ้ำ/);
  assert.equal(cancel.find('form'), undefined);
  assert.equal(cancel.find('button').disabled, true);
  await cancel.preview();
  assert.equal(cancel.calls.length, 2);
  assert.equal(cancel.refreshes(), 0);
  const transfer = harness({ mode: 'transfer' }, [json({ offer }), json({}, 409), json({ offer: null })]);
  await transfer.preview();
  await transfer.submit(fields);
  assert.match(transfer.message(), /ตรวจสิทธิ์ใหม่/);
  assert.equal(transfer.find('form'), undefined);
  assert.equal(transfer.refreshes(), 0);
  await transfer.preview();
  assert.equal(transfer.calls.length, 3);
});
