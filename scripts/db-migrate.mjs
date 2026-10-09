import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { client, local, protect, save, stamp, metadata, ready, migrationPlan, quote, tables, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !['--apply', '--all-writers-paused', '--dry-run'].includes(a)) || (args.includes('--apply') && args.includes('--dry-run'))) throw new Error('Invalid arguments');
  const plan = migrationPlan(), sql = client(), schema = await metadata(sql);
  const uniquePhone = schema.indexes.some(i => i.tablename === 'members' && /CREATE UNIQUE INDEX .*\(phone\)/.test(i.indexdef));
  const baseline = ['members', 'coupons', 'auth_otp_challenges', 'auth_signup_tickets', 'auth_sessions'].every(t => schema.columns.some(c => c.table_name === t));
  const summary = { mode: args.includes('--apply') ? 'apply' : 'read-only preflight', baseline, uniquePhone, hardenedSchema: ready(schema), migrationHashes: plan.hashes, phaseStatements: plan.phases.map(p => p.length), order: ['enum transaction COMMIT', 'password_welcome transaction COMMIT', 'auth_review_hardening transaction COMMIT'], requires: 'Pause ALL local/remote DB writers, then --apply --all-writers-paused. Assertion cannot prove remote pause.' };
  console.log(JSON.stringify(summary, null, 2));
  if (!baseline || !uniquePhone) throw new Error('Baseline or unique phone index missing');
  if (!args.includes('--apply')) return;
  if (!args.includes('--all-writers-paused')) throw new Error('All writers must be paused explicitly');
  if (ready(schema)) throw new Error('Already hardened: refusing to invalidate credentials again');
  if (process.platform === 'win32') {
    const processes = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter 'name = ''node.exe''' | Select-Object -ExpandProperty CommandLine"], { encoding: 'utf8' });
    if (processes.split('\n').some(l => /next/i.test(l) && /blue-fitness/i.test(l))) throw new Error('Local Next instance still running');
  }
  protect();
  const reportPath = path.join(local, 'migration-' + stamp() + '.json');
  const report = { startedAt: new Date().toISOString(), hashes: plan.hashes, phasesCommitted: [], backup: null, outcome: 'started' };
  save(reportPath, JSON.stringify(report, null, 2));
  const record = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  try {
    report.backup = await backup(sql); record();
        await verify(report.backup, sql);
    const backed = JSON.parse(fs.readFileSync(path.join(report.backup, 'snapshot.json'), 'utf8'));
    for (let phase = 0; phase < plan.phases.length; phase++) {
      if (JSON.stringify(migrationPlan().hashes) !== JSON.stringify(plan.hashes)) throw new Error('Migration files changed during run');
      // Detect data drift between read snapshot and lock acquisition; fail the entire phase on drift.
      const current = await metadata(sql);
      const present = tables.filter(t => current.columns.some(c => c.table_name === t));
      const snapshot = await sql.transaction(present.map(t => sql.query(`SELECT coalesce(json_agg(t ORDER BY to_jsonb(t)::text),'[]'::json)::text AS rows FROM public.${quote(t)} t`)), { isolationLevel: 'RepeatableRead', readOnly: true });
      if (phase < 2 && present.some((t, i) => backed.tables[t]?.rows !== snapshot[i][0].rows)) throw new Error('Data changed since backup; pause writers and retry with fresh backup');
            const checks = present.map((t, i) => {
        const hash = createHash('md5').update(snapshot[i][0].rows).digest('hex');
        return sql.query(`SELECT 1 / CASE WHEN md5((SELECT coalesce(json_agg(t ORDER BY to_jsonb(t)::text),'[]'::json)::text FROM public.${quote(t)} t)) = $1 THEN 1 ELSE 0 END AS snapshot_unchanged`, [hash]);
      });
      await sql.transaction([
        sql.query("SET LOCAL lock_timeout = '5s'"), sql.query("SET LOCAL statement_timeout = '60s'"),
        sql.query('LOCK TABLE ' + present.map(t => 'public.' + quote(t)).join(',') + ' IN ACCESS EXCLUSIVE MODE'),
        ...checks, ...plan.phases[phase].map(s => sql.query(s)),
      ], { isolationLevel: 'Serializable' });
      report.phasesCommitted.push(phase + 1); record();
    }
    if (!ready(await metadata(sql))) throw new Error('Post-migration schema validation failed');
    report.outcome = 'applied; restart hardened application before accepting traffic';
  } catch (error) {
    report.outcome = 'failed; inspect phasesCommitted; earlier phases cannot be rolled back automatically';
    report.errorCode = /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : 'suppressed';
    throw error;
  } finally { report.finishedAt = new Date().toISOString(); record(); console.log(JSON.stringify({ report: path.relative(process.cwd(), reportPath), phasesCommitted: report.phasesCommitted, outcome: report.outcome })); }
}
main().catch(safeFailure);
