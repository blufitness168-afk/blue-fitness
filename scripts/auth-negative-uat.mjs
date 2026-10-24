import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { client, protect, local, stamp, quote, safeFailure } from './db-safety.mjs';
import { backup } from './db-backup.mjs';
import { verify } from './db-verify-backup.mjs';

const base = 'http://localhost:3000';
const random = n => randomBytes(n).toString('hex');
const hash = s => createHash('sha256').update(s).digest('hex');
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
async function cleanup(file) {
  const lease = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (lease.cleaned) return;
  const sql = client();
  const statements = [sql.query("SET LOCAL statement_timeout='20s'"), sql.query("SET LOCAL lock_timeout='5s'")];
  for (const id of lease.challenges) statements.push(sql.query('DELETE FROM auth_otp_challenges WHERE challenge_id=$1 AND phone=$2', [id, lease.phone]));
  for (const token of lease.tickets) statements.push(sql.query('DELETE FROM auth_password_tickets WHERE token_hash=$1 AND phone=$2', [token, lease.phone]));
  for (const token of lease.sessions) statements.push(sql.query('UPDATE auth_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE token_hash=$1 AND member_id=$2', [token, lease.memberId]));
  statements.push(sql.query('DELETE FROM auth_login_limits WHERE phone=$1', [lease.phone]));
  if (lease.limit) statements.push(sql.query('INSERT INTO auth_login_limits(phone,attempts,window_start) VALUES($1,$2,$3::timestamptz)', [lease.phone, lease.limit.attempts, lease.limit.window_start]));
  await sql.transaction(statements, { isolationLevel: 'Serializable' });
  lease.cleaned = true; write(file, lease);
}
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--watchdog') {
    const file = path.resolve(args[1] || '');
    if (!file.startsWith(local + path.sep) || path.basename(file) !== 'lease.json') throw Error('Invalid lease');
    await new Promise(r => setTimeout(r, 240000));
    await cleanup(file); return;
  }
  if (args.some(a => a !== '--run')) throw Error('Unknown argument');
  if (!args.includes('--run')) {
    console.log(JSON.stringify({ preview: true, target: base, fixtures: ['BLU-3 MEMBER', 'BLU-4 ADMIN'], sms: 'none; malformed requests, rejected LOGIN purpose and duplicate REGISTER only', writes: 'exact synthetic challenge/ticket IDs; BLU-3 login quota restored; actual login sessions revoked', execute: 'node scripts/auth-negative-uat.mjs --run' })); return;
  }
  protect();
  const sql = client();
  if (!process.env.SMS_API_SECRET) throw Error('Missing secret');
  const fixtures = JSON.parse(fs.readFileSync(path.join(local, 'role-uat-fixtures.json'), 'utf8'));
  if (fixtures.state !== 'created' || fixtures.accounts.length !== 2) throw Error('Fixture state');
  const member = fixtures.accounts.find(a => a.memberCode === 'BLU-3' && a.role === 'MEMBER');
  const admin = fixtures.accounts.find(a => a.memberCode === 'BLU-4' && a.role === 'ADMIN');
  if (!member || !admin) throw Error('Fixture scope');
  for (const a of [member, admin]) {
    const rows = await sql.query('SELECT id FROM members WHERE id=$1 AND member_code=$2 AND phone=$3 AND role=$4 AND password_hash=$5 AND full_name=$6', [a.id,a.memberCode,a.phone,a.role,a.hash,fixtures.marker+'_'+a.role]);
    if (rows.length !== 1 || !/^0[689]\d{8}$/.test(a.phone)) throw Error('Fixture identity');
  }
  await fetch(base + '/api/auth/me', { signal: AbortSignal.timeout(15000), redirect: 'error' });
  const tables = (await sql.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r=>r.tablename);
  const backupDir = await backup(sql, tables); await verify(backupDir, sql);
  const snapshot = JSON.parse(fs.readFileSync(path.join(backupDir, 'snapshot.json'), 'utf8'));
  const directory = path.join(local, 'auth-negative-uat-' + stamp()); fs.mkdirSync(directory, { mode: 0o700 });
  const leaseFile = path.join(directory, 'lease.json');
  const limits = await sql.query('SELECT phone,attempts,window_start::text AS window_start FROM auth_login_limits WHERE phone=$1', [member.phone]);
  const lease = { phone: member.phone, memberId: member.id, limit: limits[0] ?? null, challenges: [], tickets: [], sessions: [], cleaned: false };
  write(leaseFile, lease);
  const watcher = spawn(process.execPath, [import.meta.filename, '--watchdog', leaseFile], { detached: true, stdio: 'ignore', windowsHide: true }); watcher.unref();
  const results = [];
  const add = (name, pass, evidence={}) => { const item={name,pass,...evidence}; results.push(item); console.log(JSON.stringify(item)); };
  const deadline = Date.now()+180000;
  async function api(name, endpoint, data, expected, cookie) {
    if (Date.now()>deadline) throw Error('Bounded run deadline');
    const res = await fetch(base+'/api/auth/'+endpoint, { method: data === undefined ? 'GET':'POST', headers: { Origin: base, 'Content-Type':'application/json', ...(cookie?{Cookie:cookie}:{}) }, ...(data===undefined?{}:{body:JSON.stringify(data)}), redirect:'error', signal:AbortSignal.timeout(15000) });
    const body = await res.json();
    add(name, res.status===expected, {status:res.status,expected});
    if (endpoint==='verify') add(name+' no session disclosure', !res.headers.has('set-cookie') && !Object.keys(body).some(k=>/session|token|cookie/i.test(k)));
    return {res,body};
  }
  async function challenge(options={}) {
    const id=random(16), code=String(randomBytes(4).readUInt32BE()%1000000).padStart(6,'0');
    lease.challenges.push(id); write(leaseFile,lease);
    const digest=createHmac('sha256',process.env.SMS_API_SECRET).update(id+':'+code).digest('hex');
    await sql.query(`INSERT INTO auth_otp_challenges(phone,challenge_id,code_hash,purpose,password_hash_at_issue,expires_at,consumed_at,attempts,max_attempts) VALUES($1,$2,$3,$4,$5,now()+($6 * interval '1 second'),CASE WHEN $7 THEN now() ELSE NULL END,$8,5)`, [member.phone,id,digest,options.purpose??'PASSWORD_RESET',options.stale?'stale-snapshot':member.hash,options.expired?-60:300,!!options.consumed,options.max?5:0]);
    return {challengeId:id,code};
  }
  const password = random(20)+'Aa!9';
  try {
    await api('legacy LOGIN removed','request',{phone:member.phone,purpose:'LOGIN'},410);
    await api('malformed password OTP phone','password/request',{phone:'invalid',purpose:'PASSWORD_RESET'},400);
    await api('invalid LOGIN purpose before adapter','password/request',{phone:member.phone,purpose:'LOGIN'},400);
    await api('malformed registration phone','register/request',{phone:'invalid'},400);
    for (const a of [member,admin]) await api('duplicate REGISTER '+a.memberCode,'register/request',{phone:a.phone},409);
    await api('malformed challenge','verify',{challengeId:'bad',code:'000000'},400);
    await api('malformed code','verify',{challengeId:random(16),code:'bad'},400);
    await api('missing challenge','verify',{challengeId:random(16),code:'000000'},401);
    let c=await challenge();
    const wrong={...c,code:c.code==='000000'?'000001':'000000'};
    await api('wrong OTP','verify',wrong,401);
    const [attempt]=await sql.query('SELECT attempts,consumed_at FROM auth_otp_challenges WHERE challenge_id=$1',[c.challengeId]);
    add('wrong OTP persists one attempt',attempt.attempts===1 && attempt.consumed_at===null);
    for(const [name,options] of [['expired OTP',{expired:true}],['consumed OTP',{consumed:true}],['max attempts OTP',{max:true}],['stale password snapshot OTP',{stale:true}],['old LOGIN challenge',{purpose:'LOGIN'}]]) {
      c=await challenge(options); await api(name,'verify',c,401);
    }
    c=await challenge(); await challenge(); await api('newer invalidates older OTP','verify',c,401);
    await api('missing password ticket','password/complete',{purpose:'PASSWORD_RESET',password},400);
    await api('malformed password ticket','password/complete',{ticket:'bad',purpose:'PASSWORD_RESET',password},400);
    await api('unknown password ticket','password/complete',{ticket:random(32),purpose:'PASSWORD_RESET',password},409);
    await api('wrong password purpose','password/complete',{ticket:random(32),purpose:'REGISTER',password},400);
    for(const kind of ['consumed','expired','wrong-purpose','stale-scope']) {
      const ticket=random(32), tokenHash=hash(ticket); lease.tickets.push(tokenHash); write(leaseFile,lease);
      await sql.query(`INSERT INTO auth_password_tickets(phone,purpose,password_hash_at_issue,token_hash,expires_at,consumed_at) VALUES($1,$2,$3,$4,now()+($5 * interval '1 second'),CASE WHEN $6 THEN now() ELSE NULL END)`,[member.phone,kind==='wrong-purpose'?'PASSWORD_SETUP':'PASSWORD_RESET',kind==='stale-scope'?'stale-snapshot':member.hash,tokenHash,kind==='expired'?-60:300,kind==='consumed']);
      await api(kind+' password ticket','password/complete',{ticket,purpose:'PASSWORD_RESET',password},409);
      if(kind==='consumed') await api('consumed ticket replay','password/complete',{ticket,purpose:'PASSWORD_RESET',password},409);
      const [row]=await sql.query('SELECT hash_started_at FROM auth_password_tickets WHERE token_hash=$1',[tokenHash]); add(kind+' avoids password hashing',row.hash_started_at===null);
    }
    await sql.query('DELETE FROM auth_login_limits WHERE phone=$1',[member.phone]);
    const {res}=await api('actual fixture password login','login',{phone:member.phone,password:member.password},200);
    const cookie=res.headers.get('set-cookie')?.match(/blu_session=([a-f0-9]{64})/);
    if(!cookie) throw Error('No actual login cookie');
    const tokenHash=hash(cookie[1]); lease.sessions.push(tokenHash); write(leaseFile,lease);
    const [session]=await sql.query('SELECT id FROM auth_sessions WHERE token_hash=$1 AND member_id=$2',[tokenHash,member.id]);
    if(!session) throw Error('Login DB connection mismatch');
    const identity=await api('actual cookie identity','me',undefined,200,cookie[0]); add('fixture cookie identity',identity.body.member?.memberCode===member.memberCode);
    await sql.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE id=$1 AND token_hash=$2",[session.id,tokenHash]);
    let me=await api('expired actual login session','me',undefined,200,cookie[0]); add('expired cookie rejected',me.body.member===null);
    await sql.query("UPDATE auth_sessions SET expires_at=now()+interval '1 hour',revoked_at=now() WHERE id=$1 AND token_hash=$2",[session.id,tokenHash]);
    me=await api('revoked actual login session','me',undefined,200,cookie[0]); add('revoked cookie rejected',me.body.member===null);
    await sql.query('DELETE FROM auth_login_limits WHERE phone=$1',[member.phone]);
    for(let i=1;i<=6;i++) await api('persistent wrong login '+i,'login',{phone:member.phone,password},i<=5?401:429);
    const [quota]=await sql.query('SELECT attempts,window_start > now()-interval \'15 minutes\' AS current FROM auth_login_limits WHERE phone=$1',[member.phone]);
    add('quota persisted 5 within 15 minutes',quota.attempts===5 && quota.current===true);
    await sql.query("UPDATE auth_login_limits SET window_start=now()-interval '16 minutes' WHERE phone=$1",[member.phone]);
    await api('quota resets after elapsed window','login',{phone:member.phone,password},401);
    const [reset]=await sql.query('SELECT attempts FROM auth_login_limits WHERE phone=$1',[member.phone]); add('elapsed quota restarts at 1',reset.attempts===1);
  } catch { add('bounded execution completed',false,{error:'Details suppressed; inspect case statuses'}); }
  finally {
    try { await cleanup(leaseFile); add('exact-ID cleanup and quota restore',true); } catch { add('exact-ID cleanup and quota restore',false); }
    if(JSON.parse(fs.readFileSync(leaseFile,'utf8')).cleaned) watcher.kill();
    for(const table of tables) {
      const rows=await sql.query(`SELECT coalesce(json_agg(t ORDER BY to_jsonb(t)::text),'[]'::json)::text AS rows FROM public.${quote(table)} t`);
      let current=JSON.parse(rows[0].rows), before=JSON.parse(snapshot.tables[table].rows);
      if(table==='auth_sessions') current=current.filter(r=>!lease.sessions.includes(r.token_hash));
      add('baseline unchanged '+table,JSON.stringify(current)===JSON.stringify(before),{beforeCount:before.length,afterCount:current.length});
    }
    const report={target:base,results,pass:results.filter(r=>r.pass).length,fail:results.filter(r=>!r.pass).length,createdChallengeIds:lease.challenges,createdSessionTokenHashesOmitted:true,createdTicketCount:lease.tickets.length,backup:path.relative(process.cwd(),backupDir),limits:['Synthetic DB challenges are not positive SMS delivery evidence','No SMS delivery/provider failure or API cross-connection proof','Serial sequences advance and are not rewound','Only dedicated fixtures; no fixture password changes; created login sessions retained revoked']};
    write(path.join(directory,'report.json'),report);
    console.log(JSON.stringify({pass:report.pass,fail:report.fail,report:path.relative(process.cwd(),path.join(directory,'report.json'))}));
    if(report.fail) process.exitCode=1;
  }
}
main().catch(safeFailure);
