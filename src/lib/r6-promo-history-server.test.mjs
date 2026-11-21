import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const source = compile('./r6-promo-history-server.ts');
const promo = { exports: {} };
vm.runInNewContext(compile('./r6-promo-history.ts'), promo);
function setup(role, error) {
  const calls = [], exports = {};
  vm.runInNewContext(source, { exports, URL, process: { env: { DATABASE_URL: 'mock-only' } }, require: name => {
    if (name === 'server-only') return {};
    if (name === './auth/server') return { getCurrentMember: async () => role ? { role, status: 'ACTIVE' } : null, SESSION_COOKIE: 'blu_session' };
    if (name === 'next/headers') return { cookies: async () => ({ get: () => ({ value: 'a'.repeat(64) }) }) };
    if (name === './auth/http') return { json: (data, status = 200) => ({ data, status }) };
    if (name === './r6-coupon-history') return { couponGroups: { '30': '30 days' } };
    if (name === './r6-promo-history') return promo.exports;
    if (name === '@neondatabase/serverless') return { neon: () => async (parts, ...values) => {
      calls.push({ sql: parts.join('?'), values });
      if (error) throw Object.assign(Error('private'), { code: error });
      return [{ data: { rows: [], nextBefore: null } }];
    } };
    return require(name);
  } });
  return { calls, history: (query, staff = false) => exports.promoHistory(new Request(`https://isolated.test/history?${query}`), staff) };
}

test('promo history ACL, strict filters, normalized code and ownership-bound member feed', async () => {
  assert.equal((await setup(null).history('')).status, 401);
  const member = setup('MEMBER');
  assert.equal((await member.history('', true)).status, 403);
  for (const query of ['memberCode=BLU-2', 'days=31', 'before=2147483648', 'code=bad%20code', 'code=ONE&code=TWO', 'status=PENDING']) {
    assert.equal((await member.history(query)).status, 400, query);
  }
  assert.equal(member.calls.length, 0);
  assert.equal((await member.history('code=save5&status=USED&days=30&before=70')).status, 200);
  const digest = createHash('sha256').update('a'.repeat(64)).digest('hex');
  assert.deepEqual(member.calls[0].values, [digest, false, 70, null, null, 'SAVE5', 'USED', 30]);
  const admin = setup('ADMIN');
  assert.equal((await admin.history('memberCode=BLU-7&name=Offer', true)).status, 200);
  assert.deepEqual(admin.calls[0].values, [digest, true, null, 'BLU-7', 'Offer', null, null, null]);
  assert.equal((await setup('OWNER', '42883').history('', true)).data.notInstalled, true);
  assert.equal((await setup('OWNER', '42501').history('', true)).status, 403);
});
