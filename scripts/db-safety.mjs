import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

export const root = path.resolve(import.meta.dirname, '..');
export const local = path.join(root, '.local-db');
export const tables = ['members', 'coupons', 'auth_otp_challenges', 'auth_signup_tickets', 'auth_password_tickets', 'auth_login_limits', 'auth_sessions', 'checkins'];
export const quote = s => '"' + s.replaceAll('"', '""') + '"';
export const digest = s => createHash('sha256').update(s).digest('hex');
export function client() {
  for (const name of ['.env.local', '.env']) dotenv.config({ path: path.join(root, name), quiet: true });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  return neon(process.env.DATABASE_URL);
}
export function protect() {
  execFileSync('git', ['check-ignore', '--quiet', '.local-db/probe'], { cwd: root });
  fs.mkdirSync(local, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const user = execFileSync('whoami.exe', [], { encoding: 'utf8' }).trim();
    // Remove inherited grants before any credential snapshot is written.
    execFileSync('icacls.exe', [local, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`, 'SYSTEM:(OI)(CI)F'], { stdio: 'pipe' });
  } else fs.chmodSync(local, 0o700);
}
export function save(file, content) { fs.writeFileSync(file, content, { mode: 0o600, flag: 'wx' }); }
export const stamp = () => new Date().toISOString().replaceAll(':', '-');
export function migrationPlan() {
  const names = ['20261009_password_welcome.sql', '20261009_auth_review_hardening.sql'];
  const files = names.map(name => ({ name, text: fs.readFileSync(path.join(root, 'src/db/migrations', name), 'utf8') }));
  const statements = text => text.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
  const first = statements(files[0].text), second = statements(files[1].text);
  if (first.length !== 9 || !first.slice(0, 3).every(s => /^ALTER TYPE .* ADD VALUE IF NOT EXISTS /.test(s)) || second[0] !== 'BEGIN' || second.at(-1) !== 'COMMIT') throw new Error('Migration shape changed: review parser before applying');
  return { hashes: Object.fromEntries(files.map(f => [f.name, digest(f.text)])), phases: [first.slice(0, 3), first.slice(3), second.slice(1, -1)] };
}
export async function metadata(sql) {
  const [columns, enums, indexes] = await sql.transaction([
    sql.query("SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position"),
    sql.query("SELECT t.typname,e.enumlabel FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder"),
    sql.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname"),
  ], { isolationLevel: 'RepeatableRead', readOnly: true });
  return { columns, enums, indexes };
}
export function ready(m) {
  return ['members.password_hash', 'coupons.source', 'auth_otp_challenges.password_hash_at_issue', 'auth_signup_tickets.hash_started_at', 'auth_password_tickets.hash_started_at', 'auth_password_tickets.password_hash_at_issue', 'auth_login_limits.attempts'].every(k => m.columns.some(c => `${c.table_name}.${c.column_name}` === k)) && [['auth_otp_purpose', 'PASSWORD_SETUP'], ['auth_otp_purpose', 'PASSWORD_RESET'], ['coupon_type', 'FREE_ENTRY']].every(([type, value]) => m.enums.some(e => e.typname === type && e.enumlabel === value)) && m.indexes.some(i => i.tablename === 'coupons' && i.indexname === 'coupons_member_source_unique' && /CREATE UNIQUE INDEX .*\(member_id, source\)/.test(i.indexdef));
}
export function safeFailure(error) { console.error(JSON.stringify({ error: 'Operation failed; sensitive details suppressed', code: /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : undefined })); process.exitCode = 1; }
