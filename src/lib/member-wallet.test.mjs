import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function load(relative, dependencies) {
  const exports = {};
  const text = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
  const source = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), Date, Error, console });
  return exports.default;
}
const coupon = { id: 27, title: 'เข้าฟรี 1 ครั้ง', status: 'AVAILABLE', totalQuota: 1, usedCount: 0, expired: false, expiresAt: '2026-11-21T12:31:44.662Z' };
function page(member, coupons) {
  const reads = [];
  const Wallet = () => null;
  const component = load('../app/member/page.tsx', {
    'next/navigation': { redirect: path => { throw Error(`redirect:${path}`); } },
    '@/lib/auth/server': { getCurrentMember: async () => member },
    '@/lib/benefits-server': { readWelcomeCoupons: async id => { reads.push(id); return coupons; } },
    './AccountClient': { default: Wallet },
  });
  return { component, reads, Wallet };
}
const member = { id: 2, memberCode: 'BLU-2', fullName: 'TEST', phone: '0890000000', avatarUrl: null, role: 'OWNER', birthDay: null, birthMonth: null, createdAt: new Date('2026-10-22T12:31:44.662Z'), status: 'PENDING' };

test('member root page reads genuine welcome coupons for the authenticated member and passes serializable props', async () => {
  const app = page(member, [coupon]);
  const tree = await app.component();
  assert.equal(tree.type, app.Wallet);
  assert.deepEqual(app.reads, [2]);
  assert.equal(tree.props.welcomeCoupons[0], coupon);
  assert.equal(tree.props.identity.memberCode, 'BLU-2');
  assert.equal(tree.props.welcomeCoupons[0].usedCount, 0);
});
test('unauthenticated wallet redirects without reading or creating coupons', async () => {
  const app = page(null, [coupon]);
  await assert.rejects(app.component(), /redirect:\/member\/login/);
  assert.deepEqual(app.reads, []);
});
test('another authenticated member gets their own empty list, never fallback welcome grants', async () => {
  const app = page({ ...member, id: 3, memberCode: 'BLU-3' }, []);
  const tree = await app.component();
  assert.deepEqual(app.reads, [3]);
  assert.deepEqual(tree.props.welcomeCoupons, []);
});
test('welcome UI displays real available, used and expired coupons with the correct redemption controls', () => {
  const Welcome = load('../app/member/benefits/WelcomeCoupons.tsx', { 'next/navigation': { useRouter: () => ({ refresh() {} }) } });
  const render = coupons => renderToStaticMarkup(createElement(Welcome, { coupons }));
  assert.match(render([coupon]), /คูปองต้อนรับจากฐานข้อมูลจริง/);
  assert.match(render([coupon]), /ยืนยันใช้สิทธิ์เข้าฟรี 1 ครั้ง/);
  const used = render([{ ...coupon, usedCount: 1, status: 'USED' }]);
  assert.match(used, /ใช้แล้ว/);
  assert.doesNotMatch(used, /<button/);
  const expired = render([{ ...coupon, expired: true }]);
  assert.match(expired, /หมดอายุ/);
  assert.doesNotMatch(expired, /<button/);
});
test('bottom-navigation wallet mounts the same genuine coupon component outside mock-only conditions', () => {
  const source = fs.readFileSync(new URL('../app/member/AccountClient.tsx', import.meta.url), 'utf8');
  assert.match(source, /tab === "coupons"[^]*?<WelcomeCoupons key=\{identity\.id\} coupons=\{welcomeCoupons\}/);
  assert.doesNotMatch(source, /ยังไม่มีคูปองในกระเป๋า/);
});
