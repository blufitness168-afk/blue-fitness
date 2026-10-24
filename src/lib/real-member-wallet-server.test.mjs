import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load({ member = { id: 42 }, data, fail = false, missing = false } = {}) {
  const calls = [];
  const file = new URL('./real-member-wallet-server.ts', import.meta.url);
  const loaded = new Module(file.pathname);
  loaded.require = name => {
    if (name === 'server-only') return {};
    if (name === './auth/server') return { getCurrentMember: async () => member };
    if (name === './auth/http') return { json: (body, status = 200) => ({ body, status }) };
    if (name === '@neondatabase/serverless') return { neon: () => async (parts, ...values) => {
      calls.push({ text: parts.join('?'), values });
      if (fail) throw new Error('secret DB URL and SQL details');
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
  const s = load({ data });
  const response = await s.run();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, data);
  assert.equal(s.calls.length, 1);
  const { text, values } = s.calls[0];
  assert.deepEqual(values, [42]);
  assert.equal((text.match(/member_id = m.id/g) || []).length, 5);
  assert.match(text, /status = 'PAID'/);
  assert.match(text, /FROM checkins/);
  assert.match(text, /FROM coupons/);
  assert.match(text, /FROM package_payment_point_ledger/);
  assert.match(text, /UNION ALL[\s\S]*FROM reward_point_spend_ledger/);
  assert.match(text, /m.status <> 'SUSPENDED'/);
  assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i);
  assert.equal((text.match(/LIMIT 100/g) || []).length, 4);
});
test('genuinely empty DB histories remain empty without fabricated grants or points', async () => {
  const data = { points: 0, status: 'PENDING', expiresAt: null, purchases: [], checkins: [], coupons: [], pointLedger: [] };
  assert.deepEqual((await load({ data }).run()).body.data, data);
});
test('missing migrations/database fail closed, no success with synthetic empty wallet or leaked details', async () => {
  const response = await load({ fail: true }).run();
  assert.equal(response.status, 503);
  assert.equal(response.body.data, undefined);
  assert.doesNotMatch(JSON.stringify(response), /secret DB/);
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
