import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { NeonQueryPromise, SqlTemplate } from '@neondatabase/serverless';
const require = createRequire(import.meta.url);
const rolloutSource = ts.transpileModule(readFileSync(new URL('./staff-paid-rollout-server.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function load({ member = { id: 42 }, data, fail, missing = false, reads, onlineReads = false } = {}) {
  const rollout = {};
  runInNewContext(rolloutSource, { exports: rollout, require: () => ({}), process: { env: { ENABLE_STAFF_PAID_READS: reads } } });
  const calls = [];
  const file = new URL('./real-member-wallet-server.ts', import.meta.url);
  const loaded = new Module(file.pathname);
  loaded.require = name => {
    if (name === 'server-only') return {};
    if (name === './staff-paid-rollout-server') return rollout;
    if (name === './online-cancellation-rollout-server') return { onlineCancellationReads: async () => onlineReads };
    if (name === './auth/server') return { getCurrentMember: async () => member };
    if (name === './auth/http') return { json: (body, status = 200) => ({ body, status }) };
    if (name === '@neondatabase/serverless') return { neon: () => (parts, ...args) => {
      if (!parts[0].includes('SELECT jsonb_build_object')) {
        return new NeonQueryPromise(async () => { throw new Error('Unexpected standalone SQL'); }, new SqlTemplate(parts, args));
      }
      const { query: text, params: values } = new SqlTemplate(parts, args).toParameterizedQuery();
      calls.push({ text, values });
      if (fail) throw Object.assign(new Error('secret DB URL and SQL details'), { code: fail });
      return missing ? [] : [{ data }];
    } };
    return require(name);
  };
  loaded._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file.pathname);
  return { run: async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'test-stub-no-network';
    try { return await loaded.exports.getRealMemberWallet(); }
    finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
  }, calls };
}
test('unauthenticated normal/kiosk-excluded session cannot query wallet', async () => {
  const s = load({ member: null });
  assert.equal((await s.run()).status, 401);
  assert.equal(s.calls.length, 0);
});
test('single read-only snapshot binds authenticated member and scopes every history', async () => {
  const data = { points: 735, status: 'ACTIVE', expiresAt: null, purchases: [{ id: 'paid-order', amountSatang: 20000 }], checkins: [{ id: 9 }], coupons: [{ id: 12 }], pointLedger: [{ delta: -5 }] };
  const s = load({ data, reads: 'true' });
  const response = await s.run();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, data);
  assert.equal(s.calls.length, 1);
  const { text, values } = s.calls[0];
  assert.deepEqual(values, [42]);
  assert.equal((text.match(/member_id = m.id/g) || []).length, 7);
  assert.match(text, /FROM r4_staff_private\.paid_history WHERE member_id = m.id/);
  assert.match(text, /FROM r4_staff_private\.paid_point_ledger WHERE member_id = m.id/);
  assert.match(text, /r4_staff_private\.paid_active_expiry\(m.id, now\(\)\)/);
  assert.match(text, /status = 'PAID'/);
  assert.match(text, /FROM checkins/);
  assert.match(text, /FROM coupons/);
  assert.match(text, /FROM package_payment_point_ledger/);
  assert.match(text, /UNION ALL[\s\S]*FROM reward_point_spend_ledger/);
  assert.match(text, /m.status <> 'SUSPENDED'/);
  assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i);
  assert.equal((text.match(/LIMIT 100/g) || []).length, 4);
});
test('default-off wallet reads one legacy snapshot with no R4 dependencies', async () => {
  const data = { points: 20, status: 'ACTIVE', expiresAt: '2026-12-01', purchases: [{ id: 'online-order' }], checkins: [], coupons: [], pointLedger: [{ id: 'payment:order' }, { id: 'reward:redemption' }] };
  for (const reads of [undefined, '1', 'false']) {
    const s = load({ data, reads });
    assert.deepEqual(await s.run(), { body: { data }, status: 200 });
    assert.equal(s.calls.length, 1);
    const { text, values } = s.calls[0];
    assert.deepEqual(values, [42]);
    assert.doesNotMatch(text, /r4_staff_private|paid\.expiry|STAFF_TRANSFER|cancelledAt|startsAt|ONLINE_PAID/);
    assert.match(text, /'expiresAt', m\.expire_date/);
    assert.match(text, /m\.expire_date IS NULL OR m\.expire_date <= now\(\)/);
    assert.match(text, /FROM package_payment_orders WHERE member_id = m.id AND status = 'PAID'/);
    assert.match(text, /FROM package_payment_point_ledger WHERE member_id = m.id[\s\S]*UNION ALL[\s\S]*FROM reward_point_spend_ledger WHERE member_id = m.id/);
    assert.equal((text.match(/member_id = m.id/g) || []).length, 5);
    assert.equal((text.match(/LIMIT 100/g) || []).length, 4);
    assert.match(text, /WHERE m.id = \$1 AND m.status <> 'SUSPENDED'/);
  }
});
test('genuinely empty DB histories remain empty without fabricated grants or points', async () => {
  const data = { points: 0, status: 'PENDING', expiresAt: null, purchases: [], checkins: [], coupons: [], pointLedger: [] };
  assert.deepEqual((await load({ data }).run()).body.data, data);
});
test('missing migrations/database fail closed, no success with synthetic empty wallet or leaked details', async () => {
  for (const [reads, fail] of [[undefined, '08006'], ['true', '42P01'], ['true', '42501']]) {
    const s = load({ reads, fail });
    const response = await s.run();
    assert.equal(response.status, 503);
    assert.equal(response.body.data, undefined);
    assert.doesNotMatch(JSON.stringify(response), /secret DB/);
    assert.equal(s.calls.length, 1, 'failed reads do not retry using another query');
  }
  assert.equal((await load({ missing: true }).run()).status, 401);
});
test('Account has no mock imports, browser persistence or fake redemption flow; real profile preserved', () => {
  const source = readFileSync(new URL('../app/member/AccountClient.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|mock-data|admin-mock|reward-catalog|member-account|readBenefits|readMembership|123456|requestMockReward/);
  assert.match(source, /fetch\("\/api\/member\/wallet"/);
  assert.match(source, /fetch\("\/api\/member\/profile"/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /href="\/member\/rewards"/);
  assert.match(source, /<WelcomeCoupons key=\{identity.id\} coupons=\{welcomeCoupons\}/);
  assert.match(source, /value=\{draft.phone\} readOnly/);
});

test('wallet keeps the original purchase/award and adds source-linked cancellation metadata and negative ledger rows', async () => {
  for (const reads of [undefined, 'true']) {
    const data = { points: 2, purchases: [{ id: 'online', cancelledAt: '2026-11-26', refundSatang: 90000 }],
      pointLedger: [{ delta: -4, balanceAfter: 2 }, { delta: 4, balanceAfter: 6 }] };
    const s = load({ data, reads, onlineReads: true });
    assert.deepEqual((await s.run()).body.data, data);
    assert.equal(s.calls.length, 1);
    const { text, values } = s.calls[0];
    assert.deepEqual(values, [42]);
    assert.match(text, /LEFT JOIN r4_online_private\.cancellations c ON c.order_id = o.id/);
    assert.match(text, /o.member_id = m.id AND o.status = 'PAID'/);
    assert.match(text, /c.refund_satang AS "refundSatang"/);
    assert.match(text, /FROM package_payment_point_ledger[\s\S]+UNION ALL[\s\S]+FROM r4_online_private\.point_reversals WHERE member_id = m.id/);
    assert.equal(text.includes('NULL::integer'), reads === 'true');
  }
});
