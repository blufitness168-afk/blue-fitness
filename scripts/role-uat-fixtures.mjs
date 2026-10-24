import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import ts from 'typescript';
import { client, protect, local, save, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';

const marker = 'UAT_ROLE_20261023';
const file = path.join(local, 'role-uat-fixtures.json');
async function main() {
  if (process.argv.slice(2).some(x => !['--apply', '--preflight'].includes(x))) throw Error('Unknown argument');
  protect();
  const sql = client();
  const owners = await sql`SELECT member_code,role FROM members WHERE member_code IN ('BLU-1','BLU-2') ORDER BY id`;
  if (owners.length !== 2 || owners.some(x => x.role !== 'OWNER')) throw Error('Protected owner identities unexpected');
  if (fs.existsSync(file)) {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record.marker !== marker) throw Error('Marker mismatch');
    for (const f of record.accounts) {
      const rows = await sql`SELECT id,member_code,role FROM members WHERE id=${f.id} AND member_code=${f.memberCode} AND phone=${f.phone} AND full_name=${marker + '_' + f.role} AND role=${f.role} AND password_hash=${f.hash}`;
      if (rows.length !== 1) throw Error('Existing fixture mismatch; no automatic repair');
    }
    console.log(JSON.stringify({ state: record.state, accounts: record.accounts.map(({memberCode,role}) => ({memberCode,role})), reused: true }));
    return;
  }
  const existing = await sql`SELECT id FROM members WHERE full_name LIKE ${marker + '%'}`;
  if (existing.length) throw Error('Unrecorded fixtures require manual review');
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ preflight: true, protectedOwners: owners, plannedRoles: ['MEMBER','ADMIN'], mutations: false })); return;
  }
  const tables = (await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(x => x.tablename);
  const directory = await backup(sql, tables); await verify(directory, sql);
  // Compile the application's actual standalone password implementation, not a second hash format.
  const source = fs.readFileSync(new URL('../src/lib/auth/password.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  const { hashPassword, verifyPassword } = await import('data:text/javascript,' + encodeURIComponent(compiled));
  const record = { version: 1, marker, state: 'prepared', backup: directory, accounts: [] };
  for (const role of ['MEMBER','ADMIN']) {
    let phone;
    do { phone = '099' + String(randomBytes(4).readUInt32BE() % 10000000).padStart(7,'0'); }
    while ((await sql`SELECT id FROM members WHERE phone=${phone}`).length);
    const password = randomBytes(32).toString('base64url') + '!aA9';
    const hash = await hashPassword(password);
    if (!await verifyPassword(password, hash)) throw Error('Hash verification failed');
    const [{id}] = await sql.query("SELECT nextval(pg_get_serial_sequence('public.members','id'))::int AS id");
    record.accounts.push({ id, memberCode: 'BLU-' + id, phone, role, password, hash });
  }
  save(file, JSON.stringify(record, null, 2));
  await sql.transaction(record.accounts.map(f => sql.query('INSERT INTO members (id,member_code,phone,full_name,role,status,password_hash) VALUES ($1,$2,$3,$4,$5,\'ACTIVE\',$6) RETURNING id', [f.id,f.memberCode,f.phone,marker+'_'+f.role,f.role,f.hash])), {isolationLevel: 'Serializable'});
  record.state = 'created'; record.createdAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(record,null,2), {mode:0o600});
  console.log(JSON.stringify({state: record.state, accounts: record.accounts.map(({memberCode,role})=>({memberCode,role})), credentials: '.local-db/role-uat-fixtures.json', backup: path.relative(process.cwd(),directory)}));
}
main().catch(safeFailure);
