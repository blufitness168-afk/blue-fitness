import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Module } from 'node:module';
import ts from 'typescript';

function compile(path, mocks = {}) {
  const filename = new URL(path, import.meta.url).pathname;
  const loaded = new Module(filename);
  loaded.require = name => { if (name in mocks) return mocks[name]; throw new Error(`Unexpected dependency: ${name}`); };
  loaded._compile(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return loaded.exports;
}
const policy = compile('./reward-image-policy.ts');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function request(bytes = png, mime = 'image/png', extra = false, headers = {}) {
  const form = new FormData(); form.append('file', new Blob([bytes], { type: mime }), 'private-name.png');
  if (extra) form.append('memberId', '999');
  return new Request('https://example.test/api/rewards/upload', { method: 'POST', body: form, headers: { origin: 'https://example.test', ...headers } });
}
function api(member = { role: 'ADMIN', status: 'ACTIVE' }, fail = false) {
  const calls = []; let authCalls = 0;
  const http = compile('./auth/http.ts', { 'server-only': {}, 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } } });
  const route = compile('../app/api/rewards/upload/route.ts', {
    '@/lib/auth/server': { getCurrentMember: async () => { authCalls++; return member; } },
    '@/lib/auth/http': http, '@/lib/reward-image-policy': policy,
    cloudinary: { v2: { config: () => {}, uploader: { upload_stream: (options, callback) => ({ end: bytes => { calls.push({ options, bytes }); callback(fail ? new Error('SECRET DB TOKEN private-name.png') : null, { secure_url: 'https://res.cloudinary.com/test/image/upload/reward.png', public_id: 'SECRET', member: 'PRIVATE' }); } }) } } },
  });
  return { ...route, calls, authCalls: () => authCalls };
}
test('admin UI uploads file then saves returned URL through real rewards API', async () => {
  const slots = []; let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const page = compile('../app/admin/rewards/page.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: {
      useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = index === 0 ? { rewards: [], redemptions: [] } : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
      useRef: initial => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
      useEffect: () => {}, useCallback: callback => callback,
    },
  });
  function nodes(node) { if (!node || typeof node !== 'object') return []; return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
  const render = () => { cursor = 0; return nodes(page.default()); };
  const previous = globalThis.fetch; const calls = []; let finish;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/rewards/upload') return await new Promise(resolve => { finish = () => resolve(Response.json({ url: 'https://res.cloudinary.com/test/reward.png' })); });
    return Response.json({ data: { rewards: [], redemptions: [] } });
  };
  try {
    render().find(node => node.type === 'button' && node.props.children === 'เพิ่มรางวัล').props.onClick();
    const field = render().find(node => node.props?.type === 'file');
    field.props.onChange({ target: { files: [new File([png], 'reward.png', { type: 'image/png' })], value: 'file' } });
    assert.equal(render().find(node => node.type === 'fieldset').props.disabled, true);
    assert.equal(calls[0].url, '/api/rewards/upload'); assert.ok(calls[0].options.body.get('file') instanceof File);
    finish(); await new Promise(resolve => setImmediate(resolve));
    let tree = render();
    const title = tree.find(node => node.type === 'input' && node.props.maxLength === 120); title.props.onChange({ target: { value: 'Reward' } });
    tree = render(); const form = tree.find(node => node.type === 'form' && node.props.className === 'space-y-3');
    form.props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve));
    const saved = calls.find(call => call.url === '/api/rewards/save');
    assert.equal(JSON.parse(saved.options.body).imageUrl, 'https://res.cloudinary.com/test/reward.png');
    assert.equal(JSON.parse(saved.options.body).title, 'Reward'); assert.match(JSON.parse(saved.options.body).requestKey, /^[a-f0-9-]{36}$/);
    assert.equal(calls.filter(call => call.url === '/api/rewards/save').length, 1);
  } finally { globalThis.fetch = previous; }
});

test('signature/MIME spoof, SVG, empty and oversized rejected', () => {
  policy.validateRewardImage(png, 'image/png');
  for (const [bytes, mime] of [[png, 'image/jpeg'], [Buffer.from('<svg/>'), 'image/png'], [Buffer.alloc(0), 'image/png'], [png, 'image/svg+xml']]) assert.throws(() => policy.validateRewardImage(bytes, mime), { status: 400 });
  assert.throws(() => policy.validateRewardImage(Buffer.alloc(policy.MAX_REWARD_IMAGE_BYTES + 1), 'image/png'), { status: 413 });
});
test('multipart bounded with and without Content-Length; malformed rejected', async () => {
  await assert.rejects(policy.readRewardForm(request(png, 'image/png', false, { 'content-length': String(policy.MAX_REWARD_REQUEST_BYTES + 1) })), { status: 413 });
  await assert.rejects(policy.readRewardForm(request(Buffer.alloc(policy.MAX_REWARD_REQUEST_BYTES + 1))), { status: 413 });
  await assert.rejects(policy.readRewardForm(new Request('https://example.test', { method: 'POST', body: 'broken', headers: { 'content-type': 'multipart/form-data; boundary=abc' } })), { status: 400 });
});
test('auth and origin reject before upload; no member data leaks', async () => {
  for (const member of [null, { role: 'ADMIN', status: 'SUSPENDED' }, { role: 'MEMBER', status: 'ACTIVE' }, { role: 'TRAINER', status: 'ACTIVE' }]) {
    const route = api(member); const response = await route.POST(request());
    assert.ok([401, 403].includes(response.status)); assert.equal(route.calls.length, 0);
    assert.doesNotMatch(await response.text(), /memberId|PRIVATE|SECRET|private-name/);
  }
  for (const headers of [{ origin: 'https://evil.test' }, { 'sec-fetch-site': 'cross-site' }, { origin: '' }]) {
    const route = api(); assert.equal((await route.POST(request(png, 'image/png', false, headers))).status, 403); assert.equal(route.authCalls(), 0);
  }
  // Verify the actual shared auth boundary, not just a mocked role check.
  const auth = readFileSync(new URL('./auth/server.ts', import.meta.url), 'utf8');
  assert.match(auth, /isNull\(authSessions.revokedAt\)/); assert.match(auth, /gt\(authSessions.expiresAt, new Date\(\)\)/);
  assert.match(auth, /current\?\.session.mode === "NORMAL"/);
});
test('OWNER/ADMIN upload only sanitized URL; rejects extra fields and provider failures stay private', async () => {
  const names = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const previous = names.map(name => process.env[name]); names.forEach(name => { process.env[name] = 'isolated-only'; });
  try {
    for (const role of ['OWNER', 'ADMIN']) {
      const route = api({ role, status: 'ACTIVE' }); const response = await route.POST(request());
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { url: 'https://res.cloudinary.com/test/image/upload/reward.png' });
      assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(route.calls[0].options.folder, 'blue-fitness/rewards');
      assert.equal(route.calls[0].options.resource_type, 'image');
    }
    for (const req of [request(png, 'image/jpeg'), request(png, 'image/png', true), request(Buffer.alloc(policy.MAX_REWARD_IMAGE_BYTES + 1))]) {
      const route = api(); assert.ok([400, 413].includes((await route.POST(req)).status)); assert.equal(route.calls.length, 0);
    }
    const failed = await api(undefined, true).POST(request()); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /SECRET|TOKEN|private-name|PRIVATE/);
  } finally { names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; }); }
});
