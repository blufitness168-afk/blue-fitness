import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite');
function load(path, mocks = {}) {
  const mod = new Module(path);
  mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  mod._compile(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, path);
  return mod.exports;
}
const csv = load('./finance-import-csv.ts');
const header = csv.FINANCE_IMPORT_TEMPLATE;
const expense = 'ARCHIVE-01,2001-01-31,EXPENSE,อุปกรณ์,20.01,"synthetic, ""invoice"""';
const income = 'ARCHIVE-02,2000-02-29,INCOME,รายได้อื่น (ไม่ใช่แพ็กเกจ),120,Other income';
const rows = csv.parseFinanceImport(`${header}${expense}\r\n${income}`).rows;
const migration = name => readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), 'utf8');

test('fixed UTF-8 template: quotes, satang, row numbers and invalid fields', () => {
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.line, row.amountSatang]), [[2, 2001], [3, 12000]]);
  assert.equal(rows[0].note, 'synthetic, "invoice"');
  for (const [text, code] of [
    ['different\n' + expense, 'header'], [header, 'row_count'],
    [header + expense.replace('2001-01-31', '2001-02-29'), 'date'],
    [header + expense.replace('20.01', '2.001'), 'amount'],
    [header + expense.replace('อุปกรณ์', 'สมัครใหม่'), 'category'],
    [header + expense + '"junk', 'csv'],
    [header + expense + '\n' + expense, 'duplicate_reference'],
    [header + Array(201).fill(expense).join('\n'), 'row_count'],
  ]) assert.ok(csv.parseFinanceImport(text).issues.some(item => item.code === code), code);
});

test('OWNER API validates origin, stream size and preview proof before SQL commit', async () => {
  let member = { role: 'OWNER', status: 'ACTIVE' };
  let cookie = 'a'.repeat(64);
  const calls = [];
  const { financeImportRequest } = load('./finance-import-server.ts', {
    'server-only': {}, './finance-import-csv': csv,
    'next/headers': { cookies: async () => ({ get: () => ({ value: cookie }) }) },
    './auth/server': { SESSION_COOKIE: 'session', getCurrentMember: async () => member },
    './auth/http': { json: (body, status = 200) => ({ body, status }), sameOrigin: req => req.headers.get('origin') === 'https://example.test' },
    '@neondatabase/serverless': { neon: () => async (_, ...values) => {
      calls.push(values);
      return [{ result: values[1] === 'preview' ? { issues: [] } : { receipt: { count: 1 } } }];
    } },
  });
  const env = { FINANCE_IMPORT_ENABLED: process.env.FINANCE_IMPORT_ENABLED, DATABASE_URL: process.env.DATABASE_URL };
  process.env.FINANCE_IMPORT_ENABLED = '1'; process.env.DATABASE_URL = 'mock-only';
  const key = randomUUID();
  const send = (action, body = header + expense, headers = {}) => financeImportRequest(new Request(
    `https://example.test/api/admin/finance/import?action=${action}`, { method: 'POST', body,
      headers: { origin: 'https://example.test', 'content-type': 'text/csv', 'x-import-key': key, ...headers } },
  ));
  try {
    assert.equal((await send('preview', undefined, { origin: 'https://other.test' })).status, 403);
    for (const role of ['MEMBER', 'ADMIN']) { member.role = role; assert.equal((await send('preview')).status, 403); }
    member = null; assert.equal((await send('preview')).status, 401);
    member = { role: 'OWNER', status: 'ACTIVE' };
    assert.equal((await send('preview', 'x'.repeat(csv.MAX_IMPORT_BYTES + 1))).status, 413);
    assert.equal((await send('preview', new Uint8Array([255]))).status, 400);
    assert.equal((await send('commit')).status, 400);
    assert.equal(calls.length, 0);
    const preview = await send('preview');
    assert.equal(preview.status, 200); assert.equal(preview.body.rows.length, 1);
    const headers = { 'x-import-preview': preview.body.proof, 'x-import-attested': 'yes' };
    assert.equal((await send('commit', header + income, headers)).status, 400);
    cookie = 'b'.repeat(64); assert.equal((await send('commit', undefined, headers)).status, 400);
    cookie = 'a'.repeat(64); assert.equal((await send('commit', undefined, headers)).status, 200);
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0][0], cookie); assert.equal(calls[0][3], calls[1][3]);
    assert.equal(calls[1][4], true);
  } finally {
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('PGlite executes SQL: preview is read-only and rejects actual ledger/source overlap', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE members(id serial PRIMARY KEY,role text,status text,member_code text,full_name text);
      CREATE TABLE auth_sessions(id serial PRIMARY KEY,member_id int,token_hash text,mode text DEFAULT 'NORMAL',revoked_at timestamptz,expires_at timestamptz);
      CREATE TABLE package_payment_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),member_id int,package_snapshot jsonb DEFAULT '{}',amount_satang int,status text,confirmed_at timestamptz,created_at timestamptz DEFAULT now(),paid_at timestamptz);
      INSERT INTO members(role,status) VALUES('OWNER','ACTIVE'),('OWNER','SUSPENDED'),('ADMIN','ACTIVE');
      INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'test-'||id, now()+interval '1 day' FROM members;
      INSERT INTO auth_sessions(member_id,token_hash,mode,expires_at,revoked_at) VALUES
        (1,'kiosk','KIOSK',now()+interval '1 day',NULL), (1,'old','NORMAL',now()-interval '1 day',NULL), (1,'revoked','NORMAL',now()+interval '1 day',now());
      INSERT INTO package_payment_orders(member_id,amount_satang,status,paid_at,confirmed_at) VALUES (1,12000,'PAID','2000-02-28 17:00Z','2000-02-29 17:00Z');
      CREATE SCHEMA r4_staff_private; CREATE TABLE r4_staff_private.test_staff(date date,type text,amount bigint);
      INSERT INTO r4_staff_private.test_staff VALUES ('2001-01-31','EXPENSE',2001),('2001-01-31','INCOME',0);
      CREATE VIEW r4_staff_private.finance_source AS SELECT date AS entry_date,type,amount AS amount_satang FROM r4_staff_private.test_staff;
      CREATE SCHEMA r4_online_private; CREATE TABLE r4_online_private.test_refunds(entry_date date,amount_satang bigint);
      INSERT INTO r4_online_private.test_refunds VALUES ('2001-01-31',2002);
      CREATE VIEW r4_online_private.finance_refunds AS SELECT * FROM r4_online_private.test_refunds;`);
    await db.exec(migration('20261024_real_finance'));
    await db.exec(migration('20261126_R5_finance_import'));
    const key = randomUUID();
    const call = async (action, payload = rows, requestKey = key, token = 'test-1') => (await db.query(
      'SELECT r5_finance_import($1,$2,$3,$4,$5) AS result', [token, action, requestKey, JSON.stringify(payload), action === 'commit'],
    )).rows[0].result;
    for (const session of ['missing', 'test-2', 'test-3', 'kiosk', 'old', 'revoked']) {
      for (const action of ['preview', 'commit']) await assert.rejects(call(action, rows, key, session), { code: '42501' });
    }
    const collisions = { issues: rows.map(row => ({ line: row.line, code: 'lifecycle_match' })) };
    assert.deepEqual(await call('preview'), collisions); assert.deepEqual(await call('commit'), collisions);
    const refund = { ...rows[0], amountSatang: 2002 };
    assert.deepEqual(await call('commit', [refund]), { issues: [{ line: 2, code: 'lifecycle_match' }] });
    const valid = rows.map(row => ({ ...row, amountSatang: row.amountSatang + 2 }));
    assert.deepEqual(await call('preview', valid), { issues: [] });
    assert.equal((await db.query('SELECT count(*)::int AS n FROM finance_entries')).rows[0].n, 0);
    const saved = await call('commit', valid);
    assert.equal(saved.receipt.count, 2); assert.deepEqual(await call('commit', valid), saved);
    await assert.rejects(call('commit', rows), { code: '22023' });
    const entryId = (await db.query("SELECT entry_id FROM r5_finance_private.import_rows WHERE source_ref='ARCHIVE-01'")).rows[0].entry_id;
    await db.query("SELECT real_finance_action('test-1','delete',gen_random_uuid(),jsonb_build_object('id',$1::text,'version',1,'reason','Synthetic correction'))", [entryId]);
    assert.equal((await call('commit', valid, randomUUID())).issues[0].code, 'duplicate_reference');
    assert.equal((await db.query("SELECT real_finance_action('test-1','read',NULL,'{}') AS data")).rows[0].data.records.length, 2);
  } finally { await db.close(); }
});
