import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, globals = {}) {
  const exports = {};
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  vm.runInNewContext(outputText, { exports, ...globals });
  return exports;
}

const node = (type, props) => ({ type, props });
const jsx = { jsx: node, jsxs: node, Fragment: Symbol('Fragment') };
function browser() {
  const entries = new Map(), window = { location: { hash: '' }, sessionStorage: {
    getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key),
  } };
  let now = 100_000;
  const handoff = load('./coupon-recipient-handoff.ts', { window, Date: { now: () => now } });
  return { entries, window, handoff, advance: ms => { now += ms; } };
}

test('detail link keeps the recipient out of the URL; transfer is one-shot, short-lived and storage optional', () => {
  const { window, entries, handoff, advance } = browser();
  const link = load('../members/[memberCode]/CouponRecipientLink.tsx', { require: name => ({
    'react/jsx-runtime': jsx, 'next/link': 'Link', '../../coupons/coupon-recipient-handoff': handoff,
  })[name] }).default({ memberCode: 'BLU-3' });
  assert.equal(link.props.href, '/admin/coupons#coupon-recipient');
  assert.equal(link.props.prefetch, false);
  assert.equal(entries.size, 0);
  link.props.onNavigate();
  assert.equal(handoff.takeCouponRecipient(), null, 'ordinary coupon visits do not take staged data');
  window.location.hash = '#coupon-recipient';
  assert.equal(handoff.takeCouponRecipient(), 'BLU-3');
  assert.equal(handoff.takeCouponRecipient(), null);
  link.props.onNavigate();
  advance(60_000);
  assert.equal(handoff.takeCouponRecipient(), null);
  handoff.stageCouponRecipient('CARD-1');
  assert.equal(entries.size, 0);
  Object.defineProperty(window, 'sessionStorage', { get() { throw Error('blocked'); } });
  assert.doesNotThrow(() => link.props.onNavigate());
  assert.equal(handoff.takeCouponRecipient(), null);
});

const definition = { id: 7, title: 'Fixture', kind: 'COUPON', active: true };
const list = { data: { definitions: [definition], assignments: [], coupons: [], promoOrders: [], audit: [], grantTargetingReady: true } };
const proof = 'a'.repeat(64);
const preview = { definitionId: 7, definitionTitle: 'Fixture', memberCode: 'BLU-3', fullName: 'Synthetic member',
  recipientGroup: '30', durationDays: 30, packageExpiresAt: '2027-01-10T00:00:00Z', proof };
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(replies, kind = 'COUPON') {
  const { window, handoff } = browser();
  window.location.hash = '#coupon-recipient';
  handoff.stageCouponRecipient('BLU-3');
  const hooks = [], effects = [], calls = [], input = { value: '' };
  let index = 0, keys = 0;
  const client = load('./BenefitsAdminClient.tsx', {
    require: name => ({
      'react/jsx-runtime': jsx,
      react: {
        useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = initial;
          return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
        useRef(initial) { return hooks[index++] ??= { current: initial }; },
        useCallback: fn => fn,
        useEffect(fn) { const i = index++; if (!(i in hooks)) { hooks[i] = true; effects.push(fn); } },
      },
      '@/components/R6CouponHistory': 'History', '@/lib/r6-coupon-history': { couponKinds: {} }, './coupon-recipient-handoff': handoff,
    })[name],
    AbortController, FormData: class { constructor(fields) { return fields; } },
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      assert.ok(replies.length, `Unexpected request ${url}`);
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return { ok: true, json: async () => reply };
    },
    crypto: { randomUUID: () => { keys++; return 'fixture-request-key'; } },
  }).default;
  function* walk(value) {
    if (Array.isArray(value)) { for (const child of value) yield* walk(child); }
    else if (value?.type) { yield value; yield* walk(value.props.children); }
  }
  function find(type, match = () => true) {
    index = 0;
    return [...walk(client({ kind }))].find(el => el.type === type && match(el.props))?.props;
  }
  const grantForm = () => find('form', props => !!props.onChange);
  return { calls, input, find, keys: () => keys,
    create(fields) {
      const body = new Map(Object.entries(fields));
      body.getAll = () => [];
      find('form', p => !p.onChange).onSubmit({ preventDefault() {}, currentTarget: body });
    },
    mount() { find('input', p => p.name === 'memberCode').ref.current = input; for (const fn of effects) fn(); },
    submit(code = input.value) { grantForm().onSubmit({ preventDefault() {}, currentTarget: new Map(Object.entries({
      memberCode: code, definitionId: '7', recipientGroup: '30',
    })) }); },
    edit() { grantForm().onChange(); },
    confirm: () => find('button', p => p.children === 'ยืนยันมอบหมายให้ผู้รับนี้'),
  };
}

test('handoff only prefills; validation, server preview and explicit confirmation are separate', async () => {
  const h = harness([list, { data: { ...preview, memberCode: 'BLU-4' } }, { data: preview }, { data: preview }, {}, list]);
  h.mount();
  await flush();
  assert.equal(h.input.value, 'BLU-3');
  assert.deepEqual(h.calls.map(c => c.url), ['/api/admin/benefits/list']);
  h.submit('bad-code');
  assert.equal(h.calls.length, 1);
  h.submit();
  await flush();
  assert.equal(h.confirm(), undefined, 'mismatched canonical recipient cannot be confirmed');
  h.submit();
  await flush();
  assert.equal(h.calls.at(-1).url, '/api/admin/benefits/grant-preview');
  assert.deepEqual(JSON.parse(h.calls.at(-1).body), { definitionId: 7, memberCode: 'BLU-3', recipientGroup: '30' });
  assert.equal(h.keys(), 0);
  assert.ok(h.confirm());
  h.edit();
  assert.equal(h.confirm(), undefined);
  h.submit();
  await flush();
  h.confirm().onClick();
  await flush();
  const grants = h.calls.filter(c => c.url === '/api/admin/benefits/grant');
  assert.equal(grants.length, 1);
  assert.deepEqual(JSON.parse(grants[0].body), { definitionId: 7, memberCode: 'BLU-3', recipientGroup: '30', proof, requestKey: 'fixture-request-key' });
});

test('unavailable targeting and promo page do not turn a handoff into a grant', async () => {
  const coupon = harness([{ data: { ...list.data, grantTargetingReady: false } }]);
  coupon.mount();
  await flush();
  coupon.submit();
  assert.equal(coupon.calls.length, 1);
  assert.equal(coupon.confirm(), undefined);
  const promo = harness([list, { packages: [] }], 'PROMO');
  promo.mount();
  await flush();
  assert.equal(promo.input.value, '');
  assert.ok(promo.calls.every(c => c.method !== 'POST'));
});

const checkoutList = { data: { ...list.data, couponActivationReady: true, couponCampaignReady: true, checkoutCampaignReady: true } };
const campaignFields = { title: 'Checkout', campaignCode: 'CHECK1', description: 'Synthetic', expiresAt: '2099-01-01T09:30', quota: '2', perMember: '1', total: '3', activationDurationMinutes: '', checkoutValue: '5', checkoutCap: '' };
const choose = (h, name, value) => h.find('select', p => p.name === name).onChange({ target: { value } });

test('checkout choices require readiness and do not change manual campaigns', async () => {
  const off = { data: { ...checkoutList.data, checkoutCampaignReady: false } };
  const h = harness([off, {}, off]);
  h.mount(); await flush();
  assert.equal(h.find('option', p => p.value === 'DISCOUNT'), undefined);
  assert.equal(h.find('option', p => p.value === 'POINTS'), undefined);
  choose(h, 'couponType', 'GIFT');
  h.create(campaignFields); await flush();
  assert.equal(h.calls[1].url, '/api/admin/benefits/create-campaign');
  const body = JSON.parse(h.calls[1].body);
  assert.equal(body.campaignKind, 'GIFT');
  assert.equal(body.bonusDays, 0);
  assert.ok(!('checkoutUnit' in body));
});

test('checkout form serializes percent, fixed satang and points; uncertain response reuses the exact request', async () => {
  for (const [kind, unit, value, cap, duration] of [
    ['DISCOUNT', 'PERCENT', '5', '10000', '0'],
    ['DISCOUNT', 'SATANG', '10001', '', ''],
    ['POINTS', 'POINTS', '500', '200', '30'],
  ]) {
    const h = harness([checkoutList, Error('offline result'), {}, checkoutList]);
    h.mount(); await flush();
    assert.ok(h.find('option', p => p.value === kind));
    choose(h, 'couponType', kind);
    if (kind === 'DISCOUNT') choose(h, 'checkoutDiscountUnit', unit);
    else assert.equal(h.find('select', p => p.name === 'checkoutDiscountUnit'), undefined);
    if (unit === 'PERCENT') {
      h.create({ ...campaignFields, checkoutValue: '101' });
      assert.equal(h.keys(), 0);
    }
    h.create({ ...campaignFields, checkoutValue: value, checkoutCap: cap, activationDurationMinutes: duration });
    await flush();
    assert.equal(h.calls[1].url, '/api/admin/benefits/create-checkout-campaign');
    assert.deepEqual(JSON.parse(h.calls[1].body), {
      title: 'Checkout', campaignCode: 'CHECK1', campaignKind: kind, description: 'Synthetic',
      usesPerCoupon: 2, perMember: 1, total: 3, expiresAt: '2099-01-01T02:30:00.000Z', activationDurationMinutes: duration === '' ? null : Number(duration),
      checkoutUnit: unit, checkoutValue: Number(value), checkoutCap: cap === '' ? null : Number(cap), requestKey: 'fixture-request-key',
    });
    h.find('button', p => p.children === 'ลองคำขอเดิมอีกครั้ง').onClick();
    await flush();
    assert.deepEqual(h.calls[2], h.calls[1]);
    assert.equal(h.keys(), 1);
    assert.equal(h.calls[3].url, '/api/admin/benefits/list');
  }
});
