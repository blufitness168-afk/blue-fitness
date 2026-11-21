import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { NeonQueryPromise, SqlTemplate } from '@neondatabase/serverless';
const require = createRequire(import.meta.url);
const rolloutSource = ts.transpileModule(readFileSync(new URL('./staff-paid-rollout-server.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function setup({ allowed = true, role = 'OWNER', results = [], fail = false, state = {}, beforeRead, reads, onlineReads = false, historySources = {}, financeData = { records: [], audit: [], unconfirmedPaidCount: 0 } } = {}) {
  const rollout = {};
  runInNewContext(rolloutSource, { exports: rollout, require: () => ({}), process: { env: { ENABLE_STAFF_PAID_READS: reads } } });
  const calls = [], guards = [], historyProbes = [];
  let financeReads = 0;
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
    'server-only': {}, './staff-paid-rollout-server': rollout, './online-cancellation-rollout-server': { onlineCancellationReads: async () => onlineReads },
    './real-finance-server': { readRealFinance: async () => { financeReads++; return financeData; } },
    '@/components/AdminDashboardCharts': {},
    'next/headers': { cookies: async () => ({ get: () => state.cookie === null ? undefined : ({ value: state.cookie ?? token }) }) },
    'next/navigation': { redirect: path => { throw new Error(`redirect:${path}`); } },
    '@/db': { db }, '@/db/schema': schema,
    'drizzle-orm': { eq: (a, b) => value(a) === value(b), gt: (a, b) => value(a) > value(b), isNull: a => value(a) === null, and: (...conditions) => conditions.every(Boolean) },
    './password': {}, './policy': {},
    '@neondatabase/serverless': { neon: () => (parts, ...args) => {
      if (!parts[0].startsWith('WITH authorized')) {
        return new NeonQueryPromise(async () => { throw new Error('Unexpected standalone SQL'); }, new SqlTemplate(parts, args));
      }
      assert.ok(guards.length, 'authorize before SQL');
      const { query, params: values } = new SqlTemplate(parts, args).toParameterizedQuery();
      const text = query.replace(/\$\d+/g, '?');
      const historyProbe = text.includes("to_regclass('public.r7_visits')");
      (historyProbe ? historyProbes : calls).push({ text, query, values });
      if (fail) return Promise.reject(new Error('database unavailable'));
      beforeRead?.({ member, session, index: calls.length + historyProbes.length - 1, text });
      if (text.includes('WITH authorized')) {
        for (const predicate of ["s.token_hash =", "actor.id =", "actor.role::text =", "actor.role IN ('ADMIN', 'OWNER')", "actor.status <> 'SUSPENDED'", 's.revoked_at IS NULL', 's.expires_at > now()', "s.mode = 'NORMAL'"]) assert.ok(text.includes(predicate), predicate);
        assert.equal(values[0], digest);
        assert.ok(!values.includes(token), 'raw token is never sent to SQL');
        if (values[0] !== session.tokenHash || values[1] !== member.id || values[2] !== member.role || !['ADMIN', 'OWNER'].includes(member.role) || member.status === 'SUSPENDED' || session.revokedAt || session.expiresAt <= new Date() || session.mode !== 'NORMAL') return [];
      }
      return historyProbe ? [historySources] : results.shift() || [];
    } },
  };
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const filename = new URL(path, import.meta.url), loaded = new Module(filename.pathname);
    loaded.require = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === '@/lib/auth/server' || name === './auth/server') return load('./auth/server.ts');
      if (name === './auth/http') return { json: (body, status = 200) => Response.json(body, { status }), readBody: async request => request.json() };
      if (name === '../app/admin/finance/types' || name === '@/app/admin/finance/types') return load('../app/admin/finance/types.ts');
      if (name === '@/lib/real-finance-server') return load('./real-finance-server.ts');
      if (name === '@/lib/xlsx' || name === './xlsx') return load('./xlsx.ts');
      if (name === './admin-dashboard-metrics') return load('./admin-dashboard-metrics.ts');
      if (name === './admin-permissions') return load('./admin-permissions.ts');
      if (name === './package-catalog') return load('./package-catalog.ts');
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
  return { ...load('./admin-members-server.ts'), calls, guards, historyProbes, financeReads: () => financeReads, load };
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
    for (const method of ['getAdminMembers', 'getAdminMember', 'getAdminDashboard']) {
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
    const s = setup({ role, reads: 'true', results: [[{ id: 7, memberCode: 'BLU-7', phone: 'staff-visible', emergencyName: 'Contact', emergencyPhone: 'staff-visible', ...secret }], [{ id: 'order', packageName: 'Package', timeSlot: '07:00-14:00', status: 'PAID', paidAt: '2026-01-01', ...secret }], [{ id: 1, ...secret }], [{ id: 2, ...secret }]] });
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
    const list = setup({ role, reads: 'true', results: [[{ total: 1 }], [{ memberCode: 'BLU-7', ...secret }]] });
    assert.doesNotMatch(JSON.stringify(await list.getAdminMembers()), /amount|private|password|slip|provider/);
    for (const call of [list.calls[1], s.calls[0]]) assert.match(call.text, /r4_staff_private\.paid_active_expiry\(id, now\(\)\)/);
    assert.match(s.calls[1].text, /UNION ALL[\s\S]*FROM r4_staff_private\.paid_history WHERE member_id = \?/);
  }
});
test('staff transfer history retains canceled and uncanceled sales for both roles with original owner-only amounts', async () => {
  const transfer = {
    id: 'staff-transfer:7', status: 'STAFF_TRANSFER', packageName: 'Transfer', timeSlot: '07:00-14:00',
    createdAt: '2026-11-20T09:00:00Z', paidAt: '2026-11-20T08:00:00Z',
    membershipStartsAt: '2026-12-01T09:00:00Z', membershipExpiresAt: '2027-01-01T09:00:00Z',
    amountSatang: 99000, cancelledAt: '2026-11-22T09:00:00Z',
  };
  const uncanceled = { ...transfer, id: 'staff-transfer:6', cancelledAt: null };
  for (const role of ['ADMIN', 'OWNER']) {
    const s = setup({ role, reads: 'true', results: [[{ id: 7 }], [transfer, uncanceled], [], []] });
    const { orders } = await s.getAdminMember('BLU-7');
    assert.deepEqual(JSON.parse(JSON.stringify(orders.rows)), [transfer, uncanceled].map(row => {
      const { amountSatang, paidAt, ...common } = row;
      return role === 'OWNER' ? { ...common, amountSatang, paidAt } : common;
    }));
    const history = s.calls[1].text;
    assert.match(history, /SELECT id,[^\n]*"cancelledAt" FROM/);
    assert.match(history, /NULL::timestamptz AS "cancelledAt"\s+FROM package_payment_orders/);
    assert.match(history, /starts_at, ends_at, cancelled_at\s+FROM r4_staff_private\.paid_history WHERE member_id = \?\s*\) history ORDER BY "createdAt" DESC, id DESC LIMIT 101/);
    if (role === 'ADMIN') assert.doesNotMatch(history, /amount_satang|paid_at|occurred_at/);
    else assert.match(history, /daily_slot, amount_satang, 'STAFF_TRANSFER', recorded_at, occurred_at/);
  }
});
test('default-off admin list and detail read legacy expiry and online orders for both roles', async () => {
  for (const [role, reads] of [['OWNER', undefined], ['ADMIN', 'TRUE']]) {
    const expireDate = '2026-12-01';
    const member = { id: 7, memberCode: 'BLU-7', expireDate };
    const order = { id: 'online-order', status: 'PAID', amountSatang: 3000, paidAt: '2026-11-20' };
    const s = setup({ role, reads, results: [[{ total: 1 }], [member], [member], [order], [], []] });
    assert.equal((await s.getAdminMembers()).members[0].expireDate, expireDate);
    const detail = await s.getAdminMember('BLU-7', { ordersPage: '2' });
    assert.equal(detail.member.expireDate, expireDate);
    assert.equal(detail.orders.rows[0].id, 'online-order');
    assert.equal(detail.orders.rows[0].membershipStartsAt, null);
    assert.equal(detail.orders.rows[0].cancelledAt, null);
    for (const call of s.calls) assert.doesNotMatch(call.text, /r4_staff_private|STAFF_TRANSFER/);
    for (const call of s.calls.slice(1, 3)) assert.match(call.text, /expire_date AS "expireDate"/);
    const history = s.calls[3];
    assert.match(history.text, /FROM package_payment_orders WHERE member_id = \?/);
    assert.deepEqual(history.values.slice(3), [7, 100]);
    if (role === 'OWNER') {
      assert.match(history.text, /amount_satang/);
      assert.equal(detail.orders.rows[0].amountSatang, order.amountSatang);
    } else {
      assert.doesNotMatch(history.text, /amount_satang|paid_at/);
      assert.ok(!Object.hasOwn(detail.orders.rows[0], 'paidAt'));
      assert.ok(!Object.hasOwn(detail.orders.rows[0], 'amountSatang'));
    }
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
  const data = await s.getAdminMembers({ q: "%_' OR true --", page: '900' });
  assert.equal(data.page, 2);
  assert.equal(data.pages, 2);
  assert.equal(s.calls[1].values.at(-1), 50);
  assert.ok(s.calls[0].values[3].startsWith('%\\%\\_'));
  assert.doesNotMatch(s.calls[0].text, /OR true/);
  assert.doesNotMatch(s.calls[1].text, /password|SELECT \*/i);
});

test('member list filters compose across count, Bangkok month summary and rows without ADMIN money reads', async () => {
  const s = setup({ role: 'ADMIN', results: [[{ total: 51, monthly: [{ month: '2026-12', total: 51, amountSatang: 99 }] }], []] });
  const data = await s.getAdminMembers({
    q: '  BLU  ', name: ' สม%_\\ ', code: '01_', phone: '089%', gender: 'FEMALE',
    from: '2026-12-15', to: '2026-12-31', month: '2026-12', packageLabel: ' 1 เดือน_ ', slot: '07:00-14:00', page: '2',
  });
  assert.equal(data.invalid, false);
  assert.equal(data.page, 2);
  assert.equal(data.filters.q, 'BLU');
  assert.equal(data.filters.name, 'สม%_\\');
  assert.deepEqual(data.monthly, [{ month: '2026-12', total: 51 }]);
  assert.deepEqual(s.calls[0].values, s.calls[1].values.slice(0, -1));
  assert.deepEqual(s.calls[0].values.slice(3), [
    '%BLU%', '%BLU%', '%BLU%', '%สม\\%\\_\\\\%', '%01\\_%', '%089\\%%', 'FEMALE',
    '2026-12-15', '2026-12-31', '2026-12-01', '2026-12-01', '1 เดือน\\_', '07:00-14:00',
  ]);
  for (const { text } of s.calls) {
    assert.match(text, /WHERE \(full_name ILIKE \? OR member_code ILIKE \? OR phone ILIKE \?\)\s+AND full_name/);
    assert.match(text, /created_at >= \(\?::date::timestamp AT TIME ZONE 'Asia\/Bangkok'\)/);
    assert.match(text, /created_at < \(\(\?::date \+ 1\)::timestamp AT TIME ZONE 'Asia\/Bangkok'\)/);
    assert.match(text, /created_at < \(\(\?::date \+ interval '1 month'\) AT TIME ZONE 'Asia\/Bangkok'\)/);
    assert.match(text, /EXISTS \(\s*SELECT 1 FROM package_payment_orders o WHERE o.member_id = members.id AND o.status = 'PAID'\s+AND o.package_snapshot->>'label' ILIKE \?\s+AND o.package_snapshot->>'timeSlot' = \?\s*\)/);
    assert.doesNotMatch(text, /amount|paid_at|slip|provider|price|r4_online_private/i);
  }
  assert.match(s.calls[0].text, /to_char\(created_at AT TIME ZONE 'Asia\/Bangkok'[\s\S]*LIMIT 12/);
  assert.match(s.calls[1].text, /ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET \?/);
  assert.equal(s.calls[1].values.at(-1), 50);
});

test('malformed structured member filters fail closed; unfiltered list needs no order read', async () => {
  for (const input of [{ from: '2026-02-29' }, { to: '2026-04-31' }, { month: '2026-13' },
    { from: '2026-12-31', to: '2026-12-01' }, { gender: 'OWNER' }, { gender: ['MALE', 'FEMALE'] },
    { slot: '14:00-07:00' }, { packageLabel: ['first', 'second'] }, { currentSlot: '23:00-01:00' },
    { currentDuration: '030' }, { currentDuration: ['1', '30'] }]) {
    const s = setup({ results: [[{ total: 0 }], []] });
    const data = await s.getAdminMembers(input);
    assert.equal(data.invalid, true);
    assert.ok(s.calls.every(({ text }) => text.includes('AND FALSE')));
  }
  const s = setup({ results: [[{ total: 0 }], []] });
  const data = await s.getAdminMembers({ q: ['one', 'two'], page: ['1', '2'] });
  assert.equal(data.invalid, false);
  assert.equal(data.page, 1);
  assert.equal(data.filters.q, '');
  assert.deepEqual(data.monthly, []);
  assert.ok(s.calls.every(({ text }) => !text.includes('package_payment_orders')));
});

test('current package filter with missing or partial authority does not fall back to purchases', async () => {
  for (const sources of [{ term_contract: 'absent', standalone: false },
    { term_contract: 'absent', standalone: true, staff_schema: true, staff_sales: true },
    { term_contract: 'absent', standalone: true, online_active: false, online_cancellations: true },
    { term_contract: 'unsupported', standalone: true }]) {
    const s = setup({ results: [[sources], [{ total: 0 }], []] });
    const data = await s.getAdminMembers({ currentDuration: '30' });
    assert.equal(data.currentUnavailable, true);
    assert.equal(data.total, 0);
    assert.ok(s.calls.slice(1).every(({ text }) => text.includes('AND FALSE') && !text.includes('package_payment_orders')));
  }
  const revoked = setup({ beforeRead: ({ session }) => { session.revokedAt = new Date(); } });
  await assert.rejects(revoked.getAdminMembers({ currentDuration: '30' }), /Forbidden/);
});

test('lifecycle report never substitutes account aggregates for missing entitlement evidence', async () => {
  const today = setup().monthRange().month;
  for (const [reportMonth, hasProbe] of [[today, true], ['2001-01', false], ['9998-01', false]]) {
    const s = setup({ results: [...(hasProbe ? [[{ term_contract: 'standalone', standalone: true }]] : []), [{ total: 17 }], []] });
    const report = await s.getAdminMembers({ reportMonth });
    assert.deepEqual(report.lifecycle, { month: reportMonth, nearExpiry: null, nearExpiryAsOf: null });
    assert.equal(report.total, 17);
    assert.equal(s.calls.length, hasProbe ? 3 : 2);
    assert.ok(s.calls.slice(-2).every(call => !call.text.includes('time_supplement_main')));
  }
  for (const reportMonth of ['2026-13', ['2026-11', '2026-12']]) {
    const s = setup({ results: [[{ total: 0 }], []] });
    const report = await s.getAdminMembers({ reportMonth });
    assert.equal(report.invalid, true);
    assert.equal(report.lifecycle, null);
  }
});

test('current package filter selects the standalone or combined authority on synthetic PostgreSQL fixtures', async () => {
  const { PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite');
  const db = new PGlite();
  const migration = (file, start, end) => {
    const sql = readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8');
    return sql.slice(sql.indexOf(start), sql.indexOf(end, sql.indexOf(start)));
  };
  const input = { currentDuration: '30', currentSlot: '07:00-14:00' };
  const missing = setup({ role: 'ADMIN', results: [[{ term_contract: 'absent', standalone: false }], [{ total: 0 }], []] });
  await missing.getAdminMembers(input);
  const query = async ({ query, values }) => (await db.query(query, values)).rows;
  const probe = async () => (await query(missing.calls[0]))[0];
  async function plan(filter = input) {
    const s = setup({ role: 'ADMIN', results: [[await probe()], [{ total: 2 }], []] });
    await s.getAdminMembers(filter);
    if (!filter.reportMonth) assert.deepEqual(s.calls[1].values, s.calls[2].values.slice(0, -1), 'summary and rows share filter and clock');
    return s.calls.slice(1);
  }
  try {
    await db.exec(`
      CREATE TABLE members(id int PRIMARY KEY, member_code text, full_name text, nickname text, phone text,
        gender text, role text, status text, expire_date timestamptz, created_at timestamptz, points int);
      CREATE TABLE auth_sessions(member_id int, token_hash text, revoked_at timestamptz, expires_at timestamptz, mode text);
      CREATE TABLE package_payment_orders(id uuid PRIMARY KEY, member_id int, package_snapshot jsonb, status text,
        created_at timestamptz, confirmed_at timestamptz, paid_at timestamptz, membership_expires_at timestamptz, trans_ref text);
      CREATE TABLE package_payment_point_ledger(order_id uuid, member_id int);
      CREATE TABLE payment_transfer_refs(trans_ref text, source text);
      INSERT INTO members VALUES (99,'STAFF','Fixture',NULL,'08','OTHER','ADMIN','ACTIVE',NULL,now(),0);
      INSERT INTO auth_sessions VALUES (99,'${missing.calls[0].values[0]}',NULL,now()+interval '1 day','NORMAL');`);
    assert.equal((await probe()).standalone, false);
    await db.exec(migration('20261118_r3_package_catalog.sql', 'CREATE FUNCTION package_catalog_daily_slot_valid(', '-- Constraint names'));
    const proof = migration('20261119_r3_member_time_override.sql', 'CREATE FUNCTION r3_override_current_order(', 'CREATE FUNCTION r3_override_slot(');
    await db.exec(proof);
    await db.exec(`
      INSERT INTO members SELECT id,'BLU-'||id,'Current test',NULL,'09','OTHER','MEMBER',
        CASE WHEN id=3 THEN 'SUSPENDED' ELSE 'ACTIVE' END, NULL, '2026-12-10',0 FROM generate_series(1,12) id;
      INSERT INTO package_payment_orders SELECT md5(id::text)::uuid,id,jsonb_build_object('id',5,'label','Monthly',
        'durationDays', CASE WHEN id=10 THEN '"30"'::jsonb ELSE '30'::jsonb END,
        'timeSlot',CASE WHEN id=9 THEN '15:00-21:00' ELSE '07:00-14:00' END), 'PAID', t-interval '1 hour',t,t,t+interval '720 hours',id::text
        FROM generate_series(1,12) id CROSS JOIN LATERAL (
          SELECT now() - CASE WHEN id IN (2,6,7,8,12) THEN interval '31 days' WHEN id=11 THEN interval '-1 day' ELSE interval '1 day' END t) clock;
      UPDATE members m SET expire_date=o.membership_expires_at FROM package_payment_orders o WHERE o.member_id=m.id;
      INSERT INTO package_payment_point_ledger SELECT id,member_id FROM package_payment_orders;
      INSERT INTO payment_transfer_refs SELECT trans_ref,'PACKAGE_ORDER:'||id FROM package_payment_orders;
      INSERT INTO package_payment_orders SELECT md5('pending')::uuid,4,package_snapshot,'PENDING',now(),NULL,NULL,NULL,NULL FROM package_payment_orders WHERE member_id=4;
      INSERT INTO package_payment_orders SELECT md5('ambiguous')::uuid,5,package_snapshot,'PAID',created_at,confirmed_at,paid_at,membership_expires_at,NULL FROM package_payment_orders WHERE member_id=5;`);
    const memberCodes = rows => rows.map(row => row.memberCode).sort();
    assert.equal((await probe()).term_contract, 'absent');
    assert.deepEqual(memberCodes(await query((await plan())[1])), ['BLU-1']);
    await db.exec(migration('20261118_R6_time_supplement.sql', 'CREATE FUNCTION time_supplement_main(', 'CREATE FUNCTION time_supplement_window_end('));
    assert.equal((await probe()).term_contract, 'standalone');
    const standalonePage = (await plan())[1];
    assert.doesNotMatch(standalonePage.text, /time_supplement_main/);
    assert.deepEqual(memberCodes(await query(standalonePage)), ['BLU-1']);
    await db.exec('DROP FUNCTION public.time_supplement_main(integer,timestamptz)');
    await db.exec(`ALTER TABLE package_payment_orders ADD COLUMN amount_satang integer DEFAULT 99000;
      CREATE SCHEMA r4_staff_private; CREATE SCHEMA r4_online_private;
      CREATE TABLE r4_staff_private.free_sales(sale_id uuid, member_id int, member_code text, predecessor_order_id uuid,
        package_id int, method text, duration_days int, daily_slot text, starts_at timestamptz, ends_at timestamptz, recorded_at timestamptz);
      CREATE TABLE r4_staff_private.free_sale_cancellations(sale_id uuid);
      CREATE TABLE r4_staff_private.paid_transfer_cancellations(sale_id uuid);
      CREATE TABLE r4_online_private.cancellations(order_id uuid);`);
    assert.equal((await probe()).online_active, false);
    await db.exec(migration('20261125_R4_online_cancellation.sql', 'CREATE VIEW r4_online_private.active_paid_orders', 'CREATE VIEW r4_online_private.point_reversals'));
    await db.exec(proof.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').replace('FROM package_payment_orders x', 'FROM r4_online_private.active_paid_orders x'));
    const admission = migration('20261119_R4_staff_free_admission.sql', 'CREATE FUNCTION r4_staff_private.admission_term(', 'REVOKE ALL ON FUNCTION');
    // Apply the same narrow substitutions as the R4 cancellation and transfer migrations to this extracted function.
    await db.exec(admission.replace("source_kind:='STAFF_FREE'", 'source_kind:=f.method')
      .replaceAll('s.starts_at<=p_at AND s.ends_at>p_at', `s.starts_at<=p_at AND s.ends_at>p_at
        AND NOT EXISTS (SELECT FROM r4_staff_private.free_sale_cancellations c WHERE c.sale_id=s.sale_id)
        AND NOT EXISTS (SELECT FROM r4_staff_private.paid_transfer_cancellations c WHERE c.sale_id=s.sale_id)`)
      .replace('FROM public.package_payment_orders x', 'FROM r4_online_private.active_paid_orders x'));
    await db.exec(`INSERT INTO r4_staff_private.free_sales
      SELECT md5('sale'||m.id)::uuid,m.id,m.member_code,o.id,5,CASE WHEN m.id=6 THEN 'STAFF_FREE' ELSE 'STAFF_TRANSFER' END,
        30,'07:00-14:00',m.expire_date,m.expire_date+interval '720 hours',m.expire_date-interval '1 day'
      FROM members m JOIN package_payment_orders o ON o.member_id=m.id WHERE m.id IN (6,7,8,11,12);
      INSERT INTO r4_staff_private.free_sales SELECT md5('overlap')::uuid,member_id,member_code,predecessor_order_id,
        package_id,method,90,'15:00-21:00',starts_at,ends_at,recorded_at FROM r4_staff_private.free_sales WHERE member_id=8;
      INSERT INTO r4_staff_private.paid_transfer_cancellations VALUES (md5('sale12')::uuid);
      INSERT INTO r4_online_private.cancellations SELECT id FROM package_payment_orders WHERE member_id=1;`);
    const [summary, page] = await plan();
    assert.deepEqual(await query(summary), [{ total: 2, monthly: [{ month: '2026-12', total: 2 }] }]);
    const rows = await query(page);
    assert.deepEqual(memberCodes(rows), ['BLU-6', 'BLU-7']);
    assert.ok(rows.every(row => row.expireDate > new Date()), 'staff term supplies its own expiry');
    assert.deepEqual(memberCodes(await query((await plan({ ...input, packageLabel: 'Monthly' }))[1])), ['BLU-6', 'BLU-7']);
    assert.deepEqual(memberCodes(await query((await plan({ ...input, currentSlot: '15:00-21:00' }))[1])), ['BLU-9']);
    await db.exec(`ALTER TABLE r4_staff_private.free_sales ADD COLUMN package_name text, ADD COLUMN catalog_version integer;
      CREATE TABLE r4_online_private.settlement_before(order_id uuid, member_id int, expiry_before timestamptz, status_before text);
      CREATE TABLE r4_online_private.settlement_effects(order_id uuid, confirmed_at timestamptz, expiry_after timestamptz, amount_satang integer);
      INSERT INTO members SELECT id,'BLU-'||id,'Renewal test',NULL,'09','OTHER','MEMBER','ACTIVE',
        now()+interval '720 hours'+offset_days*interval '24 hours','2026-12-10',0 FROM (VALUES (13,-1),(14,1)) fixtures(id,offset_days);
      INSERT INTO package_payment_orders(id,member_id,package_snapshot,status,created_at,confirmed_at,paid_at,membership_expires_at)
      SELECT md5(m.id||':'||step)::uuid,m.id,'{"durationDays":30,"timeSlot":"07:00-14:00"}', 'PAID',
        now()-(40-step*30)*interval '24 hours',now()-(40-step*30)*interval '24 hours',now()-(40-step*30)*interval '24 hours',
        m.expire_date-(1-step)*interval '720 hours' FROM members m CROSS JOIN generate_series(0,1) step WHERE m.id IN (13,14);
      INSERT INTO r4_online_private.settlement_before
        SELECT id,member_id,membership_expires_at-interval '720 hours','ACTIVE' FROM package_payment_orders WHERE member_id IN (13,14);
      INSERT INTO r4_online_private.settlement_effects
        SELECT id,confirmed_at,membership_expires_at,amount_satang FROM package_payment_orders WHERE member_id IN (13,14);`);
    await db.exec(migration('20261202_R347_admission_compatibility.sql', 'CREATE FUNCTION r347_staff_package(', 'CREATE FUNCTION time_supplement_main('));
    await db.exec(migration('20261205_R36_current_term_targeting.sql', 'CREATE OR REPLACE FUNCTION time_supplement_main(', 'DO $patch$'));
    assert.equal((await probe()).term_contract, 'combined');
    const [combinedSummary, combinedPage] = await plan();
    assert.match(combinedPage.text, /public\.time_supplement_main/);
    assert.doesNotMatch(combinedPage.text, /r3_override_current_order|admission_term/);
    assert.deepEqual(await query(combinedSummary), [{ total: 3, monthly: [{ month: '2026-12', total: 3 }] }]);
    assert.deepEqual(memberCodes(await query(combinedPage)), ['BLU-13', 'BLU-6', 'BLU-7']);
    const reportMonth = missing.monthRange().month;
    const [lifecycle, ordinaryPage] = await plan({ reportMonth });
    assert.doesNotMatch(ordinaryPage.text, /time_supplement_main/, 'the report does not filter the list');
    assert.equal((await query(lifecycle))[0].nearExpiry, 4);
    const [filteredLifecycle] = await plan({ reportMonth, ...input });
    assert.equal((await query(filteredLifecycle))[0].nearExpiry, 3);
    const [, legacyMatch] = await plan({ ...input, currentSlot: '15:00-21:00' });
    assert.deepEqual(memberCodes(await query(legacyMatch)), ['BLU-9']);
    await db.exec(`CREATE OR REPLACE FUNCTION time_supplement_main(p_member integer,p_at timestamptz)
      RETURNS TABLE (order_id uuid, sale_id uuid, package_snapshot jsonb, main_end timestamptz)
      LANGUAGE sql STABLE AS $$
        SELECT md5(n::text)::uuid,NULL::uuid,jsonb_build_object('durationDays',30,'timeSlot',
          CASE WHEN n=1 THEN '07:00-14:00' ELSE '15:00-21:00' END),p_at+interval '1 day'
        FROM generate_series(1,2) n WHERE p_member=6
        UNION ALL SELECT md5(p_member::text)::uuid,NULL::uuid,'{"durationDays":30,"timeSlot":"09:00-16:00"}'::jsonb,
          p_at + CASE p_member WHEN 7 THEN interval '720 hours' WHEN 8 THEN interval '720 hours 1 second' ELSE interval '0' END
        WHERE p_member IN (7,8,10)
      $$;`);
    assert.deepEqual(await query(combinedPage), [], 'multiple candidates are ambiguous even when only one matches the selected slot');
    assert.deepEqual(await query(legacyMatch), [], 'empty combined result does not fall back to a valid standalone term');
    assert.equal((await query(lifecycle))[0].nearExpiry, 1, 'exactly 30 days qualifies; expiry now, over 30 days and ambiguous terms do not');
    await db.exec('UPDATE auth_sessions SET revoked_at=now()');
    assert.deepEqual(await query(lifecycle), []);
    await db.exec('UPDATE auth_sessions SET revoked_at=NULL');
    await db.exec(`DROP FUNCTION time_supplement_main(integer,timestamptz);
      CREATE FUNCTION time_supplement_main(integer,timestamptz) RETURNS TABLE (package_snapshot jsonb, main_end timestamptz)
      LANGUAGE sql AS $$ SELECT '{}'::jsonb, now() $$;`);
    assert.equal((await probe()).term_contract, 'unsupported');
    await db.exec('UPDATE auth_sessions SET revoked_at=now()');
    for (const call of [missing.calls[0], summary, page]) assert.deepEqual(await query(call), []);
  } finally { await db.close(); }
});

test('rendered member list keeps all filters on paging links and role changes remain OWNER-only', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const s = setup({ role: 'ADMIN', results: [[{ term_contract: 'absent', standalone: true }], [{ total: 101, monthly: [{ month: '2026-12', total: 101 }] }], [{
    memberCode: 'BLU-1', fullName: 'Fixture', phone: '099', status: 'ACTIVE', role: 'MEMBER',
  }]] });
  const data = await s.getAdminMembers({ q: 'a&b', name: 'นามสกุล', code: 'BLU', phone: '099', gender: 'OTHER',
    from: '2026-12-01', to: '2026-12-31', month: '2026-12', packageLabel: '1 เดือน', slot: '07:00-14:00',
    currentDuration: '30', currentSlot: '15:00-21:00', reportMonth: '2001-01', page: '2' });
  const filename = new URL('../app/admin/members/MembersClient.tsx', import.meta.url);
  const loaded = new Module(filename.pathname);
  loaded.require = name => {
    if (name === 'next/link') return { __esModule: true, default: function Link({ href, children }) { return React.createElement('a', { href }, children); } };
    if (name === './MemberRoleAction') return { __esModule: true, default: function RoleAction() { return React.createElement('button', null, 'ROLE_MUTATION'); } };
    if (name === './MembersExportButton') return { __esModule: true, default: function MembersExportButton() { return React.createElement('button', null, 'EXPORT_XLSX'); } };
    if (name === '@/lib/admin-members-server') return s;
    return require(name);
  };
  loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename.pathname);
  const render = data => renderToStaticMarkup(React.createElement(loaded.exports.default, { data, callerRole: 'OWNER' }));
  const html = render(data);
  assert.match(html, /<form[^>]*action="\/admin\/members"[^>]*method="get"/);
  assert.doesNotMatch(html, /name="page"|ROLE_MUTATION/);
  assert.match(html, /href="\/admin\/members">ล้างตัวกรอง/);
  assert.match(html, /2026-12: 101/);
  assert.match(html, /สรุปวงจรสมาชิก · 2001-01/);
  assert.equal(html.match(/ข้อมูลไม่พอ<\/dd>/g)?.length, 3);
  assert.match(html, /ไม่พร้อม<\/dd>/);
  assert.match(render({ ...data, lifecycle: { month: '2026-12', nearExpiry: 0, nearExpiryAsOf: '2026-12-01T00:00:00Z' } }), /0 คน<\/dd>/);
  const links = [...html.matchAll(/href="(\/admin\/members\?[^"]+)"/g)];
  assert.deepEqual(links.map(([, link]) => Object.fromEntries(new URL(link.replaceAll('&amp;', '&'), 'https://example.invalid').searchParams)),
    [{ ...data.filters, page: '1' }, { ...data.filters, page: '3' }]);
  for (const key of Object.keys(data.filters)) assert.ok(html.includes(`name="${key}"`), key);
  assert.match(render({ ...data, invalid: true }), /role="alert"/);
  assert.match(render({ ...data, callerRole: 'OWNER' }), /ROLE_MUTATION/);
});
test('missing detail returns null; detail binds member ID and limits history', async () => {
  const missing = setup();
  assert.equal(await missing.getAdminMember('not-found'), null);
  assert.equal(missing.calls.length, 1);
  const s = setup({ reads: 'true', results: [[{ id: 7, memberCode: 'BLU-7', fullName: 'Real member' }], [], [], []] });
  const data = await s.getAdminMember('BLU-7');
  assert.equal(data.member.id, undefined);
  for (const [index, call] of s.calls.slice(1).entries()) {
    assert.deepEqual(call.values.slice(3), index === 0 ? [7, 7, 0] : [7, 0]);
    assert.match(call.text, /LIMIT 101 OFFSET/);
  }
});
test('detail history SQL works before and after optional sources are installed', async () => {
  const { PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite');
  const db = new PGlite();
  const read = ({ query, values }) => db.query(query, values);
  const plan = async historySources => {
    const s = setup({ role: 'ADMIN', historySources, results: [[{ id: 7 }], [], [], []] });
    await s.getAdminMember('BLU-7');
    return { probe: s.historyProbes[0], checkins: s.calls[2], coupons: s.calls[3] };
  };
  try {
    await db.exec(`
      CREATE TABLE members(id int PRIMARY KEY, role text, status text);
      CREATE TABLE auth_sessions(member_id int, token_hash text, revoked_at timestamptz, expires_at timestamptz, mode text);
      CREATE TABLE checkins(id int PRIMARY KEY, member_id int, checkin_time timestamptz, scanner_type text);
      CREATE TABLE coupons(id int PRIMARY KEY, member_id int, title text, type text, status text,
        total_quota int, used_count int, expire_date timestamptz, created_at timestamptz, source text, activated_at timestamptz);
      INSERT INTO members VALUES(99, 'ADMIN', 'ACTIVE');
      INSERT INTO auth_sessions VALUES(99, '${createHash('sha256').update('a'.repeat(64)).digest('hex')}', NULL, now() + interval '1 hour', 'NORMAL');
      INSERT INTO checkins VALUES (1,7,'2026-11-20','USB'), (2,7,'2026-11-20','USB'), (3,7,'2026-11-20','MANUAL'), (4,8,'2026-11-20','USB'), (5,7,'2026-11-20','USB');
      INSERT INTO coupons (id,member_id,title,type,status,total_quota,used_count,created_at,source,activated_at) VALUES
       (10,7,'logged','FRIEND_PASS','AVAILABLE',3,2,'2026-11-01',NULL,NULL),
       (11,7,'welcome','FREE_ENTRY','USED',1,1,'2026-11-01','WELCOME_REGISTRATION',NULL),
       (12,7,'supplement','CUSTOM','USED',1,1,'2026-11-01','TIME_SUPPLEMENT:12',NULL),
       (13,7,'legacy','FREE_ENTRY','USED',1,1,'2026-11-01',NULL,NULL),
       (14,7,'campaign','FRIEND_PASS','AVAILABLE',1,0,'2026-11-01',NULL,'2026-11-19'),
       (15,8,'another member','FRIEND_PASS','USED',1,1,'2026-11-01',NULL,NULL);`);
    const legacy = await plan({});
    assert.deepEqual((await read(legacy.probe)).rows, [{ visits: false, consumptions: false, supplements: false }]);
    const visitFields = r => [r.id, r.exitedAt?.toISOString() ?? null, r.packageName, r.usedTimeSlot];
    assert.deepEqual((await read(legacy.checkins)).rows.map(visitFields), [[5, null, null, null], [3, null, null, null], [2, null, null, null], [1, null, null, null]]);
    assert.ok((await read(legacy.coupons)).rows.every(r => r.lastRecordedUsedAt === null));

    await db.exec(`CREATE TABLE benefit_consumptions(coupon_id int, member_id int, created_at timestamptz);
      INSERT INTO benefit_consumptions VALUES (10,7,'2026-11-20T09:00:00Z'), (10,7,'2026-11-20T12:00:00Z'), (10,8,'2026-11-21T13:00:00Z');`);
    const preR7 = await plan((await read(legacy.probe)).rows[0]);
    const times = async query => (await read(query)).rows.map(r => [r.id, r.lastRecordedUsedAt?.toISOString() ?? null]);
    assert.deepEqual(await times(preR7.coupons), [[14, null], [13, null], [12, null], [11, null], [10, '2026-11-20T12:00:00.000Z']]);
    assert.doesNotMatch(preR7.checkins.text + preR7.coupons.text, /r7_visits|time_supplement_activations/);

    await db.exec(`CREATE TABLE public.r7_visits(checkin_id int UNIQUE, member_id int, entered_at timestamptz, exited_at timestamptz, snapshot jsonb);
      INSERT INTO r7_visits VALUES
       (1,7,'2026-11-20T01:00:00Z','2026-11-20T01:30:00Z','{"package":{"name":"Historical package","amount":999},"mainTimeSlot":"07:00-14:00","usedTimeSlot":"07:00-22:00"}'),
       (2,7,'2026-11-20T02:00:00Z',NULL,'{"reason":"FREE_ENTRY","welcomeCouponId":11,"usedTimeSlot":"07:00-22:00"}'),
       (3,7,'2026-11-20T03:00:00Z','2026-11-20T04:00:00Z','{"package":{"name":5},"mainTimeSlot":"07:00-22:00","usedTimeSlot":null}'),
       (5,8,'2026-11-20T05:00:00Z','2026-11-20T06:00:00Z','{"reason":"FREE_ENTRY","welcomeCouponId":11,"usedTimeSlot":"other member"}');
      CREATE TABLE public.time_supplement_activations(coupon_id int PRIMARY KEY, member_id int, activated_at timestamptz);
      INSERT INTO time_supplement_activations VALUES (12,7,'2026-11-20T00:00:00Z');`);
    const installed = await plan((await read(legacy.probe)).rows[0]);
    const visits = (await read(installed.checkins)).rows;
    assert.deepEqual(visits.map(visitFields), [[5, null, null, null], [3, '2026-11-20T04:00:00.000Z', null, null],
      [2, null, null, '07:00-22:00'], [1, '2026-11-20T01:30:00.000Z', 'Historical package', '07:00-22:00']]);
    assert.deepEqual(Object.keys(visits[3]), ['id', 'checkinTime', 'scannerType', 'exitedAt', 'packageName', 'usedTimeSlot']);
    const checkins = visits.map(row => ({ ...row, exitedAt: row.exitedAt?.toISOString() ?? null }));
    const app = setup({ role: 'ADMIN', historySources: { visits: true }, results: [[{ id: 7 }], [], checkins, []] });
    assert.deepEqual((await app.getAdminMember('BLU-7')).checkins.rows, checkins);
    assert.deepEqual(await times(installed.coupons), [[14, null], [13, null], [12, '2026-11-20T00:00:00.000Z'], [11, '2026-11-20T02:00:00.000Z'], [10, '2026-11-20T12:00:00.000Z']]);
  } finally {
    await db.close();
  }
});

test('installed visit source read errors do not fall back to legacy history', async () => {
  const error = Object.assign(new Error('permission denied for r7_visits'), { code: '42501' });
  const s = setup({ historySources: { visits: true }, results: [[{ id: 7 }], [], [], []], beforeRead: ({ text }) => {
    if (text.includes('LEFT JOIN public.r7_visits')) throw error;
  } });
  await assert.rejects(s.getAdminMember('BLU-7'), error);
  assert.equal(s.calls.filter(call => call.text.includes('FROM checkins')).length, 1);
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
  const s = setup({ reads: 'true', results: [[{ id: 7, memberCode: 'BLU-7' }], rows, rows.slice(0, 100), []] });
  const data = await s.getAdminMember('BLU-7', { ordersPage: '2', checkinsPage: '3', couponsPage: '4' });
  assert.deepEqual(s.calls.slice(1).map(c => c.values.slice(3)), [[7, 7, 100], [7, 200], [7, 300]]);
  assert.equal(data.orders.rows.length, 100);
  assert.equal(data.orders.hasNext, true);
  assert.equal(data.orders.page, 2);
  assert.equal(data.checkins.hasNext, false);
  assert.equal(data.coupons.hasNext, false);
  assert.equal(data.coupons.page, 4);
  assert.deepEqual(data.coupons.rows, []);
  for (const call of s.calls.slice(1)) {
    assert.match(call.text, /WHERE member_id = \?/);
    assert.match(call.text, /ORDER BY .* DESC, id DESC LIMIT 101 OFFSET/);
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
test('dashboard uses R9 period metrics, non-financial member/term SQL, real checkins and owner real finance', async () => {
  const s = setup({
    results: [
      [{ checkins: 4, hasOnlineCancel: false, hasStaffSales: false, hasStaffFreeCancel: false, hasStaffPaidCancel: false }],
      [{ authOk: true, rows: [{ id: 1, memberCode: 'BLU-1', fullName: 'Fixture', status: 'ACTIVE', expireDate: '2026-11-10T00:00:00Z' }] }],
      [{ authOk: true, rows: [{ termId: 'online:1', memberId: 1, purchasedAt: '2026-10-10T10:00:00+07:00', expiresAt: '2026-11-10T10:00:00+07:00', cancelledAt: null, sourceKind: 'ONLINE_PAID' }] }],
      [{ authOk: true, rows: [] }],
    ],
    financeData: {
      records: [
        { id: '1', date: '2026-10-10', type: 'INCOME', category: 'แพ็กเกจ', amount: 123.45, note: 'Online', source: 'MEMBERSHIP', createdAt: '2026-10-10T00:00:00Z', version: 0, memberCode: 'BLU-1', memberName: 'Fixture' },
        { id: '2', date: '2026-10-12', type: 'EXPENSE', category: 'เงินเดือน', amount: 23.45, note: 'Pay', source: 'MANUAL', createdAt: '2026-10-12T00:00:00Z', version: 1 },
      ],
      audit: [{ secret: 'DO_NOT_EXPOSE' }],
      unconfirmedPaidCount: 0,
    },
  });
  const data = await s.getAdminDashboard('2026-10', new Date('2026-11-21T08:00:00Z'));
  assert.equal(data.callerRole, 'OWNER');
  assert.equal(s.financeReads(), 1);
  assert.equal(data.summary.totalPurchasedMembers, 1);
  assert.equal(data.summary.newInPeriod, 1);
  assert.equal(data.summary.checkins, 4);
  assert.deepEqual(data.finance.period, { income: 123.45, expense: 23.45, net: 100 });
  assert.equal(data.finance.monthlyChart.length, 12);
  assert.equal(data.finance.dailyChart.length, 31);
  assert.doesNotMatch(JSON.stringify(data), /DO_NOT_EXPOSE/);
  assert.match(s.calls[0].text, /count\(\*\)::int FROM checkins/);
  assert.match(s.calls[2].text, /package_payment_orders/);
  assert.doesNotMatch(s.calls.map(c => c.text).join(''), /amount_satang|paid_at|refund_satang|INSERT|UPDATE|DELETE/i);
});
test('direct finance URLs and API/export deny ADMIN/MEMBER and invalid persisted sessions before finance SQL', async () => {
  for (const options of [
    { role: 'ADMIN' }, { role: 'MEMBER' }, { state: { cookie: null } },
    { state: { session: { revokedAt: new Date() } } },
    { state: { session: { expiresAt: new Date(0) } } },
    { state: { session: { mode: 'KIOSK' } } },
    { state: { member: { status: 'SUSPENDED' } } },
  ]) {
    const s = setup(options);
    for (const path of ['/admin/finance', '/admin/finance/export']) {
      await assert.rejects(s.load('./admin-permissions-server.ts').requireAdminPage(path), /redirect/);
    }
    const api = s.load('../app/api/admin/finance/[action]/route.ts');
    for (const action of ['read', 'create', 'update', 'delete']) {
      const method = action === 'read' ? 'GET' : 'POST';
      const response = await api[method](new Request(`https://example.test/api/admin/finance/${action}`, { method }), { params: Promise.resolve({ action }) });
      assert.ok([401, 403].includes(response.status));
    }
    const exported = await s.load('../app/api/admin/finance/export/route.ts').GET(new Request('https://example.test/api/admin/finance/export?from=2026-10-01&to=2026-10-31'));
    assert.ok([401, 403].includes(exported.status));
    assert.equal(s.calls.length, 0);
  }
});
test('dashboard ADMIN skips all financial SQL and allowlists every payload level', async () => {
  const secret = { paidSatang: '987654', paidOrders: 42, amountSatang: 987654, paidAt: 'secret', provider: 'secret', tokenHash: 'secret' };
  const s = setup({
    role: 'ADMIN',
    financeData: { records: [{ id: '1', date: '2026-10-01', type: 'INCOME', category: 'แพ็กเกจ', amount: 9876.54, note: 'secret', source: 'MEMBERSHIP', createdAt: '2026-10-01', version: 0 }], audit: [] },
    results: [
      [{ checkins: 4, hasOnlineCancel: false, hasStaffSales: false, hasStaffFreeCancel: false, hasStaffPaidCancel: false, ...secret }],
      [{ authOk: true, rows: [{ id: 1, memberCode: 'BLU-1', fullName: 'fixture', status: 'ACTIVE', expireDate: '2026-10-02', ...secret }] }],
      [{ authOk: true, rows: [{ termId: 't1', memberId: 1, purchasedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-15T00:00:00Z', cancelledAt: null, sourceKind: 'ONLINE_PAID', ...secret }] }],
      [{ authOk: true, rows: [{ id: 1, memberCode: 'BLU-1', fullName: 'fixture', checkinTime: '2026-10-01', ...secret }] }],
    ],
  });
  const data = await s.getAdminDashboard('2026-10', new Date('2026-11-21T08:00:00Z'));
  assert.equal(data.callerRole, 'ADMIN');
  assert.equal(s.financeReads(), 0);
  assert.equal(Object.hasOwn(data, 'finance'), false);
  assert.equal(Object.hasOwn(data, 'sales'), false);
  assert.doesNotMatch(JSON.stringify(data), /paidSatang|paidOrders|amountSatang|paidAt|provider|tokenHash|987654|9876\.54/);
  assert.equal(s.calls.length, 4);
  assert.doesNotMatch(s.calls.map(c => c.text).join(''), /amount_satang|paid_at|refund_satang|finance_entries|real_finance_action/);
  assert.deepEqual(s.guards, ['/admin']);
});
test('dashboard fails closed when persisted authorization changes after page guard', async () => {
  for (const change of [
    ({ session }) => { session.revokedAt = new Date(); },
    ({ session }) => { session.mode = 'KIOSK'; },
    ({ session }) => { session.expiresAt = new Date(0); },
    ({ member }) => { member.status = 'SUSPENDED'; },
    ({ member }) => { member.role = 'MEMBER'; },
    ({ member }) => { member.role = 'ADMIN'; },
  ]) {
    const s = setup({ results: [[{ checkins: 1 }]], beforeRead: change });
    await assert.rejects(s.getAdminDashboard(), /Forbidden/);
  }
  const midFlight = setup({
    results: [[{ checkins: 1 }], [{ authOk: true, rows: [] }], [{ authOk: true, rows: [] }], [{ authOk: true, rows: [] }]],
    beforeRead: ({ index, session }) => { if (index === 1) session.revokedAt = new Date(); },
  });
  await assert.rejects(midFlight.getAdminDashboard(), /Forbidden/);
});
test('rendered dashboard ADMIN has no finance/money; OWNER renders R9 charts and finance', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const chartsFile = new URL('../components/AdminDashboardCharts.tsx', import.meta.url);
  const chartsMod = new Module(chartsFile.pathname);
  chartsMod.require = require;
  chartsMod._compile(ts.transpileModule(readFileSync(chartsFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, chartsFile.pathname);
  const filename = new URL('../app/admin/DashboardClient.tsx', import.meta.url), loaded = new Module(filename.pathname);
  loaded.require = name => {
    if (name === 'next/link') return { __esModule: true, default: ({ children, href }) => React.createElement('a', { href }, children) };
    if (name === '@/components/AdminDashboardCharts') return chartsMod.exports;
    return require(name);
  };
  loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename.pathname);
  for (const role of ['ADMIN', 'OWNER']) {
    const s = setup({
      role,
      results: [
        [{ checkins: 4, hasOnlineCancel: false, hasStaffSales: false, hasStaffFreeCancel: false, hasStaffPaidCancel: false }],
        [{ authOk: true, rows: [] }],
        [{ authOk: true, rows: [] }],
        [{ authOk: true, rows: [] }],
      ],
      financeData: {
        records: [{ id: 'f1', date: '2026-10-05', type: 'INCOME', category: 'แพ็กเกจ', amount: 123.45, note: 'test', source: 'MEMBERSHIP', createdAt: '2026-10-05T00:00:00Z', version: 0 }],
        audit: [],
        unconfirmedPaidCount: 0,
      },
    });
    const data = await s.getAdminDashboard('2026-10', new Date('2026-11-21T08:00:00Z'));
    const html = renderToStaticMarkup(React.createElement(loaded.exports.default, { data }));
    assert.match(html, /สมาชิกทั้งหมดที่เคยซื้อ/);
    assert.match(html, /สถานะสมาชิก ณ วันที่รายงาน/);
    assert.match(html, /ความเคลื่อนไหวสมาชิก/);
    if (role === 'ADMIN') assert.doesNotMatch(html, /฿|รายรับ|รายจ่าย|สุทธิ|ภาพรวมการเงิน|123\.45|PAID/);
    else {
      assert.match(html, /ภาพรวมการเงิน/);
      assert.match(html, /123\.45 ฿/);
      assert.match(html, /รายรับ \/ รายจ่าย \/ สุทธิ รายเดือน/);
    }
  }
});
test('native PostgreSQL executes actual dashboard statements and denies stale persisted sessions', { skip: process.env.R2_NATIVE_POSTGRES !== '1' }, async () => {
  const queries = [];
  for (const role of ['ADMIN', 'OWNER']) {
    const s = setup({
      role,
      results: [
        [{ checkins: 1, hasOnlineCancel: false, hasStaffSales: false, hasStaffFreeCancel: false, hasStaffPaidCancel: false }],
        [{ authOk: true, rows: [] }],
        [{ authOk: true, rows: [] }],
        [{ authOk: true, rows: [] }],
      ],
    });
    await s.getAdminDashboard('2026-10');
    queries.push({ role, calls: s.calls });
  }
  const result = spawnSync('python', ['-c', String.raw`
import json, os, socket, subprocess, sys, tempfile
from pathlib import Path
root=Path.cwd()
here=root/'.local-db/portable-postgres-uat'
bin=here/'package/native/bin'
assert (bin/'initdb.exe').exists(), 'native PostgreSQL unavailable'
env={k:v for k,v in os.environ.items() if not k.startswith('PG') and k!='DATABASE_URL'}
env['PATH']=str(here)+os.pathsep+str(bin)+os.pathsep+env.get('PATH','')
env['PYTHONIOENCODING']='utf-8'
queries=json.load(sys.stdin)
with socket.socket() as sock:
 sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='blu-r2-dashboard-') as tmp:
 data=Path(tmp)/'data'
 def run(args, text=None):
  r=subprocess.run([str(a) for a in args],input=text,capture_output=True,text=True,encoding='utf-8',env=env,timeout=40)
  assert r.returncode==0, r.stdout+r.stderr
  return r.stdout.strip()
 run([bin/'initdb.exe','-D',data,'-U','postgres','--auth-local=reject','--auth-host=trust','--encoding=UTF8','--locale=C'])
 (data/'postgresql.conf').write_text("listen_addresses='127.0.0.1'\nport="+str(port)+'\n',encoding='utf-8')
 try:
  with (Path(tmp)/'pg_ctl.log').open('w') as log:
   started=subprocess.run([str(a) for a in [bin/'pg_ctl.exe','-D',data,'-l',Path(tmp)/'server.log','-w','-t','20','start']],stdin=subprocess.DEVNULL,stdout=log,stderr=log,env=env,timeout=30)
   assert started.returncode==0, 'native PostgreSQL startup failed'
  client=[sys.executable,here/'psql.py','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres']
  def sql(text): return run(client,text)
  sql('''CREATE TABLE members(id int, member_code text, full_name text, role text, status text, expire_date timestamptz, created_at timestamptz);
CREATE TABLE auth_sessions(member_id int, token_hash text, revoked_at timestamptz, expires_at timestamptz, mode text);
CREATE TABLE checkins(id int, member_id int, checkin_time timestamptz);
CREATE TABLE package_payment_orders(id text, member_id int, package_snapshot jsonb, amount_satang int, status text, created_at timestamptz, confirmed_at timestamptz, paid_at timestamptz, membership_expires_at timestamptz);
INSERT INTO members VALUES(99,'FIXTURE','fixture','OWNER','ACTIVE',now()+interval '1 day','2026-10-01');
INSERT INTO checkins VALUES(1,99,'2026-10-01');
INSERT INTO package_payment_orders VALUES('fixture',99,'{"name":"fixture"}',12345,'PAID','2026-10-01','2026-10-01','2026-10-01','2026-11-01');''')
  def literal(value): return "'"+str(value).replace("'","''")+"'"
  count=0
  for group in queries:
   role=group['role']; digest=group['calls'][0]['values'][0]
   sql("UPDATE members SET role="+literal(role)+",status='ACTIVE'; DELETE FROM auth_sessions; INSERT INTO auth_sessions VALUES(99,"+literal(digest)+",NULL,now()+interval '1 day','NORMAL');")
   statements=[]
   for call in group['calls']:
    parts=call['text'].split('?'); statement=parts[0]
    for value,part in zip(call['values'],parts[1:]): statement+=literal(value)+part
    statements.append(statement)
    rows=json.loads(sql('SELECT coalesce(json_agg(r),\'[]\'::json) FROM ('+statement+') r;'))
    assert len(rows)==1, 'live authorized query must return fixture'
    if role=='ADMIN': assert not any(k in json.dumps(rows) for k in ['amountSatang','paidSatang','paidOrders','paidAt'])
    count+=1
   for mutation in ["UPDATE auth_sessions SET revoked_at=now()", "UPDATE auth_sessions SET expires_at=now()-interval '1 day'", "UPDATE auth_sessions SET mode='KIOSK'", "UPDATE auth_sessions SET token_hash='other'", "UPDATE members SET status='SUSPENDED'", "UPDATE members SET role='MEMBER'", "UPDATE members SET role="+literal('ADMIN' if role=='OWNER' else 'OWNER')]:
    sql("UPDATE members SET role="+literal(role)+",status='ACTIVE'; UPDATE auth_sessions SET token_hash="+literal(digest)+",revoked_at=NULL,expires_at=now()+interval '1 day',mode='NORMAL'; "+mutation+';')
    for statement in statements:
     rows=json.loads(sql('SELECT coalesce(json_agg(r),\'[]\'::json) FROM ('+statement+') r;'))
     assert rows==[], 'stale persisted authorization leaked data'
     count+=1
  print('PASS native PostgreSQL actual dashboard statements:',count,'checks; isolated fixtures only')
 finally:
  run([bin/'pg_ctl.exe','-D',data,'-m','immediate','-w','-t','20','stop'])
`], { input: JSON.stringify(queries), encoding: 'utf8', timeout: 240000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  console.log(result.stdout.trim());
});
test('native PostgreSQL executes member filters against Bangkok boundaries and same-order evidence', { skip: process.env.R8_NATIVE_POSTGRES !== '1' }, async () => {
  const s = setup({ role: 'ADMIN', results: [[{ total: 1 }], []] });
  await s.getAdminMembers({ q: 'BLU', name: 'Surname', gender: 'FEMALE', code: 'BLU-', phone: '09',
    month: '2026-12', from: '2026-12-01', to: '2026-12-31', packageLabel: 'Monthly', slot: '07:00-14:00' });
  const result = spawnSync('python', ['-c', String.raw`
import json, os, socket, subprocess, sys, tempfile
from pathlib import Path
here=Path.cwd()/'.local-db/portable-postgres-uat'
bin=here/'package/native/bin'
env={k:v for k,v in os.environ.items() if not k.startswith('PG') and k!='DATABASE_URL'}
env.update(PATH=str(here)+os.pathsep+str(bin)+os.pathsep+env.get('PATH',''), PYTHONIOENCODING='utf-8')
calls=json.load(sys.stdin)
with socket.socket() as sock:
 sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='blu-r8-members-') as tmp:
 data=Path(tmp)/'data'
 def run(args, text=None):
  r=subprocess.run([str(a) for a in args],input=text,capture_output=True,text=True,encoding='utf-8',env=env,timeout=40)
  assert r.returncode==0, r.stdout+r.stderr
  return r.stdout.strip()
 run([bin/'initdb.exe','-D',data,'-U','postgres','--auth-local=reject','--auth-host=trust','--encoding=UTF8','--locale=C'])
 (data/'postgresql.conf').write_text("listen_addresses='127.0.0.1'\nport="+str(port)+'\n',encoding='utf-8')
 try:
  # Do not let a detached Windows postgres process inherit captured pipes.
  with (Path(tmp)/'pg_ctl.log').open('w') as log:
   started=subprocess.run([str(a) for a in [bin/'pg_ctl.exe','-D',data,'-l',Path(tmp)/'server.log','-w','-t','20','start']],stdin=subprocess.DEVNULL,stdout=log,stderr=log,env=env,timeout=30)
  assert started.returncode==0, (Path(tmp)/'pg_ctl.log').read_text(errors='replace')
  client=[sys.executable,here/'psql.py','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres']
  def sql(text): return run(client,text)
  def literal(value): return "'"+str(value).replace("'","''")+"'"
  sql('''CREATE TYPE profile_gender AS ENUM ('MALE','FEMALE','OTHER');
CREATE TABLE members(id int, member_code text, full_name text, nickname text, phone text, gender profile_gender, role text, status text, expire_date timestamptz, created_at timestamptz, points int);
CREATE TABLE auth_sessions(member_id int, token_hash text, revoked_at timestamptz, expires_at timestamptz, mode text);
CREATE TABLE package_payment_orders(member_id int, package_snapshot jsonb, status text);
INSERT INTO members VALUES (99,'STAFF','Fixture',NULL,'08','OTHER','ADMIN','ACTIVE',NULL,now(),0);
INSERT INTO auth_sessions VALUES (99,'''+literal(calls[0]['values'][0])+''',NULL,now()+interval '1 day','NORMAL');
INSERT INTO members SELECT id,'BLU-'||id,'Full Surname',NULL,'09'||id,'FEMALE','MEMBER','ACTIVE',NULL,created_at::timestamptz,0 FROM (VALUES
 (1,'2026-11-30 17:00:00+00'), (2,'2026-12-31 16:59:59+00'), (3,'2026-12-31 17:00:00+00'), (4,'2026-11-30 16:59:59+00'),
 (5,'2026-12-15 12:00:00+00'), (6,'2026-12-16 00:00:00+00'), (7,'2026-12-17 00:00:00+00')) fixture(id,created_at);
INSERT INTO package_payment_orders SELECT id,'{"label":"Monthly","timeSlot":"07:00-14:00"}', 'PAID' FROM generate_series(1,4) AS id;
INSERT INTO package_payment_orders VALUES (2,'{"label":"Monthly","timeSlot":"07:00-14:00"}','PAID'),
 (5,'{"label":"Monthly","timeSlot":"07:00-22:00"}','PAID'),(5,'{"label":"Daily","timeSlot":"07:00-14:00"}','PAID'),
 (6,'{"label":"Monthly","timeSlot":"07:00-14:00"}','PENDING');''')
  def execute(call):
   pieces=call['text'].split('?'); assert len(pieces)==len(call['values'])+1
   statement=pieces[0]+''.join(literal(value)+part for value,part in zip(call['values'],pieces[1:]))
   return json.loads(sql("SET TIME ZONE 'America/New_York'; SELECT coalesce(json_agg(r),'[]'::json) FROM ("+statement+") r;"))
  assert execute(calls[0])==[{'total':2,'monthly':[{'month':'2026-12','total':2}]}]
  assert [row['memberCode'] for row in execute(calls[1])]==['BLU-2','BLU-1']
  sql("UPDATE auth_sessions SET revoked_at=now()")
  assert all(execute(call)==[] for call in calls), 'revoked session leaked list data'
 finally:
  run([bin/'pg_ctl.exe','-D',data,'-m','immediate','-w','-t','20','stop'])
`], { input: JSON.stringify(s.calls), encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('DB failures propagate instead of replacing real data with mocks or empty success', async () => {
  const s = setup({ fail: true });
  await assert.rejects(s.getAdminMembers(), /database unavailable/);
  const missing = Object.assign(new Error('R4 object unavailable'), { code: '42883' });
  const enabled = setup({ reads: 'true', results: [[{ total: 1 }]], beforeRead: ({ index }) => { if (index === 1) throw missing; } });
  await assert.rejects(enabled.getAdminMembers(), { code: '42883' });
  assert.equal(enabled.calls.length, 2, 'R4 failure does not retry with legacy SQL');
  assert.match(enabled.calls[1].text, /r4_staff_private\.paid_active_expiry/);
});
test('rendered member detail omits ADMIN money and role controls; OWNER money handles null safely', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const filename = new URL('../app/admin/members/[memberCode]/MemberDetailClient.tsx', import.meta.url);
  const loaded = new Module(filename.pathname);
  loaded.require = name => {
    if (name === 'next/link') return { __esModule: true, default: ({ children }) => React.createElement('a', null, children) };
    if (name === '@/lib/admin-members-server') return { currentStatus: m => m.status };
    if (name === './OnlineCancellationControls') return () => React.createElement('button', null, 'ONLINE_CANCEL');
    if (name === '../MemberRoleAction') return { __esModule: true, default: () => React.createElement('button', null, 'ROLE_MUTATION') };
    return require(name);
  };
  loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename.pathname);
  for (const role of ['ADMIN', 'OWNER']) {
    const data = { callerRole: role, member: { memberCode: 'BLU-7', fullName: 'Fixture', phone: 'fixture', status: 'ACTIVE', role: 'MEMBER', points: 0 }, asOf: Date.now(),
      orders: { rows: [{ id: 'order', status: 'PAID', packageName: 'Package', amountSatang: 1234500 }, { id: 'null', amountSatang: null }], page: 2, hasNext: true },
      checkins: { rows: [], page: 1, hasNext: false }, coupons: { rows: [], page: 1, hasNext: false } };
    // Even a forged callerRole prop must not open columns for an ADMIN payload.
    const html = renderToStaticMarkup(React.createElement(loaded.exports.default, { data, callerRole: 'OWNER', onlineCancellationEnabled: true }));
    assert.match(html, /ถัดไป/);
    assert.match(html, /ก่อนหน้า/);
    assert.doesNotMatch(html, /NaN/);
    if (role === 'ADMIN') assert.doesNotMatch(html, /12,345|>ยอด<|ชำระเมื่อ|ROLE_MUTATION|ONLINE_CANCEL/);
    else { assert.match(html, /12,345/); assert.match(html, /ONLINE_CANCEL/); }
  }
});
test('owned screens have no mock stores, password/payment mutation, or client-side auth', () => {
  for (const path of ['../app/admin/DashboardClient.tsx', '../app/admin/members/MembersClient.tsx', '../app/admin/members/[memberCode]/MemberDetailClient.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|admin-mock|admin-dashboard-mock|purchaseMockPackage|setAdminMemberPassword|saveAdminMemberProfile|readBenefits|"use client"/);
  }
});

test('online cancellation is visible as historical PAID to ADMIN without refund money or attestations', async () => {
  const cancelledAt = '2026-11-25T09:00:00+00:00';
  const s = setup({ role: 'ADMIN', onlineReads: true, results: [[{ id: 7 }], [{
    status: 'PAID', cancelledAt, refundSatang: 90000, amountSatang: 90000, reason: 'private',
  }], [], []] });
  const { orders } = await s.getAdminMember('BLU-7');
  assert.equal(orders.rows[0].status, 'PAID');
  assert.equal(orders.rows[0].cancelledAt, cancelledAt);
  assert.doesNotMatch(JSON.stringify(orders), /amount|refund|private/);
  assert.match(s.calls[1].text, /SELECT order_id, cancelled_at FROM r4_online_private\.cancellations/);
  assert.doesNotMatch(s.calls[1].text, /amount_satang|refund_satang|reason|paid_at/);
});
