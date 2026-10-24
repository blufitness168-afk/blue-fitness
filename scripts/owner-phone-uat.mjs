// Local operator-only UAT helper. Never serves a route, sends SMS, or creates a session.
import fs from 'node:fs';
import path from 'node:path';
import { client, protect, local, save, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';

const recordPath = path.join(local, 'owner-phone-uat.json');
export async function run(args = process.argv.slice(2)) {
  const allowed = new Set(['--park', '--promote', '--restore', '--apply', '--phone', '--member-code']);
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw Error('Unexpected argument');
    if (['--phone', '--member-code'].includes(args[i])) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('Missing argument');
      values[args[i]] = args[++i];
    }
  }
  const modes = ['--park', '--promote', '--restore'].filter(a => args.includes(a));
  if (modes.length !== 1) throw Error('Choose one operator operation');
  const apply = args.includes('--apply');
  protect();
  const sql = client();
  if (modes[0] === '--park') {
    const phone = values['--phone'], code = values['--member-code'];
    if (!/^0[689]\d{8}$/.test(phone ?? '') || !/^BLU-\d+$/.test(code ?? '')) throw Error('Explicit valid test phone and member code required');
    if (fs.existsSync(recordPath)) throw Error('Existing UAT record: inspect/restore rather than overwriting');
    const parked = `TEST-PARKED-${code}`;
    if (parked.length > 20) throw Error('Parking marker exceeds phone column');
    const rows = await sql`SELECT id,member_code,role,phone,status FROM members WHERE phone=${phone} AND member_code=${code}`;
    if (rows.length !== 1 || rows[0].role !== 'OWNER') throw Error('Expected owner identity not found');
    const id = rows[0].id;
    const collisions = await sql`SELECT id FROM members WHERE phone=${parked}`;
    if (collisions.length) throw Error('Parking marker already exists');
    console.log(JSON.stringify({ operation: 'park', apply, memberCode: code, ownerId: id, sessionRevocation: true, keepsPayments: true }));
    if (!apply) return;
    const tables = (await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r => r.tablename);
    const dir = await backup(sql, tables);
    await verify(dir, sql);
    // Write recovery metadata before mutation; never overwrite on retry.
    const record = { version: 1, originalPhone: phone, parkedPhone: parked, ownerId: id, memberCode: code, backup: dir, state: 'prepared', preparedAt: new Date().toISOString() };
    save(recordPath, JSON.stringify(record, null, 2));
    const result = await sql.transaction([
      sql.query("SET LOCAL lock_timeout='5s'"), sql.query("SET LOCAL statement_timeout='30s'"),
      sql.query("WITH target AS (SELECT id FROM members WHERE id=$1 AND member_code=$2 AND phone=$3 AND role='OWNER' FOR UPDATE) SELECT 1 / CASE WHEN count(*)=1 THEN 1 ELSE 0 END AS identity_guard FROM target", [id, code, phone]),
      sql.query('UPDATE members SET phone=$1,updated_at=clock_timestamp() WHERE id=$2 AND phone=$3 AND role=\'OWNER\' RETURNING id,updated_at', [parked, id, phone]),
      sql.query('UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE member_id=$1 AND revoked_at IS NULL', [id]),
      sql.query('UPDATE auth_otp_challenges SET consumed_at=clock_timestamp() WHERE phone=$1 AND consumed_at IS NULL', [phone]),
      sql.query('UPDATE auth_signup_tickets SET consumed_at=clock_timestamp() WHERE phone=$1 AND consumed_at IS NULL', [phone]),
      sql.query('UPDATE auth_password_tickets SET consumed_at=clock_timestamp() WHERE phone=$1 AND consumed_at IS NULL', [phone]),
      sql.query('SELECT count(*)::int AS active_sessions FROM auth_sessions WHERE member_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()', [id]),
    ], { isolationLevel: 'Serializable' });
    if (result[3].length !== 1 || result[8][0].active_sessions !== 0) throw Error('Inspect protected recovery record: postcondition failed');
    record.state = 'parked'; record.parkedAt = result[3][0].updated_at;
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ result: 'parked', memberCode: code, sessionsRevoked: true, realPhoneAvailableForRegistration: true, record: '.local-db/owner-phone-uat.json', noPaymentChanges: true }));
    return;
  }
  if (!fs.existsSync(recordPath)) throw Error('Protected UAT record required');
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  if (record.state !== 'parked') throw Error('Operation requires a parked record');
  const old = await sql`SELECT id FROM members WHERE id=${record.ownerId} AND member_code=${record.memberCode} AND phone=${record.parkedPhone} AND role='OWNER'`;
  if (old.length !== 1) throw Error('Parked identity no longer matches');
  if (modes[0] === '--restore') {
    if ((await sql`SELECT id FROM members WHERE phone=${record.originalPhone}`).length) throw Error('Real phone already belongs to a new account; cannot restore');
    if (!apply) { console.log(JSON.stringify({ operation: 'restore', apply: false })); return; }
    const rows = await sql`UPDATE members SET phone=${record.originalPhone},updated_at=clock_timestamp() WHERE id=${record.ownerId} AND phone=${record.parkedPhone} AND role='OWNER' RETURNING id`;
    if (rows.length !== 1) throw Error('Restore failed');
    record.state = 'restored'; record.restoredAt = new Date().toISOString();
  } else {
    const candidates = await sql`SELECT m.id,m.member_code,m.role FROM members m
      WHERE m.phone=${record.originalPhone} AND m.id<>${record.ownerId} AND m.role='MEMBER' AND m.status<>'SUSPENDED'
      AND m.password_hash IS NOT NULL AND m.created_at>=${record.parkedAt}::timestamptz
      AND EXISTS(SELECT 1 FROM auth_signup_tickets t WHERE t.phone=m.phone AND t.consumed_at>=${record.parkedAt}::timestamptz)
      AND EXISTS(SELECT 1 FROM auth_otp_challenges c WHERE c.phone=m.phone AND c.purpose='REGISTER' AND c.consumed_at>=${record.parkedAt}::timestamptz)
      AND EXISTS(SELECT 1 FROM coupons c WHERE c.member_id=m.id AND c.source='WELCOME_REGISTRATION')`;
    if (candidates.length !== 1) throw Error('Complete genuine OTP registration before promotion');
    const member = candidates[0];
    console.log(JSON.stringify({ operation: 'promote', apply, memberCode: member.member_code, newId: member.id, requiresGenuineRegistration: true }));
    if (!apply) return;
    const rows = await sql`UPDATE members SET role='OWNER',updated_at=clock_timestamp() WHERE id=${member.id} AND phone=${record.originalPhone} AND role='MEMBER' AND status<>'SUSPENDED' RETURNING id`;
    if (rows.length !== 1) throw Error('Promotion identity changed');
    record.state = 'promoted'; record.newOwnerId = member.id; record.newMemberCode = member.member_code; record.promotedAt = new Date().toISOString();
  }
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ result: record.state, originalPurchasesRemainWithParkedAccount: true, noSessionsCreated: true }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) run().catch(safeFailure);
