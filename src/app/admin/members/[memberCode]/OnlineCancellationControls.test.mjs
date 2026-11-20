import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';

const compile = (filename, globals) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(filename, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, ...globals });
  return exports;
};
const contract = compile('../../../../lib/online-cancellation-contract.ts', { require: () => zod });
const orderId = '3bb079f9-34ce-4035-a69c-57f0b70cf28c';
const memberCode = 'BLU-3';
const requestKey = '472258a9-7d13-4319-9cae-d0b831d64c4f';
const confirmedAt = '2026-11-25T08:00:00+00:00';
const preview = { orderId, memberCode, packageName: '30 days', amountSatang: 90000, pointsToReverse: 4, confirmedAt, eligible: true, blocker: null };
const receipt = { orderId, source: 'ONLINE_REFUND', status: 'CANCELLED', cancelledAt: confirmedAt, refundSatang: 90000, pointsReversed: 4 };
function harness(results) {
  let i = 0, refreshes = 0, keys = 0;
  const state = [], requests = [];
  const element = (type, props) => ({ type, props });
  const imports = {
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'fragment' },
    react: { useState(initial) { const index = i++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; },
      useRef(initial) { const index = i++; return state[index] ??= { current: initial }; } },
    'next/navigation': { useRouter: () => ({ refresh() { refreshes++; } }) },
    '@/lib/online-cancellation-contract': contract,
  };
  const component = compile('./OnlineCancellationControls.tsx', { require: name => imports[name],
    crypto: { randomUUID: () => { keys++; return requestKey; } }, fetch: async (url, init) => {
      requests.push({ url, init });
      const result = results.shift();
      if (result instanceof Error) throw result;
      return Response.json(result);
    } }).default;
  function all(node) {
    if (Array.isArray(node)) return node.flatMap(all);
    return node?.props ? [node, ...all(node.props.children)] : [];
  }
  return { requests, keys: () => keys, refreshes: () => refreshes,
    find(predicate) { i = 0; return all(component({ orderId, memberCode })).find(predicate); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('eligible OWNER UI requires explicit confirmation and retries the exact same payload after an uncertain result', async () => {
  const ui = harness([{ preview }, Error('transport'), { receipt }]);
  ui.find(node => node.type === 'button').props.onClick();
  await flush();
  const form = () => ui.find(node => node.type === 'form');
  form().props.onSubmit({ preventDefault() {} });
  assert.equal(ui.requests.length, 1);
  ui.find(node => node.type === 'textarea').props.onChange({ target: { value: 'external ref' } });
  ui.find(node => node.type === 'input').props.onChange({ target: { checked: true } });
  form().props.onSubmit({ preventDefault() {} });
  await flush();
  assert.equal(ui.refreshes(), 0);
  assert.ok(ui.find(node => node.props.role === 'alert'));
  assert.equal(form(), undefined);
  ui.find(node => node.type === 'button').props.onClick();
  await flush();
  assert.equal(ui.keys(), 1);
  assert.deepEqual(ui.requests[1], ui.requests[2]);
  assert.equal(JSON.parse(ui.requests[1].init.body).refundSatang, 90000);
  assert.equal(ui.refreshes(), 1);
});

test('blocked or mismatched previews never show the confirmation form', async () => {
  for (const result of [{ ...preview, eligible: false, blocker: 'READERS_NOT_ENABLED' }, { ...preview, memberCode: 'BLU-4' }]) {
    const ui = harness([{ preview: result }]);
    ui.find(node => node.type === 'button').props.onClick();
    await flush();
    assert.equal(ui.find(node => node.type === 'form'), undefined);
    assert.equal(ui.requests.length, 1);
  }
});
