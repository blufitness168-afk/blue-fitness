import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function setup({ allowed = true, role = 'OWNER', results = [], fail = false, state = {}, beforeRead } = {}) {
  const calls = [], guards = [];
  const token = 'a'.repeat(64), digest = createHash('sha256').update(token).digest('hex');
  const member = { id: 99, role: allowed ? role : 'MEMBER', status: 'ACTIVE', passwordHash: 'never-serialize' };
  const session = { tokenHash: digest, revokedAt: null, expiresAt: new Date(Date.now() + 60000), mode: 'NORMAL' };
  Object.assign(member, state.member);
  Object.assign(session, state.session);
  const field = (name) => ({ field: name });
  const schema = { members: { id: field('id') }, authSessions: Object.fromEntries(['memberId', 'tokenHash', 'revokedAt', 'expiresAt'].map(k => [k, field(k)])) };
  const value = input => input?.field ? (input.field === 'id' || input.field === 'memberId' ? member.id : session[input.field]) : input;
  const db = { select: () => ({ from: () => ({ innerJoin: () => ({ where: condition => ({ limit: async () => condition ? [{ member, session }] : [] }) }) }) }) };
  const cache = new Map();
  const mocks = {
    'server-only': {},
    'next/headers': { cookies: async () => ({ get: () => state.cookie === null ? undefined : ({ value: state.cookie ?? token }) }) },
    'next/navigation': { redirect: path => { throw new Error(`redirect:${path}`); } },
    '@/db': { db }, '@/db/schema': schema,
    'drizzle-orm': { eq: (a, b) => value(a) === value(b), gt: (a, b) => value(a) > value(b), isNull: a => value(a) === null, and: (...conditions) => conditions.every(Boolean) },
    './password': {}, './policy': {},
    '@neondatabase/serverless': { neon: () => async (parts, ...values) => {
      assert.ok(guards.length, 'authorize before SQL');
      const text = parts.join('?');
      calls.push({ text, values });
      if (fail) throw new Error('database unavailable');
      beforeRead?.({ member, session, index: calls.length - 1 });
      if (text.includes('WITH authorized')) {
        for (const predicate of ["s.token_hash =", "actor.id =", "actor.role::text =", "actor.role IN ('ADMIN', 'OWNER')", "actor.status <> 'SUSPENDED'", 's.revoked_at IS NULL', 's.expires_at > now()', "s.mode = 'NORMAL'"]) assert.ok(text.includes(predicate), predicate);
        assert.equal(values[0], digest);
        assert.ok(!values.includes(token), 'raw token is never sent to SQL');
        if (values[0] !== session.tokenHash || values[1] !== member.id || values[2] !== member.role || !['ADMIN', 'OWNER'].includes(member.role) || member.status === 'SUSPENDED' || session.revokedAt || session.expiresAt <= new Date() || session.mode !== 'NORMAL') return [];
      }
      return results.shift() || [];
    } },
  };
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const filename = new URL(path, import.meta.url), loaded = new Module(filename.pathname);
    loaded.require = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === '@/lib/auth/server' || name === './auth/server') return load('./auth/server.ts');
      if (name === './admin-permissions') return load('./admin-permissions.ts');
      if (name === './admin-permissions-server') {
        const actual = load('./admin-permissions-server.ts');
        return { requireAdminPage: async path => { guards.push(path); return actual.requireAdminPage(path); } };
      }
      return require(name);
    };
    loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename.pathname);
    cache.set(path, loaded.exports);
    return loaded.exports;
  }
  process.env.DATABASE_URL = 'mock-only';
  return { ...load('./admin-members-server.ts'), calls, guards, load };
}
test('all data loaders guard their existing route before DB access', async () => {
  for (const [name, args] of [['getAdminMembers', []], ['getAdminMember', ['BLU-1']], ['getAdminDashboard', []]]) {
    const s = setup({ allowed: false });
    await assert.rejects(s[name](...args), /redirect/);
    assert.equal(s.calls.length, 0);
  }
  const permissions = readFileSync(new URL('./admin-permissions.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(permissions.match(/const staffPaths = .*;/)[0], /finance|"\/admin"/);
});
test('real guard and real session loader enforce ADMIN/OWNER vs MEMBER, revoked, suspended, expired and kiosk sessions', async () => {
  for (const role of ['ADMIN', 'OWNER']) {
    const s = setup({ role, results: [[{ total: 0 }], [], [{ id: 7, phone: 'fixture', emergencyPhone: 'fixture' }], [], [], []] });
    assert.equal((await s.load('./admin-permissions-server.ts').requireAdminPage('/admin/members')).role, role);
    assert.equal((await s.getAdminMembers()).callerRole, role);
    assert.equal((await s.getAdminMember('BLU-7')).callerRole, role);
    assert.equal(s.calls.length, 6);
  }
  for (const options of [
    { role: 'MEMBER' }, { state: { session: { revokedAt: new Date() } } },
    { state: { member: { status: 'SUSPENDED' } } }, { state: { session: { expiresAt: new Date(0) } } },
    { state: { session: { mode: 'KIOSK' } } }, { state: { cookie: null } }, { state: { cookie: 'bad' } },
  ]) {
    for (const method of ['getAdminMembers', 'getAdminMember']) {
      const s = setup(options);
      await assert.rejects(s[method]('BLU-7'), /redirect/);
      assert.equal(s.calls.length, 0);
    }
  }
});
test('SQL rechecks session and exact role even when authorization changes after the guard', async () => {
  for (const change of [
    ({ session }) => { session.revokedAt = new Date(); },
    ({ session }) => { session.mode = 'KIOSK'; },
    ({ session }) => { session.expiresAt = new Date(0); },
    ({ member }) => { member.status = 'SUSPENDED'; },
    ({ member }) => { member.role = 'MEMBER'; },
    ({ member }) => { member.role = 'ADMIN'; },
  ]) {
    const list = setup({ results: [[{ total: 1 }], [{ memberCode: 'secret' }]], beforeRead: change });
    await assert.rejects(list.getAdminMembers(), /Forbidden/);
    const detail = setup({ results: [[{ id: 7, memberCode: 'secret' }]], beforeRead: change });
    assert.equal(await detail.getAdminMember('BLU-7'), null);
    const history = setup({ results: [[{ id: 7 }], [{ id: 'secret' }], [{ id: 9 }], [{ id: 10 }]], beforeRead: ctx => { if (ctx.index > 0) change(ctx); } });
    const data = await history.getAdminMember('BLU-7');
    for (const key of ['orders', 'checkins', 'coupons']) assert.deepEqual(data[key].rows, []);
  }
});
test('ADMIN SQL never selects financial fields and allowlisted payload drops unexpected secrets; OWNER retains amounts', async () => {
  const secret = { amountSatang: 99000, subtotalSatang: 99000, discountSatang: 1, provider: 'private', slipUrl: 'private', passwordHash: 'private', tokenHash: 'private', verificationSnapshot: 'private' };
  for (const role of ['ADMIN', 'OWNER']) {
    const s = setup({ role, results: [[{ id: 7, memberCode: 'BLU-7', phone: 'staff-visible', emergencyName: 'Contact', emergencyPhone: 'staff-visible', ...secret }], [{ id: 'order', packageName: 'Package', timeSlot: '07:00-14:00', status: 'PAID', paidAt: '2026-01-01', ...secret }], [{ id: 1, ...secret }], [{ id: 2, ...secret }]] });
    const data = await s.getAdminMember('BLU-7');
    assert.equal(data.member.emergencyName, 'Contact');
    assert.equal(data.member.phone, 'staff-visible');
    assert.equal(data.orders.rows[0].timeSlot, '07:00-14:00');
    assert.equal(data.orders.rows[0].membershipStartsAt, null);
    const json = JSON.stringify(data);
    assert.doesNotMatch(json, /private|password|tokenHash|subtotal|discount|provider|slip|verification/);
    if (role === 'ADMIN') {
      assert.doesNotMatch(json, /amount|paidAt/);
      for (const call of s.calls) assert.doesNotMatch(call.text, /amount|subtotal|discount|paid_at|provider|slip|verification|receiver_snapshot/i);
    } else {
      assert.equal(data.orders.rows[0].amountSatang, 99000);
      assert.match(s.calls[1].text, /amount_satang/);
    }
    const list = setup({ role, results: [[{ total: 1 }], [{ memberCode: 'BLU-7', ...secret }]] });
    assert.doesNotMatch(JSON.stringify(await list.getAdminMembers()), /amount|private|password|slip|provider/);
  }
});
test('sidebar automatically includes members through the shared permission helper; role mutations remain owner-only', async () => {
  const shell = readFileSync(new URL('../app/admin/AdminShell.tsx', import.meta.url), 'utf8');
  assert.match(shell, /href: "\/admin\/members"/);
  assert.match(shell, /canAccessAdminPath\(role, item.href\)/);
  const filename = new URL('../app/api/admin/roles/route.ts', import.meta.url);
  for (const role of ['ADMIN', 'MEMBER']) {
    const s = setup({ role });
    const loaded = new Module(filename.pathname);
    loaded.require = name => {
      if (name === '@/lib/auth/server') return s.load('./auth/server.ts');
      if (name === '@/lib/auth/http') return { sameOrigin: () => true, json: (body, status) => ({ body, status }) };
      if (name === '@/db') return { db: { update: () => { throw new Error('must not mutate'); } } };
      if (name === '@/db/schema' || name === '@/lib/auth/policy') return {};
      return require(name);
    };
    loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename.pathname);
    assert.equal((await loaded.exports.POST({})).status, 403);
  }
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
  assert.ok(s.calls[0].values[3].startsWith('%\\%\\_'));
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
    assert.deepEqual(call.values.slice(3), [7, 0]);
    assert.match(call.text, /LIMIT 101 OFFSET/);
  }
});
test('history pagination validates untrusted query values without unsafe offsets', () => {
  const s = setup();
  for (const value of [undefined, ['2', '3'], '', '0', '-1', '1.5', '1e3', 'Infinity', '99999999999999', '2 OR true', ' 2']) {
    assert.equal(s.historyPage(value), 1);
  }
  assert.equal(s.historyPage('2'), 2);
});
test('each history has independent offsets and strips the lookahead row', async () => {
  const rows = Array.from({ length: 101 }, (_, id) => ({ id }));
  const s = setup({ results: [[{ id: 7, memberCode: 'BLU-7' }], rows, rows.slice(0, 100), []] });
  const data = await s.getAdminMember('BLU-7', { ordersPage: '2', checkinsPage: '3', couponsPage: '4' });
  assert.deepEqual(s.calls.slice(1).map(c => c.values.slice(3)), [[7, 100], [7, 200], [7, 300]]);
  assert.equal(data.orders.rows.length, 100);
  assert.equal(data.orders.hasNext, true);
  assert.equal(data.orders.page, 2);
  assert.equal(data.checkins.hasNext, false);
  assert.equal(data.coupons.hasNext, false);
  assert.equal(data.coupons.page, 4);
  assert.deepEqual(data.coupons.rows, []);
  for (const call of s.calls.slice(1)) {
    assert.match(call.text, /WHERE member_id = .* ORDER BY .* DESC, id DESC LIMIT 101 OFFSET/);
    assert.doesNotMatch(call.text, /SELECT \*|password|verification_payload/i);
  }
});
test('successive pages expose records beyond 100, with no overlap in unchanged data', async () => {
  const rows = Array.from({ length: 205 }, (_, id) => ({ id: 205 - id }));
  const seen = [];
  for (let page = 1; page <= 3; page++) {
    const s = setup({ results: [[{ id: 7 }], rows.slice((page - 1) * 100, (page - 1) * 100 + 101), [], []] });
    const data = await s.getAdminMember('BLU-7', { ordersPage: String(page) });
    seen.push(...data.orders.rows.map(r => r.id));
    assert.equal(data.orders.hasNext, page < 3);
  }
  assert.deepEqual(seen, rows.map(r => r.id));
  assert.equal(new Set(seen).size, 205);
});
test('detail page forwards awaited query parameters and all histories provide server navigation', () => {
  const page = readFileSync(new URL('../app/admin/members/[memberCode]/page.tsx', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../app/admin/members/[memberCode]/MemberDetailClient.tsx', import.meta.url), 'utf8');
  assert.match(page, /getAdminMember\(memberCode, await searchParams\)/);
  for (const key of ['orders', 'checkins', 'coupons']) {
    assert.ok(view.includes(`navigation("${key}")`));
    assert.ok(view.includes(`${key}Page: String(data.${key}.page)`));
  }
  assert.match(view, /encodeURIComponent\(m.memberCode\)/);
  assert.match(view, /history.hasNext/);
  assert.match(view, /history.page > 1/);
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
test('rendered member detail omits ADMIN money and role controls; OWNER money handles null safely', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const filename = new URL('../app/admin/members/[memberCode]/MemberDetailClient.tsx', import.meta.url);
  const loaded = new Module(filename.pathname);
  loaded.require = name => {
    if (name === 'next/link') return { __esModule: true, default: ({ children }) => React.createElement('a', null, children) };
    if (name === '@/lib/admin-members-server') return { currentStatus: m => m.status };
    if (name === '../MemberRoleAction') return { __esModule: true, default: () => React.createElement('button', null, 'ROLE_MUTATION') };
    return require(name);
  };
  loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename.pathname);
  for (const role of ['ADMIN', 'OWNER']) {
    const data = { callerRole: role, member: { memberCode: 'BLU-7', fullName: 'Fixture', phone: 'fixture', status: 'ACTIVE', role: 'MEMBER', points: 0 }, asOf: Date.now(),
      orders: { rows: [{ id: 'order', packageName: 'Package', amountSatang: 1234500 }, { id: 'null', amountSatang: null }], page: 2, hasNext: true },
      checkins: { rows: [], page: 1, hasNext: false }, coupons: { rows: [], page: 1, hasNext: false } };
    // Even a forged callerRole prop must not open columns for an ADMIN payload.
    const html = renderToStaticMarkup(React.createElement(loaded.exports.default, { data, callerRole: 'OWNER' }));
    assert.match(html, /ถัดไป/);
    assert.match(html, /ก่อนหน้า/);
    assert.doesNotMatch(html, /NaN/);
    if (role === 'ADMIN') assert.doesNotMatch(html, /12,345|>ยอด<|ชำระเมื่อ|ROLE_MUTATION/);
    else assert.match(html, /12,345|ROLE_MUTATION/);
  }
});
test('owned screens have no mock stores, password/payment mutation, or client-side auth', () => {
  for (const path of ['../app/admin/DashboardClient.tsx', '../app/admin/members/MembersClient.tsx', '../app/admin/members/[memberCode]/MemberDetailClient.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|admin-mock|admin-dashboard-mock|purchaseMockPackage|setAdminMemberPassword|saveAdminMemberProfile|readBenefits|"use client"/);
  }
});
