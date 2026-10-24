import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function compile(name, mocks) {
  const file = new URL(name, import.meta.url);
  const loaded = new Module(file.pathname);
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  loaded._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file.pathname);
  return loaded.exports;
}
const registration = compile('./auth/registration.ts', {});
const valid = { fullName: ' Test Member ', nickname: 'Nick', gender: 'OTHER', birthDay: 29, birthMonth: 2, emergencyName: '', emergencyPhone: '0812345678', emergencyRelation: '' };
function setup({ member = { id: 17, ...valid }, fail = false, rows = [valid] } = {}) {
  const calls = [];
  const columns = new Proxy({}, { get: (_, key) => key });
  const server = compile('./member-profile-server.ts', {
    'server-only': {}, '@/db/schema': { members: columns },
    '@/db': { db: { update: () => ({ set: data => { calls.push({ data }); return { where: condition => { calls[0].condition = condition; return { returning: async () => { if (fail) throw new Error('private database error'); return rows; } }; } }; } }) } },
    'drizzle-orm': { eq: (...args) => ['eq', ...args], ne: (...args) => ['ne', ...args], and: (...args) => args },
    './auth/server': { getCurrentMember: async () => member },
    './auth/http': { json: (body, status = 200) => ({ body, status }), readBody: async request => { try { return await request.json(); } catch { return null; } } },
    './auth/registration': registration,
  });
  const update = body => server.updateMemberProfile(new Request('http://localhost/api/member/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { ...server, update, calls };
}
test('unauthenticated GET and PATCH cannot access profile or write', async () => {
  const s = setup({ member: null });
  assert.equal((await s.getMemberProfile()).status, 401);
  assert.equal((await s.update(valid)).status, 401);
  assert.equal(s.calls.length, 0);
});
test('valid update trims input, binds session member, excludes phone and privileged fields', async () => {
  const s = setup();
  assert.equal((await s.update(valid)).status, 200);
  assert.equal(s.calls[0].data.fullName, 'Test Member');
  assert.equal(s.calls[0].data.phone, undefined);
  assert.deepEqual(s.calls[0].condition, [['eq', 'id', 17], ['ne', 'status', 'SUSPENDED']]);
});
test('rejects phone changes, mass assignment, invalid calendar dates and emergency phones', async () => {
  for (const patch of [{ phone: '0899999999' }, { id: 22 }, { role: 'OWNER' }, { points: 999 }, { fullName: '' }, { gender: 'INVALID' }, { birthDay: 31, birthMonth: 4 }, { birthDay: 30, birthMonth: 2 }, { emergencyPhone: 'bad' }]) {
    const s = setup();
    assert.equal((await s.update({ ...valid, ...patch })).status, 400, JSON.stringify(patch));
    assert.equal(s.calls.length, 0);
  }
});
test('GET returns only editable fields, not secrets or auth identity', async () => {
  const s = setup({ member: { id: 17, ...valid, passwordHash: 'secret', phone: '0812345678', role: 'OWNER' } });
  const result = await s.getMemberProfile();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.profile, valid);
});
test('failed DB write does not report success or leak database errors', async () => {
  const s = setup({ fail: true });
  const result = await s.update(valid);
  assert.equal(result.status, 503);
  assert.doesNotMatch(JSON.stringify(result), /private database error/);
  assert.equal((await setup({ rows: [] }).update(valid)).status, 409);
});
test('client profile flow has no fake OTP or local profile persistence', () => {
  const source = readFileSync(new URL('../app/member/AccountClient.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /pendingDraft|123456|localStorage\.(?:setItem|getItem)\("blu_member"/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /value=\{draft.phone\} readOnly/);
});
