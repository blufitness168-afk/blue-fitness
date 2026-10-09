import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { migrationPlan, ready, quote, root } from './db-safety.mjs';

test('migration files parse into separately committed enum, additive and hardening phases', () => {
  const p = migrationPlan();
  assert.deepEqual(p.phases.map(s => s.length), [3, 6, 5]);
  assert.ok(p.phases[0].every(s => s.startsWith('ALTER TYPE')));
  assert.ok(p.phases[1].some(s => s.includes('CREATE TABLE IF NOT EXISTS auth_password_tickets')));
  assert.ok(p.phases[2].some(s => s.includes('hash_started_at')));
  assert.ok(p.phases.flat().every(s => !['BEGIN', 'COMMIT'].includes(s)));
  assert.ok(Object.values(p.hashes).every(h => /^[a-f0-9]{64}$/.test(h)));
});
test('schema readiness fails closed for missing columns, wrong enum types and nonunique indexes', () => {
  const columns = ['members.password_hash', 'coupons.source', 'auth_otp_challenges.password_hash_at_issue', 'auth_signup_tickets.hash_started_at', 'auth_password_tickets.hash_started_at', 'auth_password_tickets.password_hash_at_issue', 'auth_login_limits.attempts'].map(s => { const [table_name,column_name] = s.split('.'); return { table_name,column_name }; });
  const enums = [{ typname: 'auth_otp_purpose', enumlabel: 'PASSWORD_SETUP' }, { typname: 'auth_otp_purpose', enumlabel: 'PASSWORD_RESET' }, { typname: 'coupon_type', enumlabel: 'FREE_ENTRY' }];
  const indexes = [{ tablename: 'coupons', indexname: 'coupons_member_source_unique', indexdef: 'CREATE UNIQUE INDEX coupons_member_source_unique ON public.coupons USING btree (member_id, source)' }];
  assert.equal(ready({columns,enums,indexes}), true);
  assert.equal(ready({columns: columns.slice(1),enums,indexes}), false);
  assert.equal(ready({columns,enums: enums.map(e => ({...e,typname:'wrong'})),indexes}), false);
  assert.equal(ready({columns,enums,indexes: [{...indexes[0],indexdef:'CREATE INDEX x ON coupons (member_id, source)'}]}), false);
});
test('sensitive snapshots are explicitly gitignored and read-only/explicit execution guards remain', () => {
  assert.ok(fs.readFileSync(path.join(root,'.gitignore'),'utf8').includes('/.local-db/'));
  const backup = fs.readFileSync(path.join(root,'scripts/db-backup.mjs'),'utf8');
  assert.match(backup, /isolationLevel: 'RepeatableRead', readOnly: true/);
  const migration = fs.readFileSync(path.join(root,'scripts/db-migrate.mjs'),'utf8');
  assert.match(migration, /if \(!args.includes\('--apply'\)\) return/);
  assert.match(migration, /--all-writers-paused/);
  assert.match(migration, /await verify\(report.backup, sql\)/);
  const integration = fs.readFileSync(path.join(root,'scripts/db-integration.mjs'),'utf8');
  assert.match(integration, /if \(!ready\(await metadata\(sql\)\)\)/);
  assert.match(integration, /if \(!args.includes\('--run-fixtures'\)\)/);
  assert.doesNotMatch(integration, /\.sendOtp\(|\.verifyOtp\(|\.completeRegistration\(/);
  assert.match(integration, /full_name=\$\{marker\}/);
  assert.equal(quote('a"b'), '"a""b"');
});
