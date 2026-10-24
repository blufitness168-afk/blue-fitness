import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function setup({ allowed = true, results = [], fail = false } = {}) {
  const calls = [], guards = [];
  const filename = new URL('./admin-members-server.ts', import.meta.url);
  const loaded = new Module(filename.pathname);
  const mocks = {
    'server-only': {},
    './admin-permissions-server': { requireAdminPage: async path => { guards.push(path); if (!allowed) throw new Error('redirect'); } },
    '@neondatabase/serverless': { neon: () => async (parts, ...values) => {
      assert.ok(guards.length, 'authorize before SQL');
      calls.push({ text: parts.join('?'), values });
      if (fail) throw new Error('database unavailable');
      return results.shift() || [];
    } },
  };
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename.pathname);
  process.env.DATABASE_URL = 'mock-only';
  return { ...loaded.exports, calls, guards };
}
test('all data loaders guard their existing route before DB access', async () => {
  for (const [name, args] of [['getAdminMembers', []], ['getAdminMember', ['BLU-1']], ['getAdminDashboard', []]]) {
    const s = setup({ allowed: false });
    await assert.rejects(s[name](...args), /redirect/);
    assert.equal(s.calls.length, 0);
  }
  const permissions = readFileSync(new URL('./admin-permissions.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(permissions.match(/const staffPaths = .*;/)[0], /members|finance|"\/admin"/);
});
test('month boundaries are Bangkok local, half-open, including year rollover', () => {
  const s = setup();
  assert.deepEqual(s.monthRange('2026-12'), { month: '2026-12', start: '2026-12-01T00:00:00+07:00', end: '2027-01-01T00:00:00+07:00' });
  for (const invalid of ['2026-13', '2026-00', 'junk', '9999-01']) {
    assert.equal(s.monthRange(invalid, new Date('2026-09-30T18:00:00Z')).month, '2026-10');
  }
});
test('status preserves suspension and expires overdue active members', () => {
  const s = setup(), now = Date.parse('2026-10-01');
  assert.equal(s.currentStatus({ status: 'SUSPENDED', expireDate: '2020-01-01' }, now), 'SUSPENDED');
  assert.equal(s.currentStatus({ status: 'ACTIVE', expireDate: '2026-10-01' }, now), 'EXPIRED');
  assert.equal(s.currentStatus({ status: 'PENDING', expireDate: null }, now), 'PENDING');
});
test('member search binds literal metacharacters and clamps pagination', async () => {
  const s = setup({ results: [[{ total: 70 }], []] });
  const data = await s.getAdminMembers("%_' OR true --", '900');
  assert.equal(data.page, 2);
  assert.equal(data.pages, 2);
  assert.equal(s.calls[1].values.at(-1), 50);
  assert.ok(s.calls[0].values[0].startsWith('%\\%\\_'));
  assert.doesNotMatch(s.calls[0].text, /OR true/);
  assert.doesNotMatch(s.calls[1].text, /password|SELECT \*/i);
});
test('missing detail returns null; detail binds member ID and limits history', async () => {
  const missing = setup();
  assert.equal(await missing.getAdminMember('not-found'), null);
  assert.equal(missing.calls.length, 1);
  const s = setup({ results: [[{ id: 7, memberCode: 'BLU-7', fullName: 'Real member' }], [], [], []] });
  const data = await s.getAdminMember('BLU-7');
  assert.equal(data.member.id, undefined);
  for (const call of s.calls.slice(1)) {
    assert.deepEqual(call.values, [7]);
    assert.match(call.text, /LIMIT 100/);
  }
});
test('dashboard uses PAID orders and paid_at, real checkins and current membership, no fictional finance', async () => {
  const s = setup({ results: [[{ paidSatang: '0', paidOrders: 0 }], [], [], []] });
  const data = await s.getAdminDashboard('2026-10');
  assert.equal(data.summary.paidSatang, '0');
  assert.deepEqual(data.sales, []);
  assert.match(s.calls[0].text, /status = 'PAID' AND paid_at >= .* AND paid_at </);
  assert.match(s.calls[0].text, /count\(\*\)::int FROM checkins/);
  assert.match(s.calls[0].text, /expire_date > now\(\)/);
  assert.doesNotMatch(s.calls.map(c => c.text).join(''), /expense|net_profit|INSERT|UPDATE|DELETE/i);
});
test('DB failures propagate instead of replacing real data with mocks or empty success', async () => {
  const s = setup({ fail: true });
  await assert.rejects(s.getAdminMembers(), /database unavailable/);
});
test('owned screens have no mock stores, password/payment mutation, or client-side auth', () => {
  for (const path of ['../app/admin/DashboardClient.tsx', '../app/admin/members/MembersClient.tsx', '../app/admin/members/[memberCode]/MemberDetailClient.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|admin-mock|admin-dashboard-mock|purchaseMockPackage|setAdminMemberPassword|saveAdminMemberProfile|readBenefits|"use client"/);
  }
});
