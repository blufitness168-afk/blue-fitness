import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const require = createRequire(import.meta.url);
function load(path, imports = {}, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: name => { assert.ok(name in imports, name); return imports[name]; }, ...globals });
  return exports;
}
const term = { packageName: 'Synthetic', startsAt: '2027-01-01T23:00:00+00:00', endsAt: '2027-01-02T23:00:00+00:00', dailySlot: '07:00-14:00', status: 'ACTIVE' };
function harness({ flag, token = 'a'.repeat(64), terms = [term], code } = {}) {
  const calls = [], errors = [];
  const { readStaffFreeTerms } = load('./staff-free-display-server.ts', {
    'server-only': {}, 'node:crypto': { createHash }, './auth/server': { SESSION_COOKIE: 'test-session' },
    'next/headers': { cookies: async () => ({ get: name => { assert.equal(name, 'test-session'); return { value: token }; } }) },
    './package-catalog': load('./package-catalog.ts'), zod: require('zod'),
    '@neondatabase/serverless': { neon: () => async (parts, ...values) => {
      calls.push({ sql: parts.join('?'), values });
      if (code) throw Object.assign(new Error('PRIVATE DB DETAIL'), { code });
      return [{ terms }];
    } },
  }, { process: { env: { ENABLE_STAFF_FREE_DISPLAY: flag, ENABLE_STAFF_FREE: 'true', DATABASE_URL: 'offline' } },
    console: { error: msg => errors.push(msg) } });
  return { read: readStaffFreeTerms, calls, errors };
}

test('free display remains opt-in; paid terms remain visible with writer off', async () => {
  const paid = { ...term, source: 'STAFF_TRANSFER' };
  for (const flag of [undefined, '1']) {
    const h = harness({ flag, terms: [term, paid] });
    assert.deepEqual(await h.read(), [paid]);
    assert.equal(h.calls.length, 1);
  }
  const invalid = harness({ flag: 'true', token: 'bad' });
  assert.equal((await invalid.read()).length, 0);
  assert.equal(invalid.calls.length, 0);
});
test('parameterized read binds hashed session and null self target or canonical staff target', async () => {
  const h = harness({ flag: 'true' });
  const digest = createHash('sha256').update('a'.repeat(64)).digest('hex');
  assert.deepEqual(await h.read(), [term]);
  await h.read('BLU-3');
  assert.deepEqual(h.calls.map(call => call.values), [[digest, null], [digest, 'BLU-3']]);
  assert.equal(h.calls[0].sql, 'SELECT r4_staff_private.display_terms(?,?::text) AS terms');
});
test('staged or unavailable reads do not expose errors or unexpected fields', async () => {
  for (const code of ['3F000', '42883', '42P01', '42501', '08006']) {
    const h = harness({ flag: 'true', code });
    assert.equal((await h.read()).length, 0);
    assert.doesNotMatch(h.errors.join(' '), /PRIVATE/);
  }
  const h = harness({ flag: 'true', terms: [{ ...term, privateField: 'sensitive' }] });
  assert.equal((await h.read()).length, 0);
});
test('read-only card uses distinct states and Bangkok dates, not a live-entry promise', () => {
  const { default: Card } = load('../components/StaffFreeEntitlement.tsx', { 'react/jsx-runtime': require('react/jsx-runtime') });
  const view = (terms, isEn) => renderToStaticMarkup(createElement(Card, { terms, isEn }));
  assert.equal(view([], true), '');
  const html = view(['SCHEDULED', 'ACTIVE', 'BLOCKED', 'SUPERSEDED'].map(status => ({ ...term, status })), true);
  for (const label of [/Scheduled/, /Active term/, /Blocked/, /Superseded/, /Jan 2, 2027/, /Entry is verified at check-in/]) assert.match(html, label);
  assert.doesNotMatch(html, /<button|<form|admitted|in-slot/i);
  assert.match(view([term], false), /ระบบจะตรวจสิทธิ์เข้าใช้ตอนเช็กอิน/);
  const paid = view([{ ...term, source: 'STAFF_TRANSFER' }], true);
  assert.match(paid, /Staff-issued transfer renewal/);
  assert.doesNotMatch(paid, /free extension/);
});
