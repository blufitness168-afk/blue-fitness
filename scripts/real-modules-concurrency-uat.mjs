// Validate the new runner's exact minimal base + unmodified migration chain.
// Explicitly SINGLE-CONNECTION WASM, never real concurrency and never DATABASE_URL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { PGlite } = createRequire(new URL('../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite');
const source = await readFile(new URL('./real-modules-concurrency-uat.py', import.meta.url), 'utf8');
const base = source.match(/BASE = """([\s\S]*?)"""/)[1];
const migrations = [...source.match(/MIGRATIONS = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+\.sql)'/g)].map(x => x[1]);
assert.equal(migrations.length, 8);
const db = new PGlite();
try {
  await db.exec(base);
  for (const migration of migrations) {
    await db.exec(await readFile(new URL('../src/db/migrations/' + migration, import.meta.url), 'utf8'));
    console.log('PASS isolated WASM compile:', migration);
  }
  const { rows } = await db.query("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('real_rewards_action','real_benefits_admin_action','real_finance_action','real_frontdesk_checkin','create_package_payment_order','claim_package_payment_attempt','finalize_package_payment')");
  assert.equal(rows[0].n, 7);
  console.log('PASS unified runner schema contract; single-connection WASM ONLY; real races NOT RUN.');
} finally {
  await db.close();
}
