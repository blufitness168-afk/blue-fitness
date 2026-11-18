// Actual SQL, isolated in-memory PostgreSQL. No env, network, providers or real DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const { PGlite } = createRequire(new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url))('@electric-sql/pglite');
const read = p => readFileSync(new URL(p, import.meta.url),'utf8');
const hash = 'scrypt$32768$8$1$'+'a'.repeat(32)+'$'+'b'.repeat(128);
const newHash = hash.replace(/b/g,'c');

test('R2 password actual additive SQL', {timeout:120000}, async t => {
 const db=new PGlite();
 const rows=async(s,a=[]) => (await db.query(s,a)).rows;
 const one=async(s,a=[]) => (await rows(s,a))[0];
 const payload=(id=3,patch={})=>({memberCode:`PW-${id}`,reason:'Staff correction',bodyMac:'a'.repeat(64),...patch});
 let inTransaction=false;
 const action=async(p,key=randomUUID(),token='s2',encoded=null)=>{
  if(inTransaction)await db.exec('SAVEPOINT synthetic_action');
  try {
   const result=(await one('SELECT admin_member_password_action($1,$2,$3::jsonb,$4) AS result',[token,key,JSON.stringify(p),encoded])).result;
   if(inTransaction)await db.exec('RELEASE SAVEPOINT synthetic_action');
   return result;
  }catch(error){if(inTransaction)await db.exec('ROLLBACK TO SAVEPOINT synthetic_action; RELEASE SAVEPOINT synthetic_action');throw error;}
 };
 const rollback=async fn=>{await db.exec('BEGIN');inTransaction=true;try{await fn();}finally{await db.exec('ROLLBACK');inTransaction=false;}};
 const count=async table=>(await one(`SELECT count(*)::int AS n FROM ${table}`)).n;
 try {
  await db.exec(`
   CREATE TYPE member_role AS ENUM ('MEMBER','ADMIN','OWNER');
   CREATE TYPE member_status AS ENUM ('PENDING','ACTIVE','EXPIRED','SUSPENDED');
   CREATE TABLE members(id serial PRIMARY KEY,member_code text UNIQUE,phone text UNIQUE,role member_role,status member_status,
    password_hash text,full_name text,points integer DEFAULT 20,updated_at timestamptz DEFAULT now());
   CREATE TABLE auth_sessions(id serial PRIMARY KEY,member_id integer REFERENCES members(id),token_hash text UNIQUE,
    mode text DEFAULT 'NORMAL',expires_at timestamptz,revoked_at timestamptz);
   CREATE TABLE auth_otp_challenges(id serial PRIMARY KEY,phone text,purpose text,consumed_at timestamptz,password_hash_at_issue text,
    challenge_id text,code_hash text,attempts integer DEFAULT 0,max_attempts integer DEFAULT 5,expires_at timestamptz DEFAULT now()+interval '1 day');
   CREATE TABLE auth_password_tickets(id serial PRIMARY KEY,phone text,purpose text,consumed_at timestamptz,password_hash_at_issue text,
    token_hash text,hash_started_at timestamptz,expires_at timestamptz DEFAULT now()+interval '1 day');
   CREATE TABLE auth_signup_tickets(phone text,token_hash text,expires_at timestamptz);
   CREATE TABLE auth_login_limits(phone text PRIMARY KEY,attempts integer,window_start timestamptz);
   INSERT INTO members(member_code,phone,role,status,password_hash,full_name)
    SELECT 'PW-'||i,'synthetic-'||i,(CASE WHEN i=1 THEN 'OWNER' WHEN i IN (2,4) THEN 'ADMIN' ELSE 'MEMBER' END)::member_role,
    'ACTIVE','OLD_CREDENTIAL','Synthetic' FROM generate_series(1,7) i;
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) SELECT id,'s'||id,now()+interval '1 day' FROM members;
   INSERT INTO auth_sessions(member_id,token_hash,mode,expires_at) VALUES(3,'target-kiosk','KIOSK',now()+interval '1 day');
   INSERT INTO auth_otp_challenges(phone,purpose,password_hash_at_issue) VALUES
    ('synthetic-3','PASSWORD_RESET','OLD_CREDENTIAL'),('synthetic-3','PASSWORD_SETUP','OLD_CREDENTIAL'),('synthetic-3','REGISTER',NULL),('synthetic-5','PASSWORD_RESET','OTHER');
   INSERT INTO auth_password_tickets(phone,purpose,password_hash_at_issue) VALUES
    ('synthetic-3','PASSWORD_RESET','OLD_CREDENTIAL'),('synthetic-3','PASSWORD_SETUP','OLD_CREDENTIAL'),('synthetic-5','PASSWORD_RESET','OTHER');
  `);
  const before=await rows('SELECT * FROM members ORDER BY id');
  await db.exec(read('../db/migrations/20261118_R2_admin_member_password.sql'));
  await t.test('additive: no existing data changes',async()=>{
   assert.deepEqual(await rows('SELECT * FROM members ORDER BY id'),before);
   assert.equal(await count('admin_member_password_audit'),0);
  });
  await t.test('NORMAL/live persisted staff guard: missing/member/revoked/expired/kiosk/suspended/demoted',async()=>{
   for(const token of ['missing','s3'])await assert.rejects(action(payload(),randomUUID(),token),{code:'42501'});
   for(const sql of ["UPDATE auth_sessions SET mode='KIOSK' WHERE member_id=2",
    'UPDATE auth_sessions SET revoked_at=now() WHERE member_id=2',
    "UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE member_id=2",
    "UPDATE members SET status='SUSPENDED' WHERE id=2","UPDATE members SET role='MEMBER' WHERE id=2"])
    await rollback(async()=>{await db.exec(sql);await assert.rejects(action(payload()),{code:'42501'});});
   assert.equal(await count('admin_member_password_requests'),0);
  });
  await t.test('target matrix no self/OWNER; suspended denied, expired member allowed',async()=>{
   for(const [actor,id] of [[2,1],[2,2],[2,4],[1,1]])await assert.rejects(action(payload(id),randomUUID(),`s${actor}`),{code:'42501'});
   for(const [actor,id] of [[2,3],[1,3],[1,4]])await rollback(async()=>{
    const key=randomUUID();assert.equal(await action(payload(id),key,`s${actor}`),'claimed');
    assert.equal(await action(payload(id),key,`s${actor}`,hash),'done');
   });
   await rollback(async()=>{await db.exec("UPDATE members SET status='SUSPENDED' WHERE id=3");await assert.rejects(action(payload()),{code:'42501'});});
   await rollback(async()=>{await db.exec("UPDATE members SET status='EXPIRED' WHERE id=3");assert.equal(await action(payload()),'claimed');});
  });
  await t.test('strict SQL metadata allowlist / malformed hashes / no unclaimed completion',async()=>{
   for(const field of ['password','passwordHash','actorId','role','phone','points','expected','token'])
    await assert.rejects(action({...payload(),[field]:'spoof'}),{code:'22023'});
   for(const p of [[],null,{...payload(),reason:''},{...payload(),reason:'x'.repeat(241)}, {...payload(),bodyMac:'bad'}])
    await assert.rejects(action(p),{code:'22023'});
   await assert.rejects(action(payload(),randomUUID(),'s2',hash),{code:'P0001'});
   await rollback(async()=>{const k=randomUUID();await action(payload(),k);await assert.rejects(action(payload(),k,'s2','bad'),{code:'22023'});});
  });
  await t.test('claim once, exact replay no new work; changed password MAC/reason/target conflict',async()=>{
   await rollback(async()=>{
    const k=randomUUID();assert.equal(await action(payload(),k),'claimed');assert.equal(await action(payload(),k),'busy');
    for(const p of [payload(5),payload(3,{reason:'Changed'}),payload(3,{bodyMac:'b'.repeat(64)})])
     await assert.rejects(action(p,k),{code:'P0001'});
    assert.equal(await count('admin_member_password_audit'),0);
    assert.equal(await action(payload(),k,'s2',hash),'done');
    const snapshot=await rows('SELECT * FROM members ORDER BY id');
    assert.equal(await action(payload(),k),'done');
    assert.deepEqual(await rows('SELECT * FROM members ORDER BY id'),snapshot);
    assert.equal(await count('admin_member_password_audit'),1);
    await db.query('UPDATE members SET password_hash=$1 WHERE id=3',[newHash]);
    await db.exec("INSERT INTO auth_sessions(member_id,token_hash,expires_at) VALUES(3,'new-target-session',now()+interval '1 day'); INSERT INTO auth_password_tickets(phone,purpose,password_hash_at_issue) VALUES('synthetic-3','PASSWORD_RESET','NEWER')");
    assert.equal(await action(payload(),k,'s2',hash),'done');
    assert.equal((await one("SELECT revoked_at FROM auth_sessions WHERE token_hash='new-target-session'")).revoked_at,null);
    assert.equal((await one("SELECT consumed_at FROM auth_password_tickets WHERE password_hash_at_issue='NEWER'")).consumed_at,null);
    assert.equal((await one('SELECT password_hash FROM members WHERE id=3')).password_hash,newHash);
    await db.exec("UPDATE auth_sessions SET revoked_at=now() WHERE member_id=2");
    await assert.rejects(action(payload(),k),{code:'42501'});
    await db.exec("UPDATE auth_sessions SET revoked_at=NULL WHERE member_id=2");
    await db.exec("UPDATE members SET role='MEMBER' WHERE id=2");
    await assert.rejects(action(payload(),k),{code:'42501'});
    await db.exec("UPDATE members SET role='ADMIN' WHERE id=2");
    for(const p of [payload(5),payload(3,{reason:'Changed'}),payload(3,{bodyMac:'b'.repeat(64)})])await assert.rejects(action(p,k),{code:'P0001'});
   });
  });
  await t.test('finalize rechecks role/session/target and claim expiry/version after hashing',async()=>{
   for(const change of ["UPDATE members SET role='MEMBER' WHERE id=2", "UPDATE members SET role='OWNER' WHERE id=3",
    "UPDATE members SET status='SUSPENDED' WHERE id=3", "UPDATE auth_sessions SET revoked_at=now() WHERE member_id=2",
    "UPDATE auth_sessions SET mode='KIOSK' WHERE member_id=2", "UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE member_id=2"])
    await rollback(async()=>{const k=randomUUID();await action(payload(),k);await db.exec(change);await assert.rejects(action(payload(),k,'s2',hash),{code:'42501'});});
   await rollback(async()=>{const k=randomUUID();await action(payload(),k);await db.exec("UPDATE admin_member_password_requests SET created_at=now()-interval '3 minutes'");await assert.rejects(action(payload(),k,'s2',hash),{code:'P0001'});});
   // Distinct committed transactions matter: xmin is an MVCC transaction marker.
   for(const change of ["UPDATE members SET password_hash='NEWER_PASSWORD' WHERE id=7", "UPDATE members SET full_name='Other edit' WHERE id=7"]) {
    const k=randomUUID();await action(payload(7),k);await db.exec(change);
    await assert.rejects(action(payload(7),k,'s2',hash),{code:'P0001'});
    await db.query('DELETE FROM admin_member_password_requests WHERE request_key=$1',[k]);
    await db.exec("UPDATE members SET password_hash='OLD_CREDENTIAL',full_name='Synthetic',updated_at=(SELECT updated_at FROM members WHERE id=1) WHERE id=7");
   }
  });
  await t.test('persisted target / actor quotas count abandoned claims before hashing',async()=>{
   await rollback(async()=>{for(let i=0;i<3;i++)assert.equal(await action(payload()),'claimed');assert.equal(await action(payload()),'limited');assert.equal(await action(payload(),randomUUID(),'s1'),'limited');});
   await rollback(async()=>{for(const id of [3,3,5,5,6])assert.equal(await action(payload(id)),'claimed');assert.equal(await action(payload(7)),'limited');assert.equal(await count('admin_member_password_requests'),5);});
   await rollback(async()=>{
    await db.exec("INSERT INTO admin_member_password_requests(actor_id,request_key,member_id,reason,body_mac,target_version) SELECT 4,md5(i::text)::uuid,5,'Quota',repeat('a',64),'0' FROM generate_series(1,50) i");
    assert.equal(await action(payload()),'limited');
   });
  });
  await t.test('atomic update only credentials, revoke all target modes, invalidate only target password OTP/tickets',async()=>{
   await rollback(async()=>{
    const k=randomUUID();await action(payload(),k);await action(payload(),k,'s2',hash);
    const after=await rows('SELECT * FROM members ORDER BY id');
    assert.deepEqual(after.map(m=>({...m,password_hash:null,updated_at:null})),before.map(m=>({...m,password_hash:null,updated_at:null})));
    assert.equal(after[2].password_hash,hash);
    assert.equal((await one('SELECT count(*)::int AS n FROM auth_sessions WHERE member_id=3 AND revoked_at IS NULL')).n,0);
    assert.equal((await one('SELECT count(*)::int AS n FROM auth_sessions WHERE member_id<>3 AND revoked_at IS NOT NULL')).n,0);
    assert.equal((await one("SELECT count(*)::int AS n FROM auth_otp_challenges WHERE phone='synthetic-3' AND purpose LIKE 'PASSWORD%' AND consumed_at IS NULL")).n,0);
    assert.equal((await one("SELECT count(*)::int AS n FROM auth_password_tickets WHERE phone='synthetic-3' AND consumed_at IS NULL")).n,0);
    assert.equal((await one("SELECT consumed_at FROM auth_otp_challenges WHERE purpose='REGISTER'")).consumed_at,null);
    assert.equal((await one("SELECT consumed_at FROM auth_password_tickets WHERE phone='synthetic-5'")).consumed_at,null);
    const audit=await rows('SELECT * FROM admin_member_password_audit');
    assert.deepEqual(Object.keys(audit[0]).sort(),['id','actor_id','actor_role','member_id','request_key','reason','created_at'].sort());
    assert.doesNotMatch(JSON.stringify(audit),/scrypt|OLD_CREDENTIAL|body_mac|target_version|synthetic-3/);
    assert.equal(audit[0].actor_role,'ADMIN');
   });
  });
  await t.test('actual existing completePassword / verifyOtp reject old tickets/challenges after reset, before scrypt',async()=>{
   await rollback(async()=>{
    const crypto=createRequire(import.meta.url)('node:crypto');
    const ticket='SyntheticOldTicket';const challenge='SyntheticOldChallenge';const code='123456';
    await db.query("UPDATE auth_password_tickets SET token_hash=$1 WHERE phone='synthetic-3'",[crypto.createHash('sha256').update(ticket).digest('hex')]);
    await db.query("UPDATE auth_otp_challenges SET challenge_id=$1,code_hash=$2 WHERE phone='synthetic-3' AND purpose='PASSWORD_RESET'",[challenge,crypto.createHmac('sha256','OFFLINE_SECRET').update(`${challenge}:${code}`).digest('hex')]);
    const k=randomUUID();await action(payload(),k);await action(payload(),k,'s2',hash);
    let hashCalls=0;
    const sql=(parts,...args)=>rows(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),args);
    sql.transaction=async queries=>Promise.all(queries);
    const imports={'server-only':{},'node:crypto':crypto,'@neondatabase/serverless':{neon:()=>sql},'drizzle-orm':{},
     'next/headers':{},'@/db':{},'@/db/schema':{},'./password':{hashPassword:async()=>{hashCalls++;throw Error('must not hash');}},'./policy':{}};
    const exports={};
    vm.runInNewContext(ts.transpileModule(read('./auth/server.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
     {exports,require:n=>{assert.ok(n in imports,n);return imports[n];},process:{env:{DATABASE_URL:'OFFLINE',SMS_API_SECRET:'OFFLINE_SECRET'}},Buffer,Date});
    assert.equal(await exports.completePassword(ticket,'PASSWORD_RESET','SyntheticPassword'),false);
    assert.equal(await exports.completePassword(ticket,'PASSWORD_SETUP','SyntheticPassword'),false);
    assert.equal(await exports.verifyOtp(challenge,code),null);
    assert.equal(hashCalls,0);
    assert.equal((await one('SELECT password_hash FROM members WHERE id=3')).password_hash,hash);
   });
  });
  await t.test('audit failure rolls back password/session/ticket/completion, committed claim stays consumed for work',async()=>{
   await rollback(async()=>{
    const k=randomUUID();await action(payload(),k);
    await db.exec("CREATE FUNCTION synthetic_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure'; END $$; CREATE TRIGGER synthetic_fail BEFORE INSERT ON admin_member_password_audit FOR EACH ROW EXECUTE FUNCTION synthetic_fail()");
    await assert.rejects(action(payload(),k,'s2',hash));
    assert.deepEqual(await rows('SELECT * FROM members ORDER BY id'),before);
    assert.equal((await one("SELECT revoked_at FROM auth_sessions WHERE token_hash='s3'")).revoked_at,null);
    assert.equal((await one('SELECT completed_at FROM admin_member_password_requests')).completed_at,null);
    assert.equal(await action(payload(),k),'busy');
   });
  });
  await t.test('append-only audit and PUBLIC ACL deny',async()=>{
   for(const statement of ['UPDATE admin_member_password_audit SET reason=reason','DELETE FROM admin_member_password_audit','TRUNCATE admin_member_password_audit'])await assert.rejects(db.exec(statement));
   for(const name of ['admin_member_password_audit','admin_member_password_requests']) {
    const acl=(await one('SELECT relacl::text AS acl FROM pg_class WHERE relname=$1',[name])).acl;
    assert.doesNotMatch(acl,/(?:\{|,)=/);
   }
   const acl=(await one("SELECT proacl::text AS acl FROM pg_proc WHERE proname='admin_member_password_action'")).acl;
   assert.doesNotMatch(acl,/(?:\{|,)=/);
  });
  await t.test('reset definition locks stable member IDs before actor or target sessions',async()=>{
   const definition=(await one("SELECT pg_get_functiondef(oid) AS sql FROM pg_proc WHERE proname='admin_member_password_action'")).sql;
   const discovery=definition.indexOf('SELECT * INTO s FROM auth_sessions WHERE token_hash=p_session;');
   const members=definition.indexOf('ORDER BY id FOR UPDATE');
   const session=definition.indexOf('FROM auth_sessions WHERE token_hash=p_session FOR SHARE');
   const revoke=definition.indexOf('UPDATE auth_sessions SET revoked_at');
   assert.ok(discovery>=0 && discovery<members && members<session && session<revoke);
   assert.match(definition.slice(session),/s\.member_id IS DISTINCT FROM discovered_actor_id/);
   assert.match(definition.slice(session),/s\.revoked_at IS NOT NULL/);
   assert.match(definition.slice(session),/s\.mode IS DISTINCT FROM 'NORMAL'/);
   assert.ok(members<definition.indexOf('UPDATE auth_password_tickets SET consumed_at'));
  });
  await t.test('actual login/finalization SQL: explicit member locks, reset-first blocks old password, login-first is revoked',async()=>{
   const crypto=createRequire(import.meta.url)('node:crypto');
   const capture=[];
   let hashHook=async()=>{};let verifyHook=async()=>{};
   const sql=(parts,...args)=>{
    const query={text:parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),args};
    return {query,then:(resolve,reject)=>rows(query.text,query.args).then(resolve,reject)};
   };
   sql.transaction=async(queries,options)=>{
    assert.equal(options.isolationLevel,'Serializable');
    await db.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try{
     const result=[];
     for(const item of queries){
      capture.push(item.query.text);
      if(result.length){
       // A real table lock from the first SELECT FOR UPDATE must already be held.
       const locks=await rows("SELECT mode FROM pg_locks WHERE relation='members'::regclass AND pid=pg_backend_pid()");
       assert.ok(locks.some(lock=>lock.mode==='RowShareLock'));
      }
      result.push(await rows(item.query.text,item.query.args));
     }
     await db.exec('COMMIT');return result;
    }catch(error){await db.exec('ROLLBACK');throw error;}
   };
   const imports={'server-only':{},'node:crypto':crypto,'@neondatabase/serverless':{neon:()=>sql},'drizzle-orm':{},
    'next/headers':{},'@/db':{},'@/db/schema':{},'./password':{
     hashPassword:async()=>{await hashHook();return newHash;},
     verifyPassword:async()=>{await verifyHook();return true;},
    },'./policy':{}};
   const exports={};
   vm.runInNewContext(ts.transpileModule(read('./auth/server.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:n=>{assert.ok(n in imports,n);return imports[n];},process:{env:{DATABASE_URL:'OFFLINE'}},Buffer,Date});

   // Old credential verified before reset, issuance starts only after reset commits.
   verifyHook=async()=>{const k=randomUUID();await action(payload(6),k);await action(payload(6),k,'s2',hash);};
   assert.equal(await exports.loginPassword('synthetic-6','OldSyntheticPassword'),null);
   assert.equal((await one('SELECT count(*)::int AS n FROM auth_sessions WHERE member_id=6 AND revoked_at IS NULL')).n,0);
   assert.match(capture[0],/SELECT id FROM members WHERE id = \$1 FOR UPDATE/);
   assert.match(capture[1],/INSERT INTO auth_sessions/);
   assert.match(capture[1],/password_hash =.*status <> 'SUSPENDED'/s);

   // Status is also rechecked after verification, under the same issuance lock.
   const beforeSuspended=await count('auth_sessions');
   verifyHook=async()=>{await db.exec("UPDATE members SET status='SUSPENDED' WHERE id=4");};
   assert.equal(await exports.loginPassword('synthetic-4','SyntheticPassword'),null);
   assert.equal(await count('auth_sessions'),beforeSuspended);

   // Conversely a login that commits first is included in subsequent reset revocation.
   verifyHook=async()=>{};
   const login=await exports.loginPassword('synthetic-7','SyntheticPassword');assert.ok(login?.token);
   const sessionHash=crypto.createHash('sha256').update(login.token).digest('hex');
   assert.equal((await one('SELECT revoked_at FROM auth_sessions WHERE token_hash=$1',[sessionHash])).revoked_at,null);
   const k=randomUUID();await action(payload(7),k);await action(payload(7),k,'s2',hash);
   assert.ok((await one('SELECT revoked_at FROM auth_sessions WHERE token_hash=$1',[sessionHash])).revoked_at);

   // Completion claims once before hash; staff reset commits while hash work is in flight.
   const oldTicket='Synthetic-inflight-ticket';
   await db.query("INSERT INTO auth_password_tickets(phone,purpose,password_hash_at_issue,token_hash) VALUES('synthetic-5','PASSWORD_RESET','OLD_CREDENTIAL',$1)", [crypto.createHash('sha256').update(oldTicket).digest('hex')]);
   hashHook=async()=>{const key=randomUUID();await action(payload(5),key,'s1');await action(payload(5),key,'s1',hash);};
   capture.length=0;
   assert.equal(await exports.completePassword(oldTicket,'PASSWORD_RESET','SyntheticNewPassword'),false);
   assert.match(capture[0],/SELECT id FROM members.*SELECT phone FROM auth_password_tickets.*ORDER BY id FOR UPDATE/s);
   assert.match(capture[1],/WITH consumed.*m\.password_hash IS NOT DISTINCT FROM t\.password_hash_at_issue/s);
   assert.equal((await one('SELECT password_hash FROM members WHERE id=5')).password_hash,hash);

   // Completion-first invalidates a previously admitted staff claim, never gets overwritten.
   const pending=randomUUID();await action(payload(3),pending,'s1');
   const validTicket='Synthetic-completion-first';
   await db.query("INSERT INTO auth_password_tickets(phone,purpose,password_hash_at_issue,token_hash) VALUES('synthetic-3','PASSWORD_RESET','OLD_CREDENTIAL',$1)",[crypto.createHash('sha256').update(validTicket).digest('hex')]);
   hashHook=async()=>{};
   assert.equal(await exports.completePassword(validTicket,'PASSWORD_RESET','SyntheticNewPassword'),true);
   await assert.rejects(action(payload(3),pending,'s1',hash),{code:'P0001'});
   assert.equal((await one('SELECT password_hash FROM members WHERE id=3')).password_hash,newHash);
  });
 }finally{await db.close();}
});
