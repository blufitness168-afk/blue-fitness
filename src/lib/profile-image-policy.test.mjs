import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function compile(path, mocks = {}) {
  const file = new URL(path, import.meta.url);
  const loaded = new Module(file.pathname);
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  loaded._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file.pathname);
  return loaded.exports;
}
const policy = compile('./profile-image-policy.ts');
const jpeg = Buffer.from([255, 216, 255, 224]);
function request(bytes = jpeg, mime = 'image/jpeg', extra = false) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), 'photo.jpg');
  if (extra) form.append('memberId', '999');
  return new Request('https://example.test/api/upload', { method: 'POST', body: form });
}
function setup({ role = 'MEMBER', avatarUrl = null, avatarChanged = false, failure = false, cleanupFailure = false, origin = true } = {}) {
  let saved = false;
  const uploads = [], deletes = [], conditions = [];
  const op = name => (...args) => [name, ...args];
  const columns = new Proxy({}, { get: (_, key) => key });
  const route = compile('../app/api/upload/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/profile-image-policy': policy,
    '@/lib/auth/server': { getCurrentMember: async () => role ? { id: 17, memberCode: 'BLU-17', role, avatarUrl, avatarChanged } : null },
    '@/lib/auth/http': { sameOrigin: () => origin },
    '@/db/schema': { members: columns },
    'drizzle-orm': Object.fromEntries(['and', 'eq', 'or', 'isNull'].map(name => [name, op(name)])),
    '@/db': { db: { update: () => ({ set: () => ({ where: condition => { conditions.push(condition); return { returning: async () => {
      if (failure) throw new Error('private-secret');
      if (saved) return [];
      saved = true;
      return [{ id: 17 }];
    } }; } }) }) } },
    cloudinary: { v2: { config() {}, uploader: {
      upload_stream: (options, callback) => ({ end: () => {
        const id = `new-${uploads.length}`;
        uploads.push(options);
        callback(null, { public_id: id, secure_url: `https://images.test/${id}`, format: 'jpg' });
      } }),
      destroy: async id => { deletes.push(id); if (cleanupFailure) throw new Error('private-secret'); },
    } } },
  });
  return { ...route, uploads, deletes, conditions };
}
// Dummy configuration only: the Cloudinary SDK is replaced entirely above.
for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) process.env[key] = 'test-stub';

test('signatures allow JPEG PNG WebP only and must agree with MIME', () => {
  const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.write('IHDR', 12);
  const webp = Buffer.alloc(20); webp.write('RIFF'); webp.writeUInt32LE(12, 4); webp.write('WEBPVP8 ', 8);
  for (const [bytes, mime] of [[jpeg, 'image/jpeg'], [png, 'image/png'], [webp, 'image/webp']]) assert.doesNotThrow(() => policy.validateProfileImage(bytes, mime));
  for (const [bytes, mime] of [[jpeg, 'image/png'], [Buffer.from('<svg/>'), 'image/jpeg'], [Buffer.from('GIF89a'), 'image/gif'], [Buffer.alloc(0), 'image/jpeg']]) assert.throws(() => policy.validateProfileImage(bytes, mime));
  assert.throws(() => policy.validateProfileImage(Buffer.alloc(policy.MAX_PROFILE_IMAGE_BYTES + 1), 'image/jpeg'));
});
test('stream bound ignores missing or lying content-length and cancels early', async () => {
  for (const length of [null, '1']) {
    let cancelled = false;
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
    const req = new Request('https://example.test', { method: 'POST', body, duplex: 'half', headers: length ? { 'content-length': length } : {} });
    await assert.rejects(policy.readProfileForm(req), error => error.status === 413);
    assert.equal(cancelled, true);
  }
});
test('exact 5MB file accepted; larger file or spoof never uploads', async () => {
  const bytes = Buffer.alloc(policy.MAX_PROFILE_IMAGE_BYTES); jpeg.copy(bytes);
  assert.equal((await setup().POST(request(bytes))).status, 200);
  for (const req of [request(Buffer.concat([bytes, Buffer.from([0])])), request(Buffer.from('<svg/>'))]) {
    const s = setup(); assert.ok((await s.POST(req)).status >= 400); assert.equal(s.uploads.length, 0);
  }
});
test('concurrent member requests have one winner and clean only losing asset', async () => {
  const s = setup();
  const responses = await Promise.all([s.POST(request()), s.POST(request())]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(s.deletes.length, 1);
  assert.deepEqual(s.conditions[0], ['and', ['eq', 'id', 17], ['eq', 'role', 'MEMBER'], ['eq', 'avatarChanged', false], ['or', ['isNull', 'avatarUrl'], ['eq', 'avatarUrl', '']]]);
  const winner = await responses.find(r => r.status === 200).json();
  assert.ok(!s.deletes.includes(winner.publicId));
});
test('DB failure cleans orphan best effort and does not expose errors', async () => {
  for (const cleanupFailure of [false, true]) {
    const s = setup({ failure: true, cleanupFailure });
    const result = await s.POST(request());
    assert.equal(result.status, 500); assert.equal(s.deletes.length, 1);
    assert.doesNotMatch(await result.text(), /private-secret/);
  }
});
test('auth, existing avatar and target privilege checked; owner remains upload-only', async () => {
  for (const options of [{ role: null }, { role: 'TRAINER' }, { avatarUrl: 'existing' }, { avatarChanged: true }, { origin: false }]) {
    const s = setup(options); assert.equal((await s.POST(request())).status, 403); assert.equal(s.uploads.length, 0);
  }
  const member = setup(); assert.equal((await member.POST(request(jpeg, 'image/jpeg', true))).status, 403);
  const owner = setup({ role: 'OWNER', avatarUrl: 'existing', avatarChanged: true });
  assert.equal((await owner.POST(request(jpeg, 'image/jpeg', true))).status, 200);
  assert.equal(owner.conditions.length, 0); assert.equal(owner.deletes.length, 0);
});
