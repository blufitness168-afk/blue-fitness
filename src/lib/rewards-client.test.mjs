import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { setupMock } from './mock-test-harness.mjs';

const require = createRequire(import.meta.url);
const source = ts.transpileModule(fs.readFileSync(new URL('../app/member/rewards/RewardsClient.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function mount(memberCode, { deskError = false } = {}) {
  const mock = setupMock();
  const catalog = mock.load('reward-catalog');
  const members = mock.load('admin-mock').mockAdminMembers;
  const states = [], effects = [], calls = [];
  let index = 0;
  const react = { useState(initial) { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; }, useEffect(fn) { effects.push(fn); }, useCallback: fn => fn, useRef: () => ({ current: false }) };
  const dependencies = {
    react, 'next/image': { default: 'img' }, 'next/link': { default: 'a' },
    'next/navigation': { useRouter: () => ({}) }, 'qrcode.react': { QRCodeSVG: 'qr' },
    'lucide-react': Object.fromEntries(['ChevronLeft', 'Gift', 'CheckCircle2', 'Sparkles'].map(k => [k, k])),
    '@/components/AdminScanner': { MockNotice: 'notice' }, '@/components/Navbar': { default: 'navbar' },
    '@/context/LanguageContext': { useLanguage: () => ({ t: key => key, lang: 'th' }) },
    '@/lib/admin-mock': { mockAdminMembers: members }, '@/lib/mock-data': mock.load('mock-data'),
    '@/lib/front-desk': { DESK_UPDATED_EVENT: 'desk', readDeskRewards() { if (deskError) throw Error('desk corrupt'); return []; } },
    '@/lib/reward-catalog': { ...catalog, rewardWallet() { calls.push('wallet'); return 999999; }, requestMockReward() { calls.push('redeem'); return Promise.resolve({ rewardCode: 'test' }); } },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, Error, require: name => dependencies[name] ?? require(name), window: { addEventListener() {}, removeEventListener() {} } });
  const identity = { memberCode, fullName: 'Real session name', role: 'MEMBER', points: 999999 };
  const render = () => { index = 0; return exports.default({ identity }); };
  render(); effects.shift()();
  const tree = render();
  const nodes = [];
  function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; nodes.push(node); walk(node.props?.children); }
  walk(tree);
  return { nodes, calls, mock, members, text: JSON.stringify(tree) };
}
for (const code of ['BLU-3', 'BLU-4', 'NEW-REGISTERED']) {
  test(`${code} sees catalog with zero MOCK wallet and cannot invoke redemption`, async () => {
    const app = mount(code);
    assert.ok(app.nodes.some(n => n.type === 'article'));
    assert.match(app.text, /read-only\/demo/);
    assert.match(app.text, /ยังไม่เชื่อมต่อฐานข้อมูลจริง/);
    const member = app.nodes.find(n => n.type === 'navbar').props.member;
    assert.equal(member.memberCode, code);
    assert.equal(member.fullName, 'Real session name');
    assert.equal(member.points, 0);
    const buttons = app.nodes.filter(n => n.type === 'button');
    assert.ok(buttons.length > 0);
    for (const button of buttons) { assert.equal(button.props.disabled, true); await button.props.onClick(); }
    assert.deepEqual(app.calls, []);
    assert.deepEqual(app.mock.writes, []);
  });
}
test('known mock identity retains wallet and redemption callback', async () => {
  const code = setupMock().load('admin-mock').mockAdminMembers[0].memberCode;
  const app = mount(code);
  const button = app.nodes.find(n => n.type === 'button' && !n.props.disabled);
  assert.ok(button);
  await button.props.onClick();
  assert.ok(app.calls.includes('wallet'));
  assert.ok(app.calls.includes('redeem'));
});
test('desk read errors still fail closed for unknown and known identities', () => {
  const known = setupMock().load('admin-mock').mockAdminMembers[0].memberCode;
  for (const code of ['NEW-REGISTERED', known]) {
    const app = mount(code, { deskError: true });
    assert.match(app.text, /desk corrupt/);
    assert.ok(app.nodes.some(n => n.props?.role === 'alert'));
    assert.ok(!app.nodes.some(n => n.type === 'article'));
    assert.deepEqual(app.calls, []);
  }
});
