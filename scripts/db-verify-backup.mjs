import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { client, local, digest, quote, safeFailure } from './db-safety.mjs';

export async function verify(directory, sql = client()) {
  const dir = path.resolve(directory);
  if (!dir.startsWith(local + path.sep)) throw new Error('Backup must be inside protected .local-db');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (!['snapshot.json', 'restore-empty.sql'].includes(file)) throw new Error('Unexpected manifest file');
    assert.equal(digest(fs.readFileSync(path.join(dir, file))), hash);
  }
  const snapshot = JSON.parse(fs.readFileSync(path.join(dir, 'snapshot.json'), 'utf8'));
  const names = Object.keys(snapshot.tables);
  // This is SELECT only: PostgreSQL validates every restored record against current table types.
  const results = await sql.transaction(names.map(t => {
    if (!/^[a-z_]+$/.test(t)) throw new Error('Invalid backup table');
    const rows = JSON.parse(snapshot.tables[t].rows);
    assert.equal(rows.length, manifest.counts[t]);
    assert.equal(rows.length, Number(snapshot.tables[t].row_count));
    const columns = snapshot.columns.filter(c => c.table_name === t).map(c => c.column_name);
    for (const row of rows) assert.deepEqual(Object.keys(row).sort(), [...columns].sort());
    return sql.query(`SELECT count(*)::text AS n FROM json_populate_recordset(NULL::public.${quote(t)}, $1::json)`, [snapshot.tables[t].rows]);
  }), { isolationLevel: 'RepeatableRead', readOnly: true });
  names.forEach((t, i) => assert.equal(Number(results[i][0].n), manifest.counts[t]));
  console.log(JSON.stringify({ verifiedBackup: path.relative(process.cwd(), dir), counts: manifest.counts, checks: 'SHA256, JSON, column coverage, PostgreSQL record conversion and row counts; no restore executed' }));
  return true;
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  if (process.argv.length !== 3) { console.error('Usage: node scripts/db-verify-backup.mjs .local-db/backup-TIMESTAMP'); process.exitCode = 2; }
  else verify(process.argv[2]).catch(safeFailure);
}
