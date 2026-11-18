import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Module } from 'node:module';
import ts from 'typescript';
function compile(path, mocks = {}) {
  const mod = new Module(path);
  mod.require = name => { if (name === 'server-only') return {}; if (name in mocks) return mocks[name]; throw new Error(`Unexpected dependency: ${name}`); };
  mod._compile(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, path);
  return mod.exports;
}
const xlsx = compile('./xlsx.ts');
const types = compile('../app/admin/finance/types.ts');
// Independent ZIP reader verifies central/local headers, sizes and CRC for every entry.
function unzip(bytes) {
  const b = Buffer.from(bytes), end = b.length - 22;
  assert.equal(b.readUInt32LE(end), 0x06054b50);
  let pos = b.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < b.readUInt16LE(end + 10); i++) {
    assert.equal(b.readUInt32LE(pos), 0x02014b50);
    const size = b.readUInt32LE(pos + 24), len = b.readUInt16LE(pos + 28), offset = b.readUInt32LE(pos + 42);
    const name = b.subarray(pos + 46, pos + 46 + len).toString();
    assert.equal(b.readUInt32LE(offset), 0x04034b50); assert.equal(b.readUInt16LE(offset + 8), 0);
    const start = offset + 30 + b.readUInt16LE(offset + 26), data = b.subarray(start, start + size);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    assert.equal((crc ^ 0xffffffff) >>> 0, b.readUInt32LE(pos + 16));
    files[name] = data.toString(); pos += 46 + len;
  }
  assert.equal(pos, end); return files;
}
function api(member = { role: 'OWNER', status: 'ACTIVE' }, records = [], failure) {
  let reads = 0;
  const route = compile('../app/api/admin/finance/export/route.ts', {
    '@/lib/auth/server': { getCurrentMember: async () => member },
    '@/lib/real-finance-server': { readRealFinance: async () => { reads++; if (failure) throw failure; return { records, audit: [{ secret: 'AUDIT_SECRET' }] }; } },
    '@/lib/xlsx': xlsx, '@/app/admin/finance/types': types,
  });
  return { get: query => route.GET(new Request(`https://example.test/api/admin/finance/export?${query ?? 'from=2026-01-01&to=2026-12-31'}`)), reads: () => reads };
}
const row = (i, patch = {}) => ({ id: `id-${i}`, date: '2026-05-02', type: 'INCOME', category: 'แพ็กเกจ', memberCode: `BLU-${i}`, memberName: `สมาชิก ${i}`, amount: i + 0.25, note: 'ทดสอบ', createdAt: String(i).padStart(5, '0'), phone: 'PHONE_SECRET', email: 'EMAIL_SECRET', ...patch });
test('real OOXML ZIP metadata, Thai, numeric cells and formula-safe literal strings', () => {
  const values = ['=1+1', '+cmd', '-cmd', '@SUM(A1)', '\t=1', '<&"', '_x000A_', '\u0000ok'];
  const files = unzip(xlsx.createXlsx([values, [12.34]]));
  assert.equal(Object.keys(files).length, 5);
  assert.match(files['[Content_Types].xml'], /spreadsheetml.sheet.main\+xml/);
  assert.match(files['_rels/.rels'], /Target="xl\/workbook.xml"/);
  assert.match(files['xl/workbook.xml'], /sheet name="Finance"/);
  assert.match(files['xl/_rels/workbook.xml.rels'], /Target="worksheets\/sheet1.xml"/);
  const xml = files['xl/worksheets/sheet1.xml'];
  assert.equal((xml.match(/t="inlineStr"/g) ?? []).length, 8);
  assert.match(xml, /<v>12.34<\/v>/); assert.match(xml, /&lt;&amp;&quot;/); assert.match(xml, /_x005F_x000A_/);
  assert.doesNotMatch(xml, /<f\b|hyperlink|\u0000/);
});
test('direct API rejects ADMIN/MEMBER/anonymous/suspended before finance read; SQL denial fails closed', async () => {
  for (const member of [null, {role:'ADMIN'}, {role:'MEMBER'}, {role:'OWNER',status:'SUSPENDED'}]) {
    const instance = api(member, [row(1)]), result = await instance.get();
    assert.ok([401,403].includes(result.status)); assert.equal(instance.reads(), 0); assert.doesNotMatch(await result.text(), /BLU-|สมาชิก|amount/);
  }
  assert.equal((await api(undefined, [], Object.assign(new Error('denied'), {code:'42501'})).get()).status, 403);
  assert.equal((await api(undefined, [], new Error('private database error')).get()).status, 503);
});
test('exports every row beyond a page, whitelist PII, amount unchanged and private attachment', async () => {
  const response = await api(undefined, Array.from({length:251}, (_,i) => row(i))).get();
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /spreadsheetml.sheet/);
  assert.match(response.headers.get('content-disposition'), /finance-2026-01-01-2026-12-31.xlsx/);
  assert.match(response.headers.get('cache-control'), /private, no-store/); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const xml = unzip(await response.arrayBuffer())['xl/worksheets/sheet1.xml'];
  assert.equal((xml.match(/<row /g) ?? []).length, 252); assert.match(xml, /BLU-250/); assert.match(xml, /สมาชิก 250/);
  assert.doesNotMatch(xml, /PHONE_SECRET|EMAIL_SECRET|AUDIT_SECRET|id-250/);
});
test('inclusive dates, type/category filters and all sort orders match R5', async () => {
  const records = [row(1,{date:'2026-01-01'}),row(2,{date:'2026-12-31'}),row(3,{date:'2027-01-01'}),row(4,{type:'EXPENSE',category:'เงินเดือน'})];
  for (const [sort, codes] of [['NEWEST',[2,4,1]],['OLDEST',[1,4,2]],['AMOUNT_ASC',[1,2,4]],['AMOUNT_DESC',[4,2,1]]]) {
    const response = await api(undefined,records).get(`from=2026-01-01&to=2026-12-31&sort=${sort}`);
    const xml = unzip(await response.arrayBuffer())['xl/worksheets/sheet1.xml'];
    assert.deepEqual([...xml.matchAll(/BLU-(\d+)/g)].map(x=>Number(x[1])), codes);
  }
  const response = await api(undefined,records).get(`from=2026-01-01&to=2026-12-31&type=EXPENSE&category=${encodeURIComponent('เงินเดือน')}`);
  const xml = unzip(await response.arrayBuffer())['xl/worksheets/sheet1.xml']; assert.match(xml,/BLU-4/); assert.doesNotMatch(xml,/BLU-[123]/);
});
test('invalid/duplicate/unknown filters rejected before read, including forged pagination', async () => {
  for (const query of ['from=2026-02-30&to=2026-12-31','from=2027-01-01&to=2026-01-01','from=2026-01-01&to=2026-12-31&type=BAD','from=2026-01-01&to=2026-12-31&sort=BAD','from=2026-01-01&to=2026-12-31&category=BAD','from=2026-01-01&from=2026-02-01&to=2026-12-31','from=2026-01-01&to=2026-12-31&page=1']) {
    const instance = api(); assert.equal((await instance.get(query)).status,400); assert.equal(instance.reads(),0);
  }
});
test('empty/header-only workbook; fail whole export at bounds without silent truncation', async () => {
  const empty = await api().get(); assert.equal((unzip(await empty.arrayBuffer())['xl/worksheets/sheet1.xml'].match(/<row /g)??[]).length,1);
  assert.equal((await api(undefined,Array.from({length:10001},(_,i)=>row(i))).get()).status,413);
  assert.throws(()=>xlsx.createXlsx([['x'.repeat(32768)]]),xlsx.XlsxLimitError);
  assert.throws(()=>xlsx.createXlsx(Array.from({length:1000},()=>['ก'.repeat(10000)])),xlsx.XlsxLimitError);
  assert.throws(()=>xlsx.createXlsx([[Infinity]]), /numeric/);
});
test('client export uses applied filters and server download, not local/current-page CSV', () => {
  const client = readFileSync(new URL('../app/admin/finance/FinanceClient.tsx',import.meta.url),'utf8');
  const action = client.slice(client.indexOf('const exportXlsx'),client.indexOf('const cards'));
  assert.match(action,/URLSearchParams\(\{ \.\.\.filters \}\)/); assert.match(action,/\/api\/admin\/finance\/export/);
  assert.doesNotMatch(action,/draftFilters|filtered\.map|text\/csv/); assert.doesNotMatch(client,/csvCell|exportCsv|Export CSV/);
});
