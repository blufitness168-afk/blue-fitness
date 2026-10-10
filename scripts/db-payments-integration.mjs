// Full live-schema metadata acceptance in isolated WASM PostgreSQL. No live data is loaded.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { root, local, digest } from './db-safety.mjs';
import { splitSql } from './db-payments-sql.mjs';
const directory = path.resolve(process.argv[2] ?? '');
if (!directory.startsWith(local + path.sep)) throw new Error('Protected backup required');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const restore = fs.readFileSync(path.join(directory, 'restore-empty.sql'), 'utf8');
if (digest(restore) !== manifest.files['restore-empty.sql']) throw new Error('Backup digest mismatch');
const requireTest = createRequire(path.join(local, 'payment-sql-tests/package.json'));
const { PGlite } = requireTest('@electric-sql/pglite');
const db = new PGlite();
try {
  // Only metadata; never restore real accounts/auth tokens into fixtures.
  for (const statement of splitSql(restore)) {
    if (/^(INSERT INTO|SELECT setval)/i.test(statement)) continue;
        if (process.argv.includes('--incremental') && /(?:public\."?(?:package_payment_[a-z_]+|payment_transfer_refs)"?|payments_easyslip_trans_ref_unique)/i.test(statement)) continue;
    await db.exec(statement);
  }
  await db.exec(fs.readFileSync(path.join(root, 'src/db/migrations/20261009_real_package_payments.sql'), 'utf8'));
  if (process.argv.includes('--incremental')) await db.exec(fs.readFileSync(path.join(root, 'src/db/migrations/20261010_payment_promptpay.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(root, 'src/db/migrations/payment-integration.test.sql'), 'utf8'));
  const { rows } = await db.query('SELECT (SELECT count(*) FROM members)::int AS members, (SELECT count(*) FROM package_payment_orders)::int AS orders');
  if (rows[0].members || rows[0].orders) throw new Error('Fixture rollback failed');
  console.log('PASS: full production table/type/constraint/index metadata in isolated PostgreSQL; payment fixtures rolled back. No live rows, live sequences, provider, SMS or funds touched.');
} finally { await db.close(); }
