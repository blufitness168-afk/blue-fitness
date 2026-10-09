import fs from 'node:fs';
import path from 'node:path';
import { Module, createRequire } from 'node:module';
import { randomUUID, randomInt, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { client, metadata, ready, root, protect, local, save, stamp, safeFailure } from './db-safety.mjs';

const require = createRequire(import.meta.url);
function load(relative, overrides = {}) {
  const filename = path.join(root, relative), mod = new Module(filename);
  mod.filename = filename;
  mod.require = name => Object.hasOwn(overrides, name) ? overrides[name] : require(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return mod.exports;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !['--run-fixtures', '--all-writers-paused'].includes(a))) throw new Error('Invalid arguments');
  const sql = client();
  if (!ready(await metadata(sql))) { console.log('REFUSED: migrated/hardened schema missing; no fixtures or writes executed'); process.exitCode = 2; return; }
  if (!args.includes('--run-fixtures')) { console.log('Schema ready. Read-only preview: genuine scrypt, fixture-only login, unique phone/welcome, redemption ownership/expiry/replay. Explicit --run-fixtures --all-writers-paused required. No OTP/SMS.'); return; }
  if (!args.includes('--all-writers-paused')) throw new Error('Pause writers before fixture tests');
  protect();
  const marker = 'DBTEST-' + randomUUID(), id = -randomInt(1000000, 1000000000), otherId = id - 1;
  const phones = ['TEST-' + randomUUID().replaceAll('-', '').slice(0, 15), 'TEST-' + randomUUID().replaceAll('-', '').slice(0, 15)];
  const reportPath = path.join(local, 'integration-' + stamp() + '.json');
  const report = { marker, ids: [id, otherId], phones, passed: [], cleanup: 'pending', note: 'Calls real TS server functions with real Neon and scrypt; cookie adapter only. Not HTTP/OTP end-to-end. Serial sequences may advance even after cleanup.' };
  save(reportPath, JSON.stringify(report, null, 2));
  const record = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  let cookie;
  const password = load('src/lib/auth/password.ts');
  const base = { 'server-only': {}, '@/db': {}, '@/db/schema': {}, 'next/headers': { cookies: async () => ({ get: () => cookie ? { value: cookie } : undefined }) }, '@neondatabase/serverless': { neon: () => sql } };
  const auth = load('src/lib/auth/server.ts', { ...base, './password': password, './policy': {} });
  const benefits = load('src/lib/benefits-server.ts', { ...base, '@/lib/auth/server': { SESSION_COOKIE: 'blu_session' } });
  const pass = name => { report.passed.push(name); record(); };
  const hash = await password.hashPassword('fixture-only-strong-password');
  let fixturesCreated = false;
  try {
    const collision = await sql`SELECT (SELECT count(*) FROM members WHERE id=ANY(${[id,otherId]}::integer[]) OR phone=ANY(${phones}::text[])) + (SELECT count(*) FROM auth_login_limits WHERE phone=ANY(${phones}::text[])) AS n`;
    assert.equal(Number(collision[0].n), 0, 'Fixture identity collision; choose a fresh run');
    await assert.rejects(sql.transaction([
      sql`INSERT INTO members(id,phone,password_hash,full_name,member_code) VALUES (${id},${phones[0]},${hash},${marker},${marker})`,
      sql`INSERT INTO coupons(id,member_id,type,source,title,total_quota) VALUES (${id},${id},'FREE_ENTRY','WELCOME_REGISTRATION',${marker},NULL)`,
    ], { isolationLevel: 'Serializable' }), e => e.code === '23502');
    const rolledBack = await sql`SELECT count(*)::integer AS n FROM members WHERE id=${id} AND full_name=${marker}`;
    assert.equal(rolledBack[0].n, 0); pass('failed welcome insert rolls back fixture member');
    // Explicit negative IDs do not allocate member/coupon serials; never use registration tickets or existing members.
    const [created] = await sql.transaction([sql`
      WITH member AS (INSERT INTO members(id,phone,password_hash,full_name,member_code,status) VALUES (${id},${phones[0]},${hash},${marker},${marker},'PENDING') RETURNING id)
      INSERT INTO coupons(id,member_id,type,source,title,total_quota,expire_date)
      SELECT ${id},id,'FREE_ENTRY','WELCOME_REGISTRATION',${marker},1,now()+interval '30 days' FROM member RETURNING id
    `, sql`INSERT INTO members(id,phone,password_hash,full_name,member_code,status) VALUES (${otherId},${phones[1]},${hash},${marker},${marker + '-OTHER'},'PENDING')`], { isolationLevel: 'Serializable' });
    fixturesCreated = true;
    assert.equal(created.length, 1);
    const rows = await sql`SELECT total_quota,used_count,expire_date > now()+interval '29 days' AS expiry FROM coupons WHERE id=${id} AND title=${marker}`;
    assert.equal(rows[0].total_quota, 1); assert.equal(rows[0].used_count, 0); assert.equal(rows[0].expiry, true); pass('fixture member/welcome atomic statement and 30-day defaults');
    await assert.rejects(sql`INSERT INTO members(id,phone,full_name,member_code) VALUES (${otherId - 1},${phones[0]},${marker},${marker + '-DUP'})`, e => e.code === '23505' && e.constraint === 'members_phone_unique'); pass('database duplicate phone rejected');
    await assert.rejects(sql`INSERT INTO coupons(id,member_id,type,source,title) VALUES (${otherId},${id},'FREE_ENTRY','WELCOME_REGISTRATION',${marker})`, e => e.code === '23505' && e.constraint === 'coupons_member_source_unique'); pass('welcome unique once');
    assert.equal(await auth.loginPassword(phones[0], 'wrong-password'), null); pass('real scrypt wrong password rejected');
    const login = await auth.loginPassword(phones[0], 'fixture-only-strong-password'); assert.ok(login?.token); pass('real scrypt login creates session');
    const other = await auth.loginPassword(phones[1], 'fixture-only-strong-password'); assert.ok(other?.token);
    cookie = other.token; assert.equal(await benefits.redeemWelcomeEntry(id), null); pass('session ownership denies other fixture');
    cookie = login.token;
    await sql`UPDATE coupons SET expire_date=now()-interval '1 second' WHERE id=${id} AND title=${marker}`;
    assert.equal(await benefits.redeemWelcomeEntry(id), null); pass('expired coupon denied');
    await sql`UPDATE coupons SET expire_date=now()+interval '30 days' WHERE id=${id} AND title=${marker}`;
    assert.ok(await benefits.redeemWelcomeEntry(id)); assert.equal(await benefits.redeemWelcomeEntry(id), null);
    const audits = await sql`SELECT count(*)::integer AS n FROM checkins WHERE member_id=${id} AND scanner_device_id='MEMBER_COUPON_SELF_SERVICE'`;
    assert.equal(audits[0].n, 1); pass('redeem once with single checkin audit');
    const tokenHash = createHash('sha256').update(login.token).digest('hex');
    await sql`UPDATE auth_sessions SET revoked_at=now() WHERE member_id=${id} AND token_hash=${tokenHash}`;
    await sql`UPDATE coupons SET used_count=0,status='AVAILABLE' WHERE id=${id} AND title=${marker}`;
    assert.equal(await benefits.redeemWelcomeEntry(id), null); pass('revoked session denied');
    await sql`UPDATE auth_sessions SET revoked_at=NULL,expires_at=now()-interval '1 second' WHERE member_id=${id} AND token_hash=${tokenHash}`;
    assert.equal(await benefits.redeemWelcomeEntry(id), null); pass('expired session denied');
  } finally {
    // No cleanup writes after a failed atomic fixture creation (including collisions).
    if (!fixturesCreated) { report.cleanup = 'no fixture transaction committed'; record(); }
    else {
      // ID + exact marker + exact phone guards: never delete another account on an ID collision.
      await sql.transaction([
        sql`DELETE FROM auth_login_limits WHERE phone=ANY(${phones}::text[]) AND NOT EXISTS (SELECT 1 FROM members m WHERE m.phone=auth_login_limits.phone AND NOT (m.id=ANY(${[id,otherId]}::integer[]) AND m.full_name=${marker}))`,
        sql`DELETE FROM members WHERE id=ANY(${[id,otherId]}::integer[]) AND full_name=${marker} AND phone=ANY(${phones}::text[]) AND member_code IN (${marker},${marker + '-OTHER'})`,
      ], { isolationLevel: 'Serializable' });
      const remaining = await sql.transaction([
        sql`SELECT count(*)::integer AS n FROM members WHERE full_name=${marker} OR member_code IN (${marker},${marker + '-OTHER'})`,
        sql`SELECT count(*)::integer AS n FROM auth_login_limits WHERE phone=ANY(${phones}::text[])`,
      ], { readOnly: true });
      assert.equal(remaining[0][0].n, 0); assert.equal(remaining[1][0].n, 0);
      const children = await sql`SELECT (SELECT count(*) FROM coupons WHERE member_id=ANY(${[id,otherId]}::integer[])) + (SELECT count(*) FROM auth_sessions WHERE member_id=ANY(${[id,otherId]}::integer[])) + (SELECT count(*) FROM checkins WHERE member_id=ANY(${[id,otherId]}::integer[])) AS n`;
      assert.equal(Number(children[0].n), 0);
      report.cleanup = 'completed; verified members/limits/coupons/sessions/checkins absent'; record();
    }
    console.log(JSON.stringify({ report: path.relative(process.cwd(), reportPath), passed: report.passed, cleanup: report.cleanup }));
  }
}
main().catch(safeFailure);
