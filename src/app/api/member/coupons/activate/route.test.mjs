import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, dependencies) {
  const file = new URL(path, import.meta.url);
  const mod = new Module(file.pathname);
  mod.require = name => dependencies[name] ?? require(name);
  mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file.pathname);
  return mod.exports;
}
const http = load('../../../../../lib/auth/http.ts', { 'server-only': {}, 'next/server': { NextResponse: Response } });
const token = 'a'.repeat(64);
const receipt = { couponId: 5, activatedAt: '2099-02-01T01:00:00Z', expiresAt: '2099-02-01T01:10:00Z' };
function fixture({ member = { id: 17 }, cookie = token, failure } = {}) {
  const calls = [];
  const { POST } = load('./route.ts', {
    'next/headers': { cookies: async () => ({ get: () => ({ value: cookie }) }) },
    '@/lib/auth/server': { SESSION_COOKIE: 'session', getCurrentMember: async () => member },
    '@/lib/auth/http': http,
    '@neondatabase/serverless': { neon: () => async (parts, ...values) => {
      calls.push({ text: parts.join('?'), values });
      if (failure) throw Object.assign(Error('private diagnostics'), { code: failure });
      return [{ result: receipt }];
    } },
  });
  return { POST, calls };
}
const request = (body, headers = {}) => new Request('https://example.test/api/member/coupons/activate', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('only a same-origin JSON coupon ID and a valid normal session reach SQL', async () => {
  const api = fixture();
  for (const body of [{}, { couponId: 0 }, { couponId: 0.5 }, { couponId: 2147483648 }, { couponId: '5' }, { couponId: 5, memberId: 17 }, { couponId: 5, activatedAt: receipt.activatedAt }]) {
    assert.equal((await api.POST(request(body))).status, 400);
  }
  assert.equal((await api.POST(request({ couponId: 5 }, { origin: 'https://elsewhere.test' }))).status, 400);
  assert.equal((await api.POST(request({ couponId: 5 }, { 'sec-fetch-site': 'cross-site' }))).status, 400);
  assert.equal(api.calls.length, 0);
  for (const options of [{ member: null }, { cookie: 'invalid' }]) {
    const unauthenticated = fixture(options);
    assert.equal((await unauthenticated.POST(request({ couponId: 5 }))).status, 401);
    assert.equal(unauthenticated.calls.length, 0);
  }
});

test('activation forwards only the hashed session and ID; retry uses the same receipt contract', async () => {
  const prior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'unit-test-no-network';
  try {
    const api = fixture();
    for (let i = 0; i < 2; i++) {
      const response = await api.POST(request({ couponId: 5 }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { data: receipt });
    }
    assert.equal(api.calls.length, 2);
    assert.deepEqual(api.calls[0], api.calls[1]);
    assert.match(api.calls[0].text, /public\.r6_activate_coupon/);
    assert.deepEqual(api.calls[0].values, [createHash('sha256').update(token).digest('hex'), 5]);
    for (const [failure, status] of [['42501', 403], ['P0001', 409], ['42883', 503], ['40001', 503]]) {
      const response = await fixture({ failure }).POST(request({ couponId: 5 }));
      assert.equal(response.status, status);
      assert.doesNotMatch(await response.text(), /private diagnostics|activatedAt/);
    }
  } finally {
    if (prior === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prior;
  }
});
