// Called by the native harness with real October and R5 OWNER JSON on stdin.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function compile(file, mocks = {}) {
  const mod = new Module(file);
  mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  mod._compile(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, file);
  return mod.exports;
}

const cases = JSON.parse(readFileSync(0, 'utf8'));
assert.equal(cases.length, 2);
const types = compile('../src/app/admin/finance/types.ts');
const Client = compile('../src/app/admin/finance/FinanceClient.tsx', {
  './types': types, '@/components/AdminDashboardCharts': { default: () => null },
}).default;
const html = data => renderToStaticMarkup(createElement(Client, { initialData: data }));

for (const pair of cases) {
  const row = pair.after.records.find(record => record.source === 'STAFF_FREE');
  assert.equal(row.amount, 0);
  const beforeHtml = html(pair.before), afterHtml = html(pair.after);
  const staffRows = [...afterHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].filter(m => m[1].includes(row.note));
  assert.equal(staffRows.length, 1);
  assert.match(staffRows[0][1], />\+0 ฿<.*STAFF_FREE.*ล็อก/);
  assert.doesNotMatch(staffRows[0][1], /<button/);
  // Both sets of summary cards precede the ledger; keep rendered totals identical.
  const cards = markup => [...markup.matchAll(/<p class="[^"<>]*font-black[^"<>]*">[^<]* ฿<\/p>/g)].map(m => m[0]);
  assert.ok(cards(beforeHtml).length >= 6);
  assert.deepEqual(cards(afterHtml), cards(beforeHtml));
  for (const mode of ['month', 'day']) {
    const year = row.date.slice(0, 4);
    assert.deepEqual(types.financeChart(pair.after.records, mode, `${year}-01-01`, `${year}-12-31`),
      types.financeChart(pair.before.records, mode, `${year}-01-01`, `${year}-12-31`));
  }

  let role = 'ADMIN', reads = 0;
  const route = compile('../src/app/api/admin/finance/export/route.ts', {
    '@/lib/auth/server': { getCurrentMember: async () => ({ role, status: 'ACTIVE' }) },
    '@/lib/real-finance-server': { readRealFinance: async () => { reads++; return pair.after; } },
    '@/lib/xlsx': compile('../src/lib/xlsx.ts', { 'server-only': {} }),
    '@/app/admin/finance/types': types,
  });
  const req = new Request(`https://example.test/api/admin/finance/export?from=${row.date}&to=${row.date}&type=INCOME&category=${encodeURIComponent(row.category)}`);
  assert.equal((await route.GET(req)).status, 403);
  assert.equal(reads, 0);
  role = 'OWNER';
  const exported = await route.GET(req);
  assert.equal(exported.status, 200);
  assert.equal(reads, 1);
  assert.equal(exported.headers.get('cache-control'), 'private, no-store');
  // The existing writer stores uncompressed ZIP members; inspect the actual sheet rows.
  const workbook = Buffer.from(await exported.arrayBuffer()).toString('utf8');
  const rows = [...workbook.matchAll(/<row r="\d+">.*?<\/row>/g)].map(m => m[0]);
  assert.equal(rows.length, 2); // original header plus one filtered row
  assert.equal((rows[0].match(/<c /g) ?? []).length, 8);
  assert.match(rows[1], /<c r="G2"><v>0<\/v><\/c>/);
  assert.ok(rows[1].includes(row.note));
}
console.log('PASS: October and R5 render locked +0 with STAFF_FREE, unchanged totals/charts, and export numeric zero with the original XLSX columns');
