import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = ts.transpileModule(fs.readFileSync(new URL('../app/member/rewards/RewardsClient.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const keys = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const rewardCode = '33333333-3333-4333-8333-333333333333';
function fixture(memberCode = 'NEW-REGISTERED') {
  return {
    memberCode, fullName: 'Real session name', points: 100,
    rewards: [
      { id: 1, title: 'Towel', description: 'Physical reward', imageUrl: null, pointCost: 30, stock: 2, isActive: true },
      { id: 2, title: 'Bottle', description: null, imageUrl: null, pointCost: 50, stock: 1, isActive: true },
    ],
    redemptions: [],
  };
}
const reply = (data, status = 200) => Response.json(status < 400 ? { data } : { error: data }, { status });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function walk(node, nodes = []) {
  if (Array.isArray(node)) { for (const child of node) walk(child, nodes); }
  else if (node && typeof node === 'object') { nodes.push(node); walk(node.props?.children, nodes); }
  return nodes;
}
function mount(initialData = fixture()) {
  const slots = [], calls = [], queued = [], storageAccess = [], imports = [];
  let cursor = 0, uuidCount = 0, tree;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
  };
  const storage = Object.fromEntries(['getItem', 'setItem', 'removeItem', 'clear'].map(method => [method, (...args) => {
    storageAccess.push({ method, args });
    throw Error('Browser business storage must not be used');
  }]));
  const exports = {};
  vm.runInNewContext(source, {
    exports, Error, Date, localStorage: storage, window: { localStorage: storage },
    crypto: { randomUUID() { assert.ok(uuidCount < keys.length, 'unexpected new request key'); return keys[uuidCount++]; } },
    require(name) {
      imports.push(name);
      if (name === 'react') return react;
      if (name === 'next/link') return { default: 'a' };
      if (name === 'qrcode.react') return { QRCodeSVG: 'qr' };
      if (name === 'react/jsx-runtime') return require(name);
      throw Error(`Unexpected component dependency: ${name}`);
    },
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      const next = queued.shift();
      assert.ok(next, `Unexpected fetch: ${url}`);
      assert.equal(url, next.url);
      return typeof next.response === 'function' ? next.response() : next.response;
    },
  });
  const app = {
    calls, storageAccess, imports,
    queue(url, response) { queued.push({ url, response }); },
    render() { cursor = 0; tree = exports.default({ initialData }); return walk(tree); },
    nodes() { return app.render(); },
    text() { app.render(); return JSON.stringify(tree); },
    rewardButton(id) {
      const article = app.nodes().find(node => node.type === 'article' && node.key === String(id));
      assert.ok(article, `Missing reward ${id}`);
      const button = walk(article).find(node => node.type === 'button');
      assert.ok(button);
      return button;
    },
    retryButton() {
      const button = app.nodes().find(node => node.type === 'button' && node.props.children === 'ลองคำขอเดิม');
      assert.ok(button, 'pending retry must remain available independently of the catalog');
      return button;
    },
    async retry() {
      const button = app.retryButton();
      assert.equal(button.props.disabled, false);
      button.props.onClick();
      await app.flush();
    },
    async clickReward(id) {
      const button = app.rewardButton(id);
      assert.equal(button.props.disabled, false, 'simulate native click only on enabled buttons');
      button.props.onClick();
      await app.flush();
    },
    async refresh() {
      const button = app.nodes().find(node => node.type === 'button' && node.props.children === 'โหลดข้อมูลใหม่');
      assert.equal(button.props.disabled, false);
      button.props.onClick();
      await app.flush();
    },
    async flush() {
      // Event handlers intentionally return void; drain fetch/JSON microtasks and rerender.
      for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
      app.render();
    },
    assertIsolated() {
      assert.deepEqual(storageAccess, []);
      assert.ok(!imports.some(name => /mock-data|admin-mock|reward-catalog|front-desk/.test(name)));
      assert.equal(queued.length, 0, 'every expected HTTP response was consumed');
    },
    get uuidCount() { return uuidCount; },
  };
  app.render();
  return app;
}
for (const memberCode of ['BLU-3', 'BLU-4', 'NEW-REGISTERED']) {
  test(`${memberCode} renders only server identity, balance and catalog, without mock fallback`, () => {
    const data = fixture(memberCode);
    data.points = 0;
    const app = mount(data);
    assert.match(app.text(), new RegExp(memberCode));
    assert.match(app.text(), /Real session name/);
    assert.match(app.text(), /แต้มคงเหลือ /);
    assert.ok(app.nodes().some(node => node.type === 'p' && node.props.children.includes?.('0')));
    assert.equal(app.nodes().filter(node => node.type === 'article').length, 2);
    for (const reward of data.rewards) assert.equal(app.rewardButton(reward.id).props.disabled, true);
    assert.equal(app.calls.length, 0);
    assert.equal(app.uuidCount, 0);
    app.assertIsolated();
  });
}
test('known legacy identity uses server balance and stock, never mock eligibility', () => {
  const data = fixture('BLU-1001');
  data.points = 40;
  data.rewards.push({ ...data.rewards[0], id: 3, stock: 0 });
  const app = mount(data);
  assert.equal(app.rewardButton(1).props.disabled, false);
  assert.equal(app.rewardButton(2).props.disabled, true);
  assert.equal(app.rewardButton(3).props.disabled, true);
  assert.equal(app.calls.length, 0);
  app.assertIsolated();
});
test('redemption submits only reward ID and UUID, refreshes authoritative balance/history and displays QR', async () => {
  const app = mount();
  const updated = fixture();
  updated.points = 70;
  updated.rewards[0].stock = 1;
  updated.redemptions = [{ id: 9, rewardId: 1, rewardTitle: 'Towel', rewardCode, pointsSpent: 30, status: 'PENDING', redeemedAt: '2026-10-24T01:00:00Z', completedAt: null, memberCode: updated.memberCode, memberName: updated.fullName }];
  app.queue('/api/rewards/redeem', reply({ rewardCode, points: 70 }));
  app.queue('/api/rewards/member', reply(updated));
  await app.clickReward(1);
  assert.equal(app.calls.length, 2);
  const post = app.calls[0];
  assert.equal(post.init.method, 'POST');
  assert.equal(post.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(post.init.body), { rewardId: 1, requestKey: keys[0] });
  assert.equal(app.calls[1].init.cache, 'no-store');
  assert.ok(app.nodes().some(node => node.type === 'p' && node.props.children.includes?.('70')));
  assert.ok(app.nodes().some(node => node.type === 'qr' && node.props.value === rewardCode));
  assert.match(app.text(), /แลกรางวัลสำเร็จ/);
  assert.match(app.text(), /รอรับของ/);
  assert.ok(!app.nodes().some(node => node.props?.role === 'alert'));
  assert.equal(app.rewardButton(1).props.children, 'แลกรางวัล');
  app.assertIsolated();
});
test('persistent ref lock prevents simultaneous clicks, including callbacks from a stale render', async () => {
  const app = mount();
  const gate = deferred();
  app.queue('/api/rewards/redeem', () => gate.promise);
  app.queue('/api/rewards/member', reply({ ...fixture(), points: 70 }));
  const first = app.rewardButton(1), second = app.rewardButton(2);
  first.props.onClick();
  first.props.onClick();
  second.props.onClick();
  assert.equal(app.calls.length, 1);
  assert.equal(app.uuidCount, 1);
  assert.equal(app.rewardButton(1).props.disabled, true);
  assert.equal(app.rewardButton(2).props.disabled, true);
  gate.resolve(reply({ rewardCode }));
  await app.flush();
  assert.equal(app.calls.length, 2);
  assert.equal(app.rewardButton(1).props.disabled, false);
  app.assertIsolated();
});
for (const failure of ['network', '503', 'invalid-json']) {
  test(`${failure} retains exact request key, blocks other rewards and retries even after balance/stock changes`, async () => {
    const app = mount();
    const other = app.rewardButton(2);
    app.queue('/api/rewards/redeem', failure === '503' ? reply('Still unknown', 503) : failure === 'invalid-json' ? new Response('not json') : () => { throw Error('Network unavailable'); });
    await app.clickReward(1);
    assert.ok(app.nodes().some(node => node.props?.role === 'alert'));
    assert.equal(app.retryButton().props.disabled, false);
    assert.equal(app.rewardButton(1).props.disabled, true);
    assert.equal(app.rewardButton(2).props.disabled, true);
    other.props.onClick();
    await app.flush();
    assert.equal(app.calls.length, 1);
    const changed = fixture();
    changed.points = 0;
    changed.rewards = changed.rewards.filter(reward => reward.id !== 1);
    app.queue('/api/rewards/member', reply(changed));
    await app.refresh();
    assert.equal(app.retryButton().props.disabled, false, 'retry must reconcile the original request even when the catalog removes it');
    app.queue('/api/rewards/redeem', reply({ rewardCode }));
    app.queue('/api/rewards/member', reply(changed));
    await app.retry();
    const posts = app.calls.filter(call => call.init.method === 'POST');
    assert.equal(posts.length, 2);
    assert.equal(posts[0].init.body, posts[1].init.body);
    assert.equal(app.uuidCount, 1);
    assert.ok(!app.nodes().some(node => node.type === 'button' && node.props.children === 'ลองคำขอเดิม'));
    assert.equal(app.rewardButton(2).props.disabled, true);
    assert.ok(!app.nodes().some(node => node.props?.role === 'alert'));
    app.assertIsolated();
  });
}
for (const status of [400, 401, 403, 409]) {
  test(`${status} reports definitive rejection without success, clears pending and permits a new request key`, async () => {
    const app = mount();
    app.queue('/api/rewards/redeem', reply('Definitive rejection', status));
    await app.clickReward(1);
    assert.match(app.text(), /Definitive rejection/);
    assert.doesNotMatch(app.text(), /แลกรางวัลสำเร็จ/);
    assert.equal(app.calls.length, 1, 'rejection must not fetch success history');
    assert.equal(app.rewardButton(1).props.children, 'แลกรางวัล');
    assert.equal(app.rewardButton(2).props.disabled, false);
    app.queue('/api/rewards/redeem', reply('Another rejection', status));
    await app.clickReward(2);
    assert.deepEqual(app.calls.map(call => JSON.parse(call.init.body)), [
      { rewardId: 1, requestKey: keys[0] }, { rewardId: 2, requestKey: keys[1] },
    ]);
    assert.doesNotMatch(app.text(), /แลกรางวัลสำเร็จ/);
    app.assertIsolated();
  });
}
test('failed refresh reports an error without replacing server data with mock identity, balances or history', async () => {
  const initial = fixture();
  const app = mount(initial);
  app.queue('/api/rewards/member', reply('Session expired', 401));
  await app.refresh();
  assert.ok(app.nodes().some(node => node.props?.role === 'alert'));
  assert.match(app.text(), /โหลดข้อมูลไม่ได้/);
  assert.match(app.text(), /Real session name/);
  assert.equal(app.nodes().filter(node => node.type === 'article').length, 2);
  assert.equal(app.nodes().filter(node => node.type === 'qr').length, 0);
  assert.equal(app.rewardButton(1).props.disabled, false);
  assert.equal(app.calls.length, 1);
  app.assertIsolated();
});
test('committed redemption followed by failed refresh does not retain an ambiguous spending request', async () => {
  const app = mount();
  app.queue('/api/rewards/redeem', reply({ rewardCode }));
  app.queue('/api/rewards/member', reply('Database unavailable', 503));
  await app.clickReward(1);
  assert.match(app.text(), /แลกรางวัลสำเร็จ/);
  assert.match(app.text(), /Database unavailable/);
  assert.equal(app.rewardButton(1).props.children, 'แลกรางวัล');
  assert.equal(app.rewardButton(2).props.disabled, false);
  app.queue('/api/rewards/member', reply({ ...fixture(), points: 70 }));
  await app.refresh();
  assert.equal(app.calls.filter(call => call.init.method === 'POST').length, 1);
  assert.equal(app.uuidCount, 1);
  app.assertIsolated();
});
