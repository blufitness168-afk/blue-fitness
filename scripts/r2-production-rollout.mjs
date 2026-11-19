import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { client, root, local, protect, save, stamp, digest, quote, safeFailure } from './db-safety.mjs';
import { splitSql } from './db-payments-sql.mjs';

const literal = v => "'" + String(v).replaceAll("'", "''") + "'";
const approved = {
  '20261118_R2_admin_member_profile.sql': '9d3b5f4722113fcae20513928ccba52876b90ed0029059d8009a5e0247c12cdc',
  '20261118_R2_admin_member_password.sql': '1e2122644fffd107dcd6c359320b1a67b2fc43f37ddebf5b3a5e3402136b3e08',
  '20261118_R2_member_contact_email.sql': '865febf7807952fcf2c68a71e4c7e4f15272a32235d0d61b05add1ad558aaccd',
};
const cardAvatarSources = {
  '20261118_R2_member_cards.sql': '79a1f5f131efeb7d09f06efefa1eb91112454b0898900765a1a380faeab8c545',
  '20261118_R2_staff_avatar.sql': '492bac193b2b8095a54bbae6eb68624096cc7a504f7d894c2a80338b35a8f10b',
};
export const plan = () => pinnedPlan(approved);
function pinnedPlan(inventory) {
  return Object.entries(inventory).map(([file, checksum]) => {
    const text = fs.readFileSync(path.join(root, 'src/db/migrations', file), 'utf8');
    const statements = splitSql(text);
    if (digest(text) !== checksum || statements.shift() !== 'BEGIN' || statements.pop() !== 'COMMIT') throw new Error('Unreviewed R2 migration');
    return { file, checksum, statements };
  });
}
export const selectedPlan = () => plan().filter(m => !m.file.includes('password'));
export const cardAvatarPlan = () => pinnedPlan(cardAvatarSources);
const passwordFile='20261118_R2_admin_member_password.sql';
export const passwordPlan=()=>pinnedPlan({[passwordFile]:approved[passwordFile]});

// All values/SQL below are kept in protected artifacts or memory; never log query errors/rows.
const queries = {
  database: "SELECT r.rolname AS owner,d.datacl FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=current_database()",
  databaseAcl: "SELECT g.rolname AS grantor,coalesce(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a JOIN pg_roles g ON g.oid=a.grantor LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE d.datname=current_database() ORDER BY grantee,a.privilege_type",
  identity: "SELECT current_database() AS database,current_user AS principal,current_setting('transaction_read_only') AS read_only,current_setting('server_version_num') AS version",
  columns: "SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expr,a.attidentity,a.attgenerated,a.attnum,a.attacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','v') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum",
  relations: "SELECT c.oid,c.relname,c.relkind,r.rolname AS owner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,c.relpersistence FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' ORDER BY c.relname",
  functions: "SELECT p.oid,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition,r.rolname AS owner,p.proacl,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.proname,p.oid",
  constraints: "SELECT t.relname AS table_name,c.conname,c.contype,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY t.relname,c.conname",
  triggers: "SELECT t.tgname,c.relname AS table_name,pg_get_triggerdef(t.oid) AS definition,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
  roles: 'SELECT oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig FROM pg_roles ORDER BY rolname',
  memberships: 'SELECT r.rolname AS role,m.rolname AS member,g.rolname AS grantor,a.admin_option,a.inherit_option,a.set_option FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor ORDER BY r.rolname,m.rolname,g.rolname',
  policies: "SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname",
  schemas: "SELECT n.nspname,r.rolname AS owner,n.nspacl FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY n.nspname",
  defaults: 'SELECT r.rolname AS owner,n.nspname,d.defaclobjtype,d.defaclacl FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY r.rolname,n.nspname,d.defaclobjtype',
  enums: "SELECT t.typname,e.enumlabel,r.rolname AS owner FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_roles r ON r.oid=t.typowner JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder",
  extensions: 'SELECT extname,extversion FROM pg_extension ORDER BY extname',
  indexes: "SELECT * FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
  sequences: "SELECT s.schemaname,s.sequencename,s.sequenceowner,s.data_type::text,s.start_value::text,s.min_value::text,s.max_value::text,s.increment_by::text,s.cycle,s.cache_size::text,s.last_value::text,d.refobjid::regclass::text AS owned_table,a.attname AS owned_column,d.deptype FROM pg_sequences s JOIN pg_namespace n ON n.nspname=s.schemaname JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=s.sequencename LEFT JOIN pg_depend d ON d.objid=c.oid AND d.classid='pg_class'::regclass AND d.deptype IN ('a','i') LEFT JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid WHERE s.schemaname='public' ORDER BY s.sequencename",
  views: "SELECT c.relname,pg_get_viewdef(c.oid,true) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v' ORDER BY c.relname",
  relationAcl: "SELECT c.relname,c.relkind,g.rolname AS grantor,coalesce(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::\"char\" ELSE 'r'::\"char\" END,c.relowner))) a JOIN pg_roles g ON g.oid=a.grantor LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='public' AND c.relkind IN ('r','v','S') ORDER BY c.relname,grantee,a.privilege_type",
  functionAcl: "SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,g.rolname AS grantor,coalesce(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles g ON g.oid=a.grantor LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.proname,arguments,grantee,a.privilege_type",
  schemaAcl: "SELECT n.nspname,g.rolname AS grantor,coalesce(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a JOIN pg_roles g ON g.oid=a.grantor LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='public' ORDER BY n.nspname,grantee,a.privilege_type",
  defaultAcl: "SELECT o.rolname AS owner,n.nspname,d.defaclobjtype,g.rolname AS grantor,coalesce(r.rolname,'PUBLIC') AS grantee,a.privilege_type,a.is_grantable FROM pg_default_acl d JOIN pg_roles o ON o.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a JOIN pg_roles g ON g.oid=a.grantor LEFT JOIN pg_roles r ON r.oid=a.grantee ORDER BY owner,n.nspname,d.defaclobjtype,grantee,a.privilege_type",
  unsupported: "SELECT c.relname AS name,c.relkind::text AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind NOT IN ('r','v','S','i') UNION ALL SELECT t.typname,t.typtype::text FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype NOT IN ('e','c') AND t.typelem=0",
  uat: "SELECT count(*) FILTER (WHERE member_code='BLU-3' AND role='MEMBER')::integer AS member_matches,count(*) FILTER (WHERE member_code='BLU-4' AND role='ADMIN')::integer AS admin_matches FROM public.members WHERE member_code IN ('BLU-3','BLU-4')",
};
const dataQuery = name => `SELECT count(*)::text AS row_count,coalesce(json_agg(t ORDER BY to_jsonb(t)::text),'[]'::json)::text AS rows,md5(coalesce(json_agg(t ORDER BY to_jsonb(t)::text),'[]'::json)::text) AS fingerprint FROM public.${quote(name)} t`;
// Live guards send only row counts and digests back to production, never backup row payloads.
const passwordDataQuery = name => `SELECT row_count,rows,encode(sha256(convert_to(rows,'UTF8')),'hex') AS fingerprint FROM (SELECT count(*)::text AS row_count,coalesce(json_agg(t ORDER BY to_jsonb(t)::text COLLATE "C",row_to_json(t)::text COLLATE "C"),'[]'::json)::text AS rows FROM public.${quote(name)} t) b`;
async function capture(sql, fullVisibility=false, rowsQuery=dataQuery) {
  const discovered = await sql.query("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY relname");
  const names = discovered.map(r => r.relname);
  const sequences = await sql.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename");
  const keys = Object.keys(queries);
  const results = await sql.transaction([sql.query(fullVisibility?"SELECT set_config('TimeZone','UTC',true),set_config('row_security','off',true)":"SET LOCAL TIME ZONE 'UTC'"), ...keys.map(k => sql.query(`SELECT coalesce(json_agg(t),'[]'::json)::text AS records FROM (${queries[k]}) t`)), ...names.map(n => sql.query(rowsQuery(n))), ...sequences.map(s=>sql.query(`SELECT last_value::text,is_called FROM public.${quote(s.sequencename)}`))], { readOnly: true, isolationLevel: 'RepeatableRead' });
  const bundle = Object.fromEntries(keys.map((k,i) => [k,JSON.parse(results[i+1][0].records)]));
  bundle.tables = Object.fromEntries(names.map((n,i) => [n, results[keys.length+1+i][0]]));
    bundle.sequenceState = Object.fromEntries(sequences.map((s,i)=>[s.sequencename,results[keys.length+1+names.length+i][0]]));
  if (bundle.identity[0].read_only !== 'on') throw new Error('Read-only capture failed');
  if (!isDeepStrictEqual(names, bundle.relations.filter(r => r.relkind==='r').map(r=>r.relname))) throw new Error('Concurrent schema discovery drift');
  return bundle;
}

const functionName = f => `public.${quote(f.proname)}(${f.arguments})`;
const grantee = r => r === 'PUBLIC' ? 'PUBLIC' : quote(r);
function grants(rows, target) {
  return rows.map(a => `SET ROLE ${quote(a.grantor)}; GRANT ${a.privilege_type} ON ${target(a)} TO ${grantee(a.grantee)}${a.is_grantable ? ' WITH GRANT OPTION' : ''}; RESET ROLE;`);
}
export function recoverySql(b) {
  if (b.unsupported.length || b.policies.length || b.columns.some(c=>c.attacl || c.attgenerated) || b.extensions.some(e=>e.extname!=='plpgsql') || b.schemas.some(s=>s.nspname!=='public')) throw new Error('Unsupported recovery feature; fail closed');
  const out = ["SET statement_timeout='60s'; SET lock_timeout='5s'; SET TIME ZONE 'UTC'; SET search_path=public,pg_catalog; BEGIN;"];
  const bootstrap=b.roles.filter(r=>r.rolsuper);
    if(bootstrap.length!==1)throw new Error('Recovery requires an unambiguous native bootstrap role');
    for (const r of b.roles.filter(r=>!r.rolname.startsWith('pg_') && r.rolname!==bootstrap[0].rolname)) {
    if (r.rolconfig || r.rolvaliduntil) throw new Error('Role configuration requires explicit recovery support');
    out.push(`CREATE ROLE ${quote(r.rolname)} WITH ${r.rolsuper?'':'NO'}SUPERUSER ${r.rolinherit?'':'NO'}INHERIT ${r.rolcreaterole?'':'NO'}CREATEROLE ${r.rolcreatedb?'':'NO'}CREATEDB ${r.rolcanlogin?'':'NO'}LOGIN ${r.rolreplication?'':'NO'}REPLICATION ${r.rolbypassrls?'':'NO'}BYPASSRLS CONNECTION LIMIT ${r.rolconnlimit};`);
  }
  out.push(`ALTER DATABASE blu_modules_test_r2_recovery OWNER TO ${quote(b.database[0].owner)};`);
    for (const s of b.schemas) out.push(`ALTER SCHEMA ${quote(s.nspname)} OWNER TO ${quote(s.owner)}; REVOKE ALL ON SCHEMA ${quote(s.nspname)} FROM PUBLIC;`);
  for (const name of [...new Set(b.enums.map(e=>e.typname))]) {
    const values = b.enums.filter(e=>e.typname===name);
    out.push(`CREATE TYPE public.${quote(name)} AS ENUM (${values.map(e=>literal(e.enumlabel)).join(',')}); ALTER TYPE public.${quote(name)} OWNER TO ${quote(values[0].owner)};`);
  }
  // All sequences are created explicitly; identity ownership is attached by ADD IDENTITY below.
  for (const s of b.sequences.filter(s=>s.deptype!=='i')) out.push(sequenceDdl(s));
  for (const name of Object.keys(b.tables)) {
    const r = b.relations.find(r=>r.relname===name);
    if (r.reloptions || r.relpersistence!=='p' || r.relrowsecurity || r.relforcerowsecurity) throw new Error('Unsupported table storage/RLS');
    const cols = b.columns.filter(c=>c.table_name===name);
    out.push(`CREATE TABLE public.${quote(name)} (${cols.map(c=>`${quote(c.column_name)} ${c.type}${c.default_expr?' DEFAULT '+c.default_expr:''}${c.not_null?' NOT NULL':''}`).join(',')});`);
    for (const c of cols.filter(c=>c.attidentity)) {
      const seq = b.sequences.find(s=>s.deptype==='i' && s.owned_table.replace(/^public\./,'')===name && s.owned_column===c.column_name);
      if (!seq) throw new Error('Identity sequence not captured');
      out.push(`ALTER TABLE public.${quote(name)} ALTER COLUMN ${quote(c.column_name)} ADD GENERATED ${c.attidentity==='a'?'ALWAYS':'BY DEFAULT'} AS IDENTITY (SEQUENCE NAME public.${quote(seq.sequencename)} START WITH ${seq.start_value} INCREMENT BY ${seq.increment_by} MINVALUE ${seq.min_value} MAXVALUE ${seq.max_value} CACHE ${seq.cache_size} ${seq.cycle?'CYCLE':'NO CYCLE'});`);
    }
    out.push(`INSERT INTO public.${quote(name)} OVERRIDING SYSTEM VALUE SELECT * FROM json_populate_recordset(NULL::public.${quote(name)},${literal(b.tables[name].rows)}::json);`);
  }
  // Function bodies can depend on tables and other functions. Disable body checking during definition
  // restore only (not execution); every stored definition is compared below and migrations compile normally.
  out.push('SET LOCAL check_function_bodies=off;');
  for (const f of b.functions) out.push(f.definition+';');
  out.push('SET LOCAL check_function_bodies=on;');
  for (const c of b.constraints.filter(c=>!['f','n'].includes(c.contype))) out.push(`ALTER TABLE public.${quote(c.table_name)} ADD CONSTRAINT ${quote(c.conname)} ${c.definition};`);
  for (const c of b.constraints.filter(c=>c.contype==='f')) out.push(`ALTER TABLE public.${quote(c.table_name)} ADD CONSTRAINT ${quote(c.conname)} ${c.definition};`);
  for (const i of b.indexes.filter(i=>!b.constraints.some(c=>c.table_name===i.tablename&&c.conname===i.indexname))) out.push(i.indexdef+';');
  for (const v of b.views) out.push(`CREATE VIEW public.${quote(v.relname)} AS ${v.definition}`);
  for (const t of b.triggers) {
    out.push(t.definition+';');
    if (t.tgenabled!=='O') out.push(`ALTER TABLE public.${quote(t.table_name)} ${t.tgenabled==='D'?'DISABLE':t.tgenabled==='A'?'ENABLE ALWAYS':'ENABLE REPLICA'} TRIGGER ${quote(t.tgname)};`);
  }
  for (const s of b.sequences) {
    const state=b.sequenceState[s.sequencename];
        if (!state || !/^[0-9]+$/.test(state.last_value)) throw new Error('Sequence state unavailable');
    if (s.deptype==='a') out.push(`ALTER SEQUENCE public.${quote(s.sequencename)} OWNED BY ${s.owned_table}.${quote(s.owned_column)};`);
    out.push(`SELECT setval(${literal('public.'+s.sequencename)},${state.last_value},${state.is_called?'true':'false'});`);
  }
  for (const r of b.relations.filter(r=>['r','v','S'].includes(r.relkind))) {
    out.push(`ALTER ${r.relkind==='S'?'SEQUENCE':r.relkind==='v'?'VIEW':'TABLE'} public.${quote(r.relname)} OWNER TO ${quote(r.owner)}; REVOKE ALL ON ${r.relkind==='S'?'SEQUENCE':'TABLE'} public.${quote(r.relname)} FROM PUBLIC;`);
    if (r.relkind==='v' && r.reloptions) out.push(`ALTER VIEW public.${quote(r.relname)} SET (${r.reloptions.join(',')});`);
  }
  for (const f of b.functions) out.push(`ALTER FUNCTION ${functionName(f)} OWNER TO ${quote(f.owner)}; REVOKE ALL ON FUNCTION ${functionName(f)} FROM PUBLIC;`);
  out.push('REVOKE ALL ON DATABASE blu_modules_test_r2_recovery FROM PUBLIC;');
    out.push(...grants(b.databaseAcl,()=> 'DATABASE blu_modules_test_r2_recovery'));
    out.push(...grants(b.schemaAcl,a=>`SCHEMA ${quote(a.nspname)}`), ...grants(b.relationAcl,a=>`${a.relkind==='S'?'SEQUENCE':'TABLE'} public.${quote(a.relname)}`), ...grants(b.functionAcl,a=>`FUNCTION ${functionName(a)}`));
  for (const d of b.defaults) {
    if (!['r','S'].includes(d.defaclobjtype)) throw new Error('Unsupported default ACL kind');
    out.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(d.owner)}${d.nspname?' IN SCHEMA '+quote(d.nspname):''} REVOKE ALL ON ${d.defaclobjtype==='r'?'TABLES':'SEQUENCES'} FROM PUBLIC;`);
  }
  for (const a of b.defaultAcl) out.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(a.owner)}${a.nspname?' IN SCHEMA '+quote(a.nspname):''} GRANT ${a.privilege_type} ON ${a.defaclobjtype==='r'?'TABLES':'SEQUENCES'} TO ${grantee(a.grantee)}${a.is_grantable?' WITH GRANT OPTION':''};`);
  // Role memberships are last: object GRANTs were issued by their original grantors as superuser.
  for (const a of b.memberships) out.push(`GRANT ${quote(a.role)} TO ${quote(a.member)} WITH ADMIN ${a.admin_option?'TRUE':'FALSE'}, INHERIT ${a.inherit_option?'TRUE':'FALSE'}, SET ${a.set_option?'TRUE':'FALSE'} GRANTED BY ${quote(a.grantor)};`);
  out.push('COMMIT;');
  return out.join('\n');
}
function sequenceDdl(s) {
  return `CREATE SEQUENCE public.${quote(s.sequencename)} AS ${s.data_type} INCREMENT ${s.increment_by} MINVALUE ${s.min_value} MAXVALUE ${s.max_value} START ${s.start_value} CACHE ${s.cache_size} ${s.cycle?'CYCLE':'NO CYCLE'};`;
}

// Compare in PostgreSQL, not JavaScript Number/Date: preserve bigint/numeric and microseconds.
// Typed JSON record conversion normalizes ONLY according to each declared PostgreSQL type.
export function comparisonSql(name, rows, columns, parameterized=false) {
  if(columns && !columns.length)throw new Error('Empty comparison projection');
  const fields=columns ? columns.map(c=>`t.${quote(c)}`).join(',') : 't.*';
  return `WITH expected AS (SELECT to_jsonb(ROW(${fields}))::text COLLATE "C" AS row FROM json_populate_recordset(NULL::public.${quote(name)},${parameterized?'$1':literal(rows)}::json) t),actual AS (SELECT to_jsonb(ROW(${fields}))::text COLLATE "C" AS row FROM public.${quote(name)} t),missing AS (SELECT row FROM expected EXCEPT ALL SELECT row FROM actual),extra AS (SELECT row FROM actual EXCEPT ALL SELECT row FROM expected) SELECT json_build_object('expectedCount',(SELECT count(*) FROM expected),'actualCount',(SELECT count(*) FROM actual),'missingCount',(SELECT count(*) FROM missing),'extraCount',(SELECT count(*) FROM extra))::text;`;
}

const nativeBridge = String.raw`
import ctypes as c,os,sys
bin,port,user,db=sys.argv[1:]
assert port.isdigit() and db in ('postgres','blu_modules_test_r2_recovery')
os.add_dll_directory(bin)
pq=c.CDLL(os.path.join(bin,'libpq.dll'))
def bind(name,ret,args):
 f=getattr(pq,name);f.restype=ret;f.argtypes=args;return f
ptr=c.c_void_p
connect=bind('PQconnectdbParams',ptr,[c.POINTER(c.c_char_p),c.POINTER(c.c_char_p),c.c_int])
status=bind('PQstatus',c.c_int,[ptr]);send=bind('PQsendQuery',c.c_int,[ptr,c.c_char_p]);get=bind('PQgetResult',ptr,[ptr])
rs=bind('PQresultStatus',c.c_int,[ptr]);rows=bind('PQntuples',c.c_int,[ptr]);cols=bind('PQnfields',c.c_int,[ptr])
value=bind('PQgetvalue',c.c_char_p,[ptr,c.c_int,c.c_int]);field=bind('PQresultErrorField',c.c_char_p,[ptr,c.c_int])
clear=bind('PQclear',None,[ptr]);finish=bind('PQfinish',None,[ptr])
keys=(c.c_char_p*8)(b'host',b'port',b'user',b'dbname',b'connect_timeout',b'sslmode',b'passfile',None)
vals=(c.c_char_p*8)(b'127.0.0.1',port.encode(),user.encode(),db.encode(),b'5',b'disable',b'NUL',None)
conn=connect(keys,vals,0);code=0
try:
 if status(conn):raise RuntimeError('Native connection failed')
 if not send(conn,sys.stdin.buffer.read()):raise RuntimeError('Native send failed')
 while True:
  r=get(conn)
  if not r:break
  try:
   if rs(r)==2:
    for row in range(rows(r)):print('|'.join(value(r,row,col).decode('utf-8') for col in range(cols(r))))
   elif rs(r) not in (0,1):code=1;print('SQLSTATE='+(field(r,ord('C')) or b'UNKNOWN').decode(),file=sys.stderr)
  finally:clear(r)
finally:finish(conn)
sys.exit(code)
`;
export async function nativeDatabase(directory, bootstrap) {
  const tools = path.join(local,'portable-postgres-uat');
  const bin = path.join(tools,'package/native/bin');
  for (const f of ['initdb.exe','pg_ctl.exe']) if (!fs.existsSync(path.join(bin,f))) throw new Error('Native engine unavailable');
  const port = await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
  const env = Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE'].flatMap(k=>process.env[k]===undefined?[]:[[k,process.env[k]]]));
  env.PYTHONIOENCODING='utf-8';
  const data=path.join(directory,'native-data');
  const invoke=(file,args,input,timeout=60000)=>{
    try { return execFileSync(file,args,{env,input,encoding:'utf8',timeout,maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}); }
    catch(e){ const safe=new Error('Native operation failed');safe.code=String(e.stderr??'').match(/SQLSTATE=([0-9A-Z]{5})/)?.[1];throw safe; }
  };
  const passwordFile=path.join(directory,'bootstrap-password');
  env.PGPASSWORD=randomBytes(32).toString('hex');
  fs.writeFileSync(passwordFile,`${env.PGPASSWORD}\n`,{mode:0o600,flag:'wx'});
  try {
    invoke(path.join(bin,'initdb.exe'),['-D',data,'-U',bootstrap,'--auth-local=reject','--auth-host=scram-sha-256',`--pwfile=${passwordFile}`,'--encoding=UTF8','--locale=C']);
  } finally { fs.rmSync(passwordFile,{force:true}); }
  fs.appendFileSync(path.join(data,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${port}\nmax_connections=10\nlog_statement='none'\nlog_min_error_statement='panic'\n`);
  const log=fs.openSync(path.join(directory,'pg_ctl.log'),'a',0o600);
  let started=false;
  try {
    started=true;
    execFileSync(path.join(bin,'pg_ctl.exe'),['-D',data,'-l',path.join(directory,'native-server.log'),'-w','-t','20','start'],{env,timeout:30000,stdio:['ignore',log,log]});
    const run=(text,db='blu_modules_test_r2_recovery')=>invoke('python',['-c',nativeBridge,bin,String(port),bootstrap,db],text);
    run('CREATE DATABASE blu_modules_test_r2_recovery;','postgres');
    return { run, query: text=>JSON.parse(run(`SET TIME ZONE 'UTC'; SET search_path=public,pg_catalog; SET statement_timeout='60s'; ${text}`).trim()), close:()=>{
      try {invoke(path.join(bin,'pg_ctl.exe'),['-D',data,'-m','fast','-w','-t','20','stop'],undefined,30000);}finally{fs.closeSync(log);}
    }};
  } catch(e) {
    if(started)try{invoke(path.join(bin,'pg_ctl.exe'),['-D',data,'-m','immediate','-w','-t','20','stop'],undefined,30000);}catch{ /* start may have failed before binding */ }
    fs.closeSync(log);throw e;
  }
}
const normalized = (rows, omit=[]) => rows.map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>!omit.includes(k))));
function catalogComparable(b) {
  return Object.fromEntries(['databaseAcl','columns','relations','functions','constraints','triggers','roles','memberships','policies','schemas','defaults','enums','indexes','sequences','views','relationAcl','functionAcl','schemaAcl','defaultAcl'].map(k=>[k,normalized(b[k],['oid','relacl','proacl','nspacl','defaclacl','attacl'])]));
}
export function nativeCatalog(db) {
  return Object.fromEntries(Object.entries(queries).filter(([k])=>!['identity','uat'].includes(k)).map(([k,q])=>[k,db.query(`SELECT coalesce(json_agg(t),'[]'::json)::text FROM (${q}) t;`)]));
}
export async function diagnoseOriginalBackup(directory) {
  const dir=path.resolve(directory);
  if (!dir.startsWith(local+path.sep)) throw new Error('Protected backup required');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  for(const [file,hash] of Object.entries(manifest.files)) {
    if(!['snapshot.json','restore-empty.sql'].includes(file)||digest(fs.readFileSync(path.join(dir,file)))!==hash)throw new Error('Backup checksum failed');
  }
  const b=JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json'),'utf8'));
  const require=createRequire(import.meta.url);
  const {PGlite}=require(path.join(local,'payment-sql-tests/node_modules/@electric-sql/pglite'));
  const db=new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(dir,'restore-empty.sql'),'utf8'));
    const differences=[];
    for(const [name,table] of Object.entries(b.tables)) {
      const actual=JSON.parse((await db.query(`SELECT coalesce(json_agg(t ORDER BY to_jsonb(t)::text),'[]'::json)::text AS rows FROM public.${quote(name)} t`)).rows[0].rows);
      const expected=JSON.parse(table.rows);
      const result=(await db.query(comparisonSql(name,table.rows))).rows[0].json_build_object;
      const typed=typeof result==='string'?JSON.parse(result):result;
      const differingColumns=b.columns.filter(c=>c.table_name===name).map(c=>{
              const pairs=expected.map((r,i)=>[r[c.column_name],actual[i]?.[c.column_name]]).filter(([a,z])=>!isDeepStrictEqual(a,z));
              const offsets=v=>typeof v==='string'?v.match(/(Z|[+-][0-9]{2}:[0-9]{2})$/)?.[1]:undefined;
              return {column:c.column_name,type:c.type,positions:pairs.length,...(c.type==='timestamp with time zone'&&pairs.length?{sourceOffsets:[...new Set(pairs.map(([a])=>offsets(a)))],restoredOffsets:[...new Set(pairs.map(([,z])=>offsets(z)))]}:{})};
            }).filter(c=>c.positions);
      if(differingColumns.length) differences.push({table:name,differingColumns,semantic:typed});
      if(typed.missingCount||typed.extraCount)throw new Error('Actual restored data loss');
    }
    return {tablesChecked:Object.keys(b.tables).length,differences,normalization:'PostgreSQL declared-type conversion + canonical whole-row JSONB text COLLATE C EXCEPT ALL both directions; no JS Date/Number normalization or tolerance'};
  }finally{await db.close();}
}

const scopeName = name => /^(admin_member_profile_|member_contact_)/.test(name);
export function scopeCatalog(b) {
  const out=catalogComparable(b);
  return {
    columns:out.columns.filter(r=>scopeName(r.table_name)),relations:out.relations.filter(r=>scopeName(r.relname)),
    functions:out.functions.filter(r=>scopeName(r.proname)),constraints:out.constraints.filter(r=>scopeName(r.table_name)),
    triggers:out.triggers.filter(r=>scopeName(r.table_name)),indexes:out.indexes.filter(r=>scopeName(r.tablename)),
    relationAcl:out.relationAcl.filter(r=>scopeName(r.relname)),functionAcl:out.functionAcl.filter(r=>scopeName(r.proname)),
  };
}
const metadataDdl = `CREATE TABLE public.r2_schema_rollouts (name text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),objects jsonb NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp()); REVOKE ALL ON public.r2_schema_rollouts FROM PUBLIC;`;
function permissionQuery() {
  return `SELECT r.rolname,has_table_privilege(r.oid,'public.members','UPDATE') AND has_table_privilege(r.oid,'public.auth_sessions','SELECT') AS baseline_trusted, bool_or(has_function_privilege(r.oid,p.oid,'EXECUTE')) AS new_execute FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'admin_member_profile_%' OR p.proname LIKE 'member_contact_%') GROUP BY r.oid,r.rolname ORDER BY r.rolname`;
}
function tablePermissionQuery() {
  return `SELECT r.rolname,v.privilege,has_table_privilege(r.oid,'public.members',v.privilege) AND has_table_privilege(r.oid,'public.auth_sessions',v.privilege) AS baseline_trusted,bool_or(has_table_privilege(r.oid,c.oid,v.privilege)) AS new_access FROM pg_roles r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) v(privilege) CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (c.relname LIKE 'admin_member_profile_%' OR c.relname LIKE 'member_contact_%' OR c.relname='r2_schema_rollouts') GROUP BY r.oid,r.rolname,v.privilege ORDER BY r.rolname,v.privilege`;
}
export function reconcileExisting(b,migrations=selectedPlan()) {
  if(!b.relations.some(r=>r.relname==='r2_schema_rollouts'))throw new Error('Existing R2 objects have no trusted migration inventory');
  const records=JSON.parse(b.tables.r2_schema_rollouts?.rows??'[]');
  if(records.length!==migrations.length)throw new Error('Unknown migration inventory');
  const scope=scopeCatalog(b);
  for(const m of migrations) {
    const record=records.find(r=>r.name===m.file);
    if(!record||record.checksum!==m.checksum||!isDeepStrictEqual(record.objects,scope))throw new Error('Existing R2 source/schema checksum mismatch');
  }
  return true;
}
function guard(sql, condition, params=[]) { return sql.query(`SELECT 1 / CASE WHEN (${condition}) THEN 1 ELSE 0 END AS guard`,params); }
export async function auditBackupGuards(directory) {
  const dir=path.resolve(directory);
  if(!dir.startsWith(local+path.sep))throw new Error('Protected backup required');
  const b=JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json'),'utf8'));
  const sql=client(),names=Object.keys(b.tables),keys=Object.keys(queries).filter(k=>!['identity','uat','unsupported','database','databaseAcl','roles','extensions','sequences'].includes(k));
  const checks=await sql.transaction([sql.query("SET LOCAL TIME ZONE 'UTC'"),sql.query('SET LOCAL search_path=public,pg_catalog'),...names.map(n=>sql.query(`SELECT (SELECT fingerprint FROM (${dataQuery(n)}) x)=$1 AS matches`,[b.tables[n].fingerprint])),...keys.map(k=>sql.query(`SELECT (SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM (${queries[k]}) t)=$1::jsonb AS matches`,[JSON.stringify(b[k])])),sql.query("SELECT count(*)::integer AS objects FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relname ~ '^(admin_member_profile_|member_contact_)' OR c.relname='r2_schema_rollouts')")],{readOnly:true,isolationLevel:'RepeatableRead'});
  return {dataMismatches:names.filter((n,i)=>!checks[i+2][0].matches),catalogMismatches:keys.filter((k,i)=>!checks[names.length+i+2][0].matches),currentR2Relations:checks.at(-1)[0].objects};
}
export async function auditApplied(directory) {
  const dir=path.resolve(directory);
  if(!dir.startsWith(local+path.sep))throw new Error('Protected backup required');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  for(const [file,hash]of Object.entries(manifest.files)) {
    if(!['snapshot.json','restore-complete.sql'].includes(file)||digest(fs.readFileSync(path.join(dir,file)))!==hash)throw new Error('Recovery artifact integrity failed');
  }
  const before=JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json'),'utf8'));
  const expectedScope=JSON.parse(fs.readFileSync(path.join(dir,'rehearsal-scope.json'),'utf8'));
  const sql=client(),after=await capture(sql);
  reconcileExisting(after);
  if(!isDeepStrictEqual(scopeCatalog(after),expectedScope))throw new Error('Independent scope audit failed');
  const dataDrift=Object.keys(before.tables).filter(n=>before.tables[n].fingerprint!==after.tables[n]?.fingerprint);
  if(dataDrift.length)throw new Error('Independent existing-data audit detected drift');
  const previous=catalogComparable(before),current=catalogComparable(after);
  const addedName=n=>scopeName(n)||n==='r2_schema_rollouts'||n==='r2_schema_rollouts_pkey';
  const fields={columns:'table_name',relations:'relname',functions:'proname',constraints:'table_name',triggers:'table_name',indexes:'tablename',sequences:'sequencename',relationAcl:'relname',functionAcl:'proname'};
  for(const [section,field]of Object.entries(fields))current[section]=current[section].filter(r=>!addedName(r[field]));
  const changed=Object.keys(previous).filter(k=>!isDeepStrictEqual(previous[k],current[k]));
  if(changed.length)throw new Error('Independent existing-catalog audit detected drift');
  const permissions=await sql.transaction([sql.query(permissionQuery()),sql.query(tablePermissionQuery())],{readOnly:true,isolationLevel:'RepeatableRead'});
  if(permissions[0].some(p=>p.new_execute&&!p.baseline_trusted)||permissions[1].some(p=>p.new_access&&!p.baseline_trusted))throw new Error('Independent privilege audit failed');
  if(after.functions.some(f=>f.proname.startsWith('admin_member_password_'))||after.relations.some(r=>r.relname.startsWith('admin_member_password_')))throw new Error('Password exclusion audit failed');
  const counts=Object.fromEntries(Object.entries(after.tables).filter(([n])=>scopeName(n)).map(([n,t])=>[n,Number(t.row_count)]));
  if(Object.values(counts).some(n=>n!==0))throw new Error('Unexpected functional writes after schema rollout');
  const result={auditedAt:new Date().toISOString(),databaseFingerprint:digest(after.identity[0].database),approvedInventoryRows:JSON.parse(after.tables.r2_schema_rollouts.rows).length,existingTablesUnchanged:Object.keys(before.tables).length,existingCatalogSectionsUnchanged:Object.keys(previous).length,scopeChecksum:digest(JSON.stringify(expectedScope)),newTableCounts:counts,unexpectedPrivilegeExpansion:0,passwordObjects:0,uatCounts:after.uat[0]};
  save(path.join(dir,'independent-audit-'+stamp()+'.json'),JSON.stringify(result,null,2));
  return result;
}
function nativeRows(db,name) {
  return db.query(`SELECT row_to_json(x)::text FROM (${dataQuery(name)}) x;`);
}

function verifyRows(db,tables,projection=()=>undefined) {
  for(const [name,t] of Object.entries(tables)) {
    const result=db.query(comparisonSql(name,t.rows,projection(name)));
    if(result.missingCount!==0||result.extraCount!==0||String(result.expectedCount)!==t.row_count||String(result.actualCount)!==t.row_count)throw new Error('Typed row comparison failed');
  }
}

function sequenceStates(db,sequences) {
  return Object.fromEntries(sequences.map(s=>[s.sequencename,db.query(`SELECT row_to_json(t)::text FROM (SELECT last_value::text,is_called FROM public.${quote(s.sequencename)}) t;`)]));
}

export function rehearseCardAvatar(db,principal,sourceTables) {
  const migrations=cardAvatarPlan();
  const before=nativeCatalog(db);
  reconcileExisting({...before,tables:{r2_schema_rollouts:before.relations.some(r=>r.relname==='r2_schema_rollouts')?nativeRows(db,'r2_schema_rollouts'):undefined}});
  const reserved=n=>/^(member_card|member_scan_|staff_avatar_|admin_member_password_)/.test(n);
  if(before.relations.some(r=>reserved(r.relname))||before.functions.some(r=>reserved(r.proname))||
     before.columns.some(r=>r.table_name==='members'&&r.column_name==='avatar_version'))throw new Error('Card/avatar baseline has conflicting objects');
  const names=before.relations.filter(r=>r.relkind==='r').map(r=>r.relname);
  const tables=sourceTables??Object.fromEntries(names.map(name=>[name,nativeRows(db,name)]));
  if(!isDeepStrictEqual([...names].sort(),Object.keys(tables).sort()))throw new Error('Incomplete old-table inventory');
  const states=sequenceStates(db,before.sequences);
  const batch=`BEGIN; SET LOCAL ROLE ${quote(principal)}; SET LOCAL search_path=public,pg_catalog; SET LOCAL statement_timeout='60s'; ${migrations.flatMap(m=>m.statements).join(';\n')};`;
  db.run(`${batch} ROLLBACK;`);
  const rolledBack=nativeCatalog(db);
  if(!isDeepStrictEqual(before,rolledBack)||!isDeepStrictEqual(states,sequenceStates(db,before.sequences)))throw new Error('Rollback catalog or sequence state changed');
  verifyRows(db,tables);
  db.run(`${batch} COMMIT;`);
  const after=nativeCatalog(db);
  after.tables={r2_schema_rollouts:nativeRows(db,'r2_schema_rollouts')};
  reconcileExisting(after);
  const avatar=c=>c.table_name==='members'&&c.column_name==='avatar_version';
  const added=after.columns.find(avatar);
  if(!added||added.type!=='integer'||!added.not_null||added.default_expr!=='0'||
     db.query('SELECT to_json(count(*)::text) FROM public.members WHERE avatar_version IS DISTINCT FROM 0;')!=='0')throw new Error('Unexpected avatar_version definition or values');
  const oldRelations=new Set(before.relations.map(r=>r.relname));
  if(!isDeepStrictEqual(before.columns,after.columns.filter(c=>oldRelations.has(c.table_name)&&!avatar(c))))throw new Error('Old column definitions changed');
  verifyRows(db,tables,name=>name==='members'?before.columns.filter(c=>c.table_name===name).map(c=>c.column_name):undefined);
  if(!isDeepStrictEqual(states,sequenceStates(db,before.sequences)))throw new Error('Existing sequence state changed');
  if(after.functionAcl.some(a=>reserved(a.proname)&&a.grantee==='PUBLIC')||after.relationAcl.some(a=>reserved(a.relname)&&a.grantee==='PUBLIC'))throw new Error('PUBLIC exposure');
  const addedTables=after.relations.filter(r=>r.relkind==='r'&&!oldRelations.has(r.relname));
  if(addedTables.some(r=>nativeRows(db,r.relname).row_count!=='0'))throw new Error('Unexpected rows in new tables');
  return {migrations:migrations.map(m=>m.file),inventoryVerified:true,oldTablesCompared:names.length,rollbackVerified:true,avatarVersionDefault:0,avatarDefaultVerifiedOnExistingMembers:BigInt(tables.members.row_count)>0n,newEmptyTables:addedTables.length};
}

// Drop application rows before restore in catalog-only mode.
export function catalogOnlyBaseline(b) {
  reconcileExisting(b);
  return {...b, tables:Object.fromEntries(Object.entries(b.tables).map(([name,t])=>[
    name,name==='r2_schema_rollouts'?t:{rows:'[]',row_count:'0'},
  ]))};
}

const authorizedCapture='r2-capture-ORPEIJ';
const authorizedSnapshotHash='85417368e7f4510c8eb00b05967fec6678949750e5ede00f43969d18e38a459c';

async function offlineCardAvatar(directory, mode) {
  const catalogOnly=mode==='--rehearse-card-avatar-catalog';
  const full=mode==='--rehearse-card-avatar-protected';
  let db,dir,stage='baseline';
  try {
    if(!directory)throw new Error('Baseline unavailable');
    const source=fs.realpathSync(directory);
    const base=fs.realpathSync(local);
    if(!source.startsWith(base+path.sep))throw new Error('Protected baseline required');
    if(full&&(base!==local||source!==path.join(base,authorizedCapture)))throw new Error('Authorized capture required');
    protect();
    const file=path.join(source,catalogOnly||full?'snapshot.json':'sanitized-snapshot.json');
    if(!fs.lstatSync(file).isFile())throw new Error('Baseline unavailable');
    const text=fs.readFileSync(file,'utf8');
    if(catalogOnly||full){
      if(full&&digest(text)!==authorizedSnapshotHash)throw new Error('Unexpected snapshot digest');
      const manifest=path.join(source,'manifest.json');
      if(!fs.lstatSync(manifest).isFile()||JSON.parse(fs.readFileSync(manifest,'utf8')).files?.['snapshot.json']!==digest(text))throw new Error('Backup checksum mismatch');
    }
    const b=catalogOnly?catalogOnlyBaseline(JSON.parse(text)):JSON.parse(text);
    reconcileExisting(b);
    if(full&&(Object.keys(b.tables).length!==36||!(BigInt(b.tables.members.row_count)>0n)))throw new Error('Incomplete populated capture');
    const bootstrap=b.roles.find(r=>r.rolsuper).rolname;
    const restore=recoverySql(b);
    stage='native-recovery';
    protect();dir=fs.mkdtempSync(path.join(local,'r2-card-avatar-'));
    db=await nativeDatabase(dir,bootstrap);db.run(restore);
    const expected=catalogComparable(b),actual=catalogComparable(nativeCatalog(db));
    if(!isDeepStrictEqual(expected,actual))throw new Error('Native catalog comparison failed');
    verifyRows(db,b.tables);
    if(!isDeepStrictEqual(b.sequenceState,sequenceStates(db,b.sequences)))throw new Error('Native sequence recovery mismatch');
    stage='card-avatar-rehearsal';
    const rehearsal=rehearseCardAvatar(db,b.identity[0].principal,b.tables);
    stage='effective-acl';
    if(!db.query(`SET ROLE ${quote(b.identity[0].principal)}; SELECT to_json(${cardAvatarAclCheck});`))throw new Error('Effective access exceeds card/avatar policy');
    return {outcome:'VERIFIED offline rehearsal',baseline:full?'authorized protected capture':catalogOnly?'production catalog + inventory only; no application rows':'caller-sanitized',catalogSections:Object.keys(expected).length,effectiveAcl:'verified',...rehearsal};
  }catch(e){
    process.exitCode=1;
    return {outcome:'BLOCKED',stage,reason:stage==='baseline'?'Post-profile/contact baseline missing, unauthorized, or invalid':'Native verification failed',code:/^[0-9A-Z]{5}$/.test(e?.code??'')?e.code:undefined};
  }finally{
    if(db)db.close();
    if(dir)fs.rmSync(dir,{recursive:true,force:true,maxRetries:3});
  }
}

const catalogOmit=['oid','relacl','proacl','nspacl','defaclacl','datacl'];
const cardObjectPattern='^(member_card|member_scan_|staff_avatar_)';
const avatarCheck="NOT EXISTS (SELECT 1 FROM public.members WHERE avatar_version IS DISTINCT FROM 0)";

// Fixed baseline analogs, themselves covered by the catalog and inventory guards.
// Compare effective bits separately from object ACLs: a redundant explicit GRANT is still new.
const cardAclBaselines={
  r:['members','auth_sessions','admin_member_profile_audit','member_contact_details','member_contact_email_audit'],
  S:['admin_member_profile_audit_id_seq','member_contact_email_audit_id_seq'],
  f:['admin_member_profile_update','member_contact_email_update'],
};
const aclOperations={r:['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'],S:['USAGE','SELECT','UPDATE'],f:['EXECUTE']};

function newObjectAclCheck(pattern,baselines,extra,ownerOnly=false) {
  return `(WITH objects AS (
  SELECT c.oid,c.relkind::text AS kind,c.relname::text AS name,c.relowner AS owner,
    coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner)) AS acl
    FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','S')
  UNION ALL
  SELECT p.oid,'f',p.proname,p.proowner,coalesce(p.proacl,acldefault('f',p.proowner))
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
), baseline(kind,name) AS (VALUES ${Object.entries(baselines).flatMap(([kind,names])=>names.map(name=>`(${literal(kind)},${literal(name)})`)).join(',')}),
  targets AS (SELECT * FROM objects WHERE name ~ '${pattern}'),
  -- Check every role context, not just logins: has_* resolves inherited rights, and
  -- evaluating all roles covers every SET ROLE destination (and dormant grantees).
  contexts AS (SELECT r.oid FROM pg_roles r),
  operations(kind,privilege) AS (VALUES ${Object.entries(aclOperations).flatMap(([kind,ops])=>ops.map(op=>`(${literal(kind)},${literal(op)})`)).join(',')},('c','SELECT'),('c','INSERT'),('c','UPDATE'),('c','REFERENCES')),
  rights AS (
    SELECT o.kind,o.name,o.oid,r.oid AS role,v.privilege || g.suffix AS bit,
      CASE o.kind WHEN 'r' THEN has_table_privilege(r.oid,o.oid,v.privilege || g.suffix)
        WHEN 'S' THEN has_sequence_privilege(r.oid,o.oid,v.privilege || g.suffix)
        WHEN 'f' THEN has_function_privilege(r.oid,o.oid,v.privilege || g.suffix) END AS allowed
    FROM objects o JOIN operations v USING(kind) CROSS JOIN contexts r
    CROSS JOIN (VALUES (''),(' WITH GRANT OPTION')) g(suffix)
    WHERE o.name ~ '${pattern}' OR EXISTS (SELECT FROM baseline b WHERE (b.kind,b.name)=(o.kind,o.name))
  )
  SELECT NOT EXISTS (SELECT FROM baseline b WHERE (SELECT count(*) FROM objects o WHERE (o.kind,o.name)=(b.kind,b.name))<>1)
    AND NOT EXISTS (SELECT FROM rights t JOIN baseline b ON b.kind=t.kind
      WHERE t.name ~ '${pattern}' AND t.allowed AND NOT EXISTS (
        SELECT FROM rights a WHERE (a.kind,a.name,a.role,a.bit)=(b.kind,b.name,t.role,t.bit) AND a.allowed))
    AND NOT EXISTS (SELECT FROM targets t JOIN baseline b USING(kind) JOIN objects o ON (o.kind,o.name)=(b.kind,b.name)
      WHERE t.owner<>o.owner OR EXISTS (SELECT FROM aclexplode(t.acl) a WHERE ${ownerOnly ? 'a.grantee<>t.owner OR a.grantor<>t.owner' : 'a.grantee=0 OR NOT EXISTS (SELECT FROM aclexplode(o.acl) x WHERE x=a)'}))
    AND NOT EXISTS (SELECT FROM pg_attribute a JOIN targets t ON t.kind='r' AND t.oid=a.attrelid
      WHERE a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
    ${extra}
)`;
}

export const cardAvatarAclCheck=newObjectAclCheck(cardObjectPattern,cardAclBaselines,`
    AND EXISTS (SELECT FROM pg_attribute a WHERE a.attrelid='public.members'::regclass
      AND a.attname='avatar_version' AND NOT a.attisdropped AND a.attacl IS NULL)
    AND NOT EXISTS (SELECT FROM contexts r CROSS JOIN operations v CROSS JOIN (VALUES (''),(' WITH GRANT OPTION')) g(suffix)
      WHERE v.kind='c' AND has_column_privilege(r.oid,'public.members','avatar_version',v.privilege || g.suffix)
        AND NOT has_column_privilege(r.oid,'public.members','avatar_url',v.privilege || g.suffix))`);

const passwordPattern='^admin_member_password_';
const passwordTables=['admin_member_password_audit','admin_member_password_requests'];
const passwordSequence='admin_member_password_audit_id_seq';
export const passwordAclCheck=newObjectAclCheck(passwordPattern,{
  r:['admin_member_profile_audit','auth_password_tickets'],
  S:['admin_member_profile_audit_id_seq'],
  f:['admin_member_profile_update'],
},'AND NOT EXISTS (SELECT FROM targets WHERE owner<>current_user::regrole)',true);

const passwordInvokerCheck=`(
  has_table_privilege('public.members','SELECT') AND has_table_privilege('public.members','UPDATE')
  AND has_table_privilege('public.auth_sessions','SELECT') AND has_table_privilege('public.auth_sessions','UPDATE')
  AND has_table_privilege('public.auth_otp_challenges','SELECT') AND has_table_privilege('public.auth_otp_challenges','UPDATE')
  AND has_table_privilege('public.auth_password_tickets','SELECT') AND has_table_privilege('public.auth_password_tickets','UPDATE')
  AND has_table_privilege('public.admin_member_password_requests','SELECT') AND has_table_privilege('public.admin_member_password_requests','INSERT') AND has_table_privilege('public.admin_member_password_requests','UPDATE')
  AND has_table_privilege('public.admin_member_password_audit','INSERT') AND has_sequence_privilege('public.admin_member_password_audit_id_seq','USAGE')
  AND has_function_privilege('public.admin_member_password_action(text,uuid,jsonb,text)','EXECUTE')
)`;

function driftCatalog(b) {
  const c=catalogComparable(b);
  c.sequences=normalized(c.sequences,['last_value']);
    c.columns=b.columns;
  // Database ACL is compared as expanded grantor/grantee/privilege rows above.
    return {...c,database:normalized(b.database,['datacl']),extensions:b.extensions,unsupported:b.unsupported};
}

async function applyCardAvatar() {
  const report={mode:'apply-card-avatar',applied:[],password:'NOT APPLIED',r3Plus:'NOT APPLIED'};
  let db,dir,stage='protected-baseline',commit='not-attempted';
  try {
    const protectedDir=path.join(local,authorizedCapture);
    report.protectedRehearsal=await offlineCardAvatar(protectedDir,'--rehearse-card-avatar-protected');
    if(!report.protectedRehearsal.outcome.startsWith('VERIFIED'))throw new Error('Pinned protected rehearsal could not be verified');
    const source=fs.readFileSync(path.join(protectedDir,'snapshot.json'),'utf8');
    if(digest(source)!==authorizedSnapshotHash)throw new Error('Pinned protected capture changed');
    const baseline=JSON.parse(source),migrations=cardAvatarPlan();
    stage='production-read-only-capture';
    const sql=client(),b=await capture(sql,true);
    stage='baseline-drift';
    reconcileExisting(b);
    const expected=driftCatalog(baseline),actual=driftCatalog(b);
    report.driftSections=Object.keys(expected).filter(k=>!isDeepStrictEqual(expected[k],actual[k]));
    if(report.driftSections.length||!isDeepStrictEqual(baseline.identity,b.identity))throw new Error('Live identity or catalog differs from protected rehearsal');
    stage='fresh-recovery';
    protect();dir=fs.mkdtempSync(path.join(local,'r2-card-avatar-apply-'));
    report.artifacts=path.relative(root,dir);
    const text=JSON.stringify(b),file=path.join(dir,'snapshot.json');
    save(file,text);
    report.snapshotChecksum=digest(text);
    save(path.join(dir,'manifest.json'),JSON.stringify({files:{'snapshot.json':report.snapshotChecksum}}));
    const saved=fs.readFileSync(file,'utf8');
    if(digest(saved)!==report.snapshotChecksum)throw new Error('Fresh snapshot checksum mismatch');
    db=await nativeDatabase(dir,b.roles.find(r=>r.rolsuper).rolname);
    db.run(recoverySql(JSON.parse(saved)));
    if(!isDeepStrictEqual(driftCatalog(nativeCatalog(db)),actual))throw new Error('Fresh native recovery catalog mismatch');
    verifyRows(db,b.tables);
    if(!isDeepStrictEqual(b.sequenceState,sequenceStates(db,b.sequences)))throw new Error('Fresh native sequence recovery mismatch');
    report.recovery={tables:Object.keys(b.tables).length,catalogSections:Object.keys(catalogComparable(b)).length};
    stage='fresh-rehearsal';
    const principal=b.identity[0].principal;
    report.rehearsal=rehearseCardAvatar(db,principal,b.tables);
    const staged=nativeCatalog(db),after=driftCatalog(staged);
    stage='effective-acl';
    if(!db.query(`SET ROLE ${quote(principal)}; SELECT to_json(${cardAvatarAclCheck});`))throw new Error('Fresh rehearsal: effective access exceeds card/avatar policy');
    stage='prepare-production-guards';
    const added=staged.relations.filter(r=>r.relkind==='r'&&!Object.hasOwn(b.tables,r.relname)).map(r=>r.relname);
    if(added.length!==5)throw new Error('Unexpected new table inventory');
    const catalogGuards=(dbSql,c)=>Object.entries(c).map(([k,rows])=>guard(dbSql,
      `(SELECT coalesce(jsonb_agg(to_jsonb(t)-$2::text[]),'[]'::jsonb) FROM (${queries[k]}) t)=$1::jsonb`,
      [JSON.stringify(rows),k==='sequences'?[...catalogOmit,'last_value']:catalogOmit]));
    const dataGuards=(dbSql,post)=>Object.entries(b.tables).map(([name,t])=>{
      const cols=post&&name==='members'?b.columns.filter(c=>c.table_name===name).map(c=>c.column_name):undefined;
      const comparison=comparisonSql(name,t.rows,cols,true).slice(0,-1);
      return guard(dbSql,`(SELECT (j::jsonb->>'missingCount')='0' AND (j::jsonb->>'extraCount')='0' AND (j::jsonb->>'actualCount')=$2 FROM (${comparison}) x(j))`,[t.rows,t.row_count]);
    });
    const stateGuards=dbSql=>Object.entries(b.sequenceState).map(([name,s])=>guard(dbSql,
      `(SELECT last_value::text=$1 AND is_called=$2 FROM public.${quote(name)})`,[s.last_value,s.is_called]));
    const postGuards=dbSql=>[...catalogGuards(dbSql,after),...dataGuards(dbSql,true),...stateGuards(dbSql),guard(dbSql,avatarCheck),guard(dbSql,cardAvatarAclCheck),
      ...added.map(name=>guard(dbSql,`NOT EXISTS (SELECT FROM public.${quote(name)})`))];
    const settings=dbSql=>[dbSql.query("SET LOCAL statement_timeout='60s'"),dbSql.query("SET LOCAL TIME ZONE 'UTC'"),dbSql.query('SET LOCAL search_path=public,pg_catalog'),dbSql.query('SET LOCAL row_security=off')];
    const identityGuard=dbSql=>guard(dbSql,'current_database()=$1 AND current_user=$2 AND current_setting(\'server_version_num\')=$3',[b.identity[0].database,principal,b.identity[0].version]);
    if(!isDeepStrictEqual(migrations,cardAvatarPlan()))throw new Error('Pinned migration source changed');
    const tx=[...settings(sql),sql.query("SET LOCAL lock_timeout='5s'"),sql.query('SELECT pg_advisory_xact_lock(18261118,20)'),
      sql.query('LOCK TABLE '+Object.keys(b.tables).map(n=>'public.'+quote(n)).join(',')+' IN SHARE MODE'),
      identityGuard(sql),
      guard(sql,"NOT EXISTS (SELECT FROM pg_event_trigger WHERE evtenabled<>'D')"),
      ...catalogGuards(sql,actual),...dataGuards(sql,false),...stateGuards(sql),...migrations.flatMap(m=>m.statements.map(s=>sql.query(s))),...postGuards(sql)];
    stage='production-transaction';
    commit='unknown';
    await sql.transaction(tx,{isolationLevel:'ReadCommitted'});
    commit='committed';report.applied=migrations.map(m=>m.file);
    stage='production-postflight';
    const audit=client();
    await audit.transaction([...settings(audit),identityGuard(audit),guard(audit,"current_setting('transaction_read_only')='on'"),...postGuards(audit)],{readOnly:true,isolationLevel:'RepeatableRead'});
    report.postflight={readOnly:true,existingTables:Object.keys(b.tables).length,newEmptyTables:added.length,effectiveAcl:'verified'};
    report.outcome='VERIFIED card/avatar schema-only commit; existing inventory unchanged';
  }catch(e){
    report.outcome=commit==='committed'?'Committed; postflight failed; do not replay':commit==='unknown'?'Transaction attempted; reconcile read-only before retry':'BLOCKED; no migration transaction attempted';
    const safeStages=['protected-baseline','baseline-drift','fresh-recovery','effective-acl','prepare-production-guards'];
    report.blocker={stage,reason:safeStages.includes(stage)&&!e.code&&/^(Pinned |Existing R2 |Unknown migration inventory|Live identity |Fresh |Unexpected new table inventory|Native operation failed|Typed row comparison failed)/.test(e.message)?e.message:undefined,code:/^[0-9A-Z]{5}$/.test(e?.code??'')?e.code:undefined};
    process.exitCode=1;
  }finally{
    if(db)try{db.close();}catch{report.nativeCleanup='failed';process.exitCode=1;}
    report.commitOutcome=commit;
    if(dir)save(path.join(dir,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }
  return report;
}

function protectedPasswordDirectory(prefix='r2-password-schema-') {
  // Do not invoke Git in this mode. Verify the repository exclusion and isolate the new directory.
  if(process.platform!=='win32'||!fs.readFileSync(path.join(root,'.gitignore'),'utf8').split(/\r?\n/).includes('/.local-db/')||!fs.lstatSync(local).isDirectory()||fs.realpathSync(local)!==local)throw new Error('Protected Windows backup directory required');
  const dir=fs.mkdtempSync(path.join(local,prefix));
  try {
    const script=String.raw`
$ErrorActionPreference='Stop'
$p=$env:R2_PROTECTED_DIRECTORY
$ids=@([Security.Principal.WindowsIdentity]::GetCurrent().User,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))
$acl=Get-Acl -LiteralPath $p
$acl.SetAccessRuleProtection($true,$false)
foreach($r in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) { $acl.RemoveAccessRuleSpecific($r) }
foreach($id in $ids) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow')) }
Set-Acl -LiteralPath $p -AclObject $acl
$a=Get-Acl -LiteralPath $p
$r=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
if(!$a.AreAccessRulesProtected -or $r.Count -ne 2 -or @($r | Where-Object { $_.IsInherited -or $_.IdentityReference.Value -notin $ids.Value -or $_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne 'FullControl' -or $_.InheritanceFlags -ne 'ContainerInherit,ObjectInherit' -or $_.PropagationFlags -ne 'None' }).Count -ne 0) { throw 'Unexpected backup ACL' }
`;
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...process.env,R2_PROTECTED_DIRECTORY:dir},stdio:'pipe',timeout:15000});
    if(fs.realpathSync(dir)!==dir)throw new Error();
    return dir;
  } catch {
    fs.rmdirSync(dir);
    throw new Error('Backup directory ACL could not be restricted and verified');
  }
}

const passwordCatalogFields={columns:'table_name',relations:'relname',functions:'proname',constraints:'table_name',triggers:'table_name',indexes:'tablename',sequences:'sequencename',relationAcl:'relname',functionAcl:'proname'};
const passwordObject=name=>name.startsWith('admin_member_password_');
function passwordCatalogWithoutAdditions(c) {
  return Object.fromEntries(Object.entries(c).map(([k,rows])=>[k,passwordCatalogFields[k]?rows.filter(r=>!passwordObject(r[passwordCatalogFields[k]])):rows]));
}
const passwordEmptyChecks=[...passwordTables.map(name=>`NOT EXISTS (SELECT FROM public.${quote(name)})`),`(SELECT NOT is_called AND last_value=1 FROM public.${quote(passwordSequence)})`];
const passwordDependencyColumns={members:['id','role','status','member_code','password_hash','updated_at','phone'],auth_sessions:['id','member_id','token_hash','mode','revoked_at','expires_at'],auth_otp_challenges:['phone','purpose','consumed_at','password_hash_at_issue'],auth_password_tickets:['phone','consumed_at','password_hash_at_issue','hash_started_at']};

async function passwordSchemaRollout(apply) {
  const report={mode:apply?'apply-password-schema':'rehearse-password-schema',applied:[],commitOutcome:'not-attempted',featureFlag:'unchanged (OFF per operator; deployment not queried)'};
  let stage='backup-path-protection',dir,db;
  const requireGate=(ok,message)=>{if(!ok){report.failedCheck=message;throw new Error('Password rollout gate failed');}};
  try {
    dir=protectedPasswordDirectory();report.artifacts=path.relative(root,dir);
    stage='source-and-target-config';
    const [migration]=passwordPlan();
    report.migrationChecksum=migration.checksum;
    const configured=dotenv.parse(fs.readFileSync(path.join(root,'.env.local')));
    requireGate(Boolean(configured.DATABASE_URL)&&(!process.env.DATABASE_URL||process.env.DATABASE_URL===configured.DATABASE_URL),'Use the known production .env.local, not a DATABASE_URL override');
    requireGate(configured.ENABLE_ADMIN_PASSWORD_RESET!=='true'&&process.env.ENABLE_ADMIN_PASSWORD_RESET!=='true','Local reset flag must not be true');
    const sql=client();
    requireGate(process.env.ENABLE_ADMIN_PASSWORD_RESET!=='true','Loaded reset flag must not be true');
    stage='production-read-only-capture';
    const b=await capture(sql,true,passwordDataQuery);
    const {database,principal,version}=b.identity[0];
    requireGate(digest(database)==='693fe5919fc229a2cf404ad99e03e8e9277fa4a6d34e88a0d4224d81b0b057a8'&&digest(principal)==='6f198191100386e1f0c093fc1c902c0520c6382059d75fb4743ec1ec75cc7842','Database or principal differs from documented production fingerprint');
    const before=driftCatalog(b);
    requireGate(isDeepStrictEqual(before,passwordCatalogWithoutAdditions(before)),'Password objects already exist; reconcile read-only, do not replay');
    reconcileExisting(b);
    requireGate(b.relations.some(r=>r.relname==='member_cards'&&r.relkind==='r')&&b.columns.some(c=>c.table_name==='members'&&c.column_name==='avatar_version'),'Expected post-card/avatar production baseline is absent');
    requireGate(Object.entries(passwordDependencyColumns).every(([table,cols])=>cols.every(col=>b.columns.some(c=>c.table_name===table&&c.column_name===col)))&&['PASSWORD_SETUP','PASSWORD_RESET'].every(label=>b.enums.some(e=>e.typname==='auth_otp_purpose'&&e.enumlabel===label))&&b.constraints.some(c=>c.table_name==='auth_sessions'&&c.conname==='auth_sessions_mode_check'&&c.contype==='c'&&c.definition.includes("'NORMAL'")&&c.definition.includes("'KIOSK'")),'Hardened auth dependency columns, OTP purposes or session-mode constraint are missing');
    stage='backup-integrity';
    const snapshot=JSON.stringify(b),file=path.join(dir,'snapshot.json');
    save(file,snapshot);
    report.snapshotChecksum=digest(snapshot);
    save(path.join(dir,'manifest.json'),JSON.stringify({files:{'snapshot.json':report.snapshotChecksum}}));
    const saved=fs.readFileSync(file,'utf8');
    requireGate(digest(saved)===report.snapshotChecksum,'Snapshot checksum mismatch');
    stage='native-recovery';
    const backup=JSON.parse(saved),restore=recoverySql(backup);
    db=await nativeDatabase(dir,backup.roles.find(r=>r.rolsuper).rolname);
    db.run(restore);
    const recovered=driftCatalog(nativeCatalog(db));
    report.recoveryCatalogDifferences=Object.keys(before).filter(k=>!isDeepStrictEqual(before[k],recovered[k]));
    requireGate(!report.recoveryCatalogDifferences.length,'Native recovery catalog mismatch');
    verifyRows(db,backup.tables);
    requireGate(isDeepStrictEqual(backup.sequenceState,sequenceStates(db,backup.sequences)),'Native recovery sequence state mismatch');
    report.recovery={readOnlyCapture:true,oldTables:Object.keys(b.tables).length,catalogSections:Object.keys(before).length};
    stage='native-password-schema-rehearsal';
    const batch=`BEGIN; SET LOCAL ROLE ${quote(principal)}; SET LOCAL search_path=public,pg_catalog; SET LOCAL row_security=off; SET LOCAL statement_timeout='60s'; ${migration.statements.join(';\n')};`;
    const checkOldRowsAndSequences=()=>{
      verifyRows(db,backup.tables);
      requireGate(isDeepStrictEqual(backup.sequenceState,sequenceStates(db,backup.sequences)),'Existing sequence state changed');
    };
    db.run(`${batch} ROLLBACK;`);
    requireGate(isDeepStrictEqual(before,driftCatalog(nativeCatalog(db))),'Native rollback did not restore catalog');
    checkOldRowsAndSequences();
    db.run(`${batch} COMMIT;`);
    const after=driftCatalog(nativeCatalog(db));
    requireGate(isDeepStrictEqual(before,passwordCatalogWithoutAdditions(after)),'Native rehearsal changed existing catalog or ACL');
    const newNames=(key,field)=>after[key].map(r=>r[field]).filter(passwordObject).sort();
    requireGate(isDeepStrictEqual(newNames('relations','relname').filter(n=>after.relations.some(r=>r.relname===n&&r.relkind==='r')),passwordTables)&&isDeepStrictEqual(newNames('sequences','sequencename'),[passwordSequence])&&isDeepStrictEqual(newNames('functions','proname'),['admin_member_password_action','admin_member_password_immutable']),'Unexpected password object inventory');
    checkOldRowsAndSequences();
    const nativeCheck=condition=>db.query(`SET ROLE ${quote(principal)}; SELECT to_json(${condition});`);
    requireGate(nativeCheck(passwordEmptyChecks.join(' AND ')),'New password tables or sequence were used');
    stage='native-password-acl';
    requireGate(nativeCheck(passwordAclCheck),'New password-object ACL or effective role privileges exceed baseline');
    requireGate(nativeCheck(passwordInvokerCheck),'Actual application principal lacks required invoker privileges');
    report.rehearsal={rollbackVerified:true,oldRowsAndCatalogUnchanged:true,newEmptyTables:passwordTables.length,effectiveAclVerified:true};
    if(!apply){report.outcome='VERIFIED native password schema rehearsal; production unchanged';return report;}
    stage='prepare-production-guards';
    requireGate(isDeepStrictEqual([migration],passwordPlan()),'Pinned password source changed');
    const settings=s=>[s.query("SET LOCAL statement_timeout='60s'"),s.query("SET LOCAL TIME ZONE 'UTC'"),s.query('SET LOCAL search_path=public,pg_catalog'),s.query('SET LOCAL row_security=off')];
    const identity=s=>guard(s,"current_database()=$1 AND current_user=$2 AND current_setting('server_version_num')=$3",[database,principal,version]);
    const catalog=(s,c)=>Object.entries(c).map(([k,rows])=>guard(s,
      `(SELECT coalesce(jsonb_agg(to_jsonb(t)-$2::text[]),'[]'::jsonb) FROM (${queries[k]}) t)=$1::jsonb`,
      [JSON.stringify(rows),k==='sequences'?[...catalogOmit,'last_value']:catalogOmit]));
    const oldRows=s=>Object.entries(b.tables).map(([name,t])=>guard(s,`(SELECT fingerprint=$1 AND row_count=$2 FROM (${passwordDataQuery(name)}) x)`,[t.fingerprint,t.row_count]));
    const oldSequences=s=>Object.entries(b.sequenceState).map(([name,state])=>guard(s,`(SELECT last_value::text=$1 AND is_called=$2 FROM public.${quote(name)})`,[state.last_value,state.is_called]));
    const post=s=>[...catalog(s,after),...oldRows(s),...oldSequences(s),...passwordEmptyChecks.map(c=>guard(s,c)),guard(s,passwordAclCheck),guard(s,passwordInvokerCheck)];
    const transaction=[...settings(sql),sql.query("SET LOCAL lock_timeout='5s'"),sql.query('SELECT pg_advisory_xact_lock(18261118,20)'),
      sql.query('LOCK TABLE '+Object.keys(b.tables).map(n=>'public.'+quote(n)).join(',')+' IN SHARE MODE'),identity(sql),
      guard(sql,"NOT EXISTS (SELECT FROM pg_event_trigger WHERE evtenabled<>'D')"),...catalog(sql,before),...oldRows(sql),...oldSequences(sql),
      ...migration.statements.map(s=>sql.query(s)),...post(sql)];
    stage='production-transaction';
    save(path.join(dir,'transaction-intent.json'),JSON.stringify({status:'reconcile read-only if no final report',migration:migration.file,checksum:migration.checksum}));
    report.commitOutcome='unknown';
    await sql.transaction(transaction,{isolationLevel:'ReadCommitted'});
    report.commitOutcome='committed';report.applied=[migration.file];
    stage='production-read-only-postflight';
    const audit=client();
    await audit.transaction([...settings(audit),identity(audit),guard(audit,"current_setting('transaction_read_only')='on'"),...post(audit)],{readOnly:true,isolationLevel:'RepeatableRead'});
    report.postflight={readOnly:true,oldTables:Object.keys(b.tables).length,oldCatalogUnchanged:true,newEmptyTables:passwordTables.length,unexpectedPrivilegeExpansion:false};
    report.outcome='VERIFIED production password schema only';
  } catch(e) {
    const safe=/^(Protected Windows backup directory required|Backup directory ACL could not be restricted and verified|Existing R2 source\/schema checksum mismatch|Unknown migration inventory|Existing R2 objects have no trusted migration inventory|Typed row comparison failed|Native operation failed|Native engine unavailable|Unsupported recovery feature; fail closed|Unreviewed R2 migration)$/;
    report.blocker={stage,reason:report.failedCheck??(safe.test(e.message)?e.message:undefined),code:/^[0-9A-Z]{5}$/.test(e?.code??'')?e.code:undefined};
    delete report.failedCheck;
    report.outcome=report.commitOutcome==='committed'?'Committed; read-only postflight failed, do not replay':report.commitOutcome==='unknown'?'Transaction submitted; reconcile read-only before any retry':'BLOCKED; no migration transaction attempted';
    process.exitCode=1;
  } finally {
    if(db)try{db.close();report.nativeStopped=true;}catch{report.nativeStopped=false;process.exitCode=1;}
    if(dir)try{save(path.join(dir,'report.json'),JSON.stringify(report,null,2));}catch{report.reportWriteFailed=true;process.exitCode=1;}
    console.log(JSON.stringify(report,null,2));
  }
  return report;
}

export async function main(args=process.argv.slice(2)) {
  if(args.length===1&&['--rehearse-password-schema','--apply-password-schema'].includes(args[0]))return passwordSchemaRollout(args[0]==='--apply-password-schema');
  if(args.length===1&&args[0]==='--apply-card-avatar')return applyCardAvatar();
  if(['--rehearse-card-avatar','--rehearse-card-avatar-catalog','--rehearse-card-avatar-protected'].includes(args[0])&&args.length<=2&&!args[1]?.startsWith('-')) {
    const report=await offlineCardAvatar(args[1],args[0]);
    console.log(JSON.stringify(report,null,2));return report;
  }
  if(args.length===1&&args[0]==='--capture-only'){
    protect();
    if(!fs.lstatSync(local).isDirectory()||fs.realpathSync(local)!==local)throw new Error('Protected backup path required');
    const b=await capture(client());
    const dir=fs.mkdtempSync(path.join(local,'r2-capture-'));
    const file=path.join(dir,'snapshot.json');
    const text=JSON.stringify(b,null,2),checksum=digest(text);
    save(file,text);
    if(digest(fs.readFileSync(file))!==checksum)throw new Error('Backup checksum mismatch');
    save(path.join(dir,'manifest.json'),JSON.stringify({files:{'snapshot.json':checksum}},null,2));
    const report={outcome:'Captured read-only',artifacts:path.relative(root,dir),tables:Object.keys(b.tables).length,snapshotChecksum:checksum};
    console.log(JSON.stringify(report,null,2));return report;
  }
  if(args.some(a=>!['--dry-run','--backup','--apply'].includes(a))||(args.includes('--dry-run')&&args.includes('--apply')))throw new Error('Invalid arguments');
  const migrations=selectedPlan(),sql=client(),b=await capture(sql);
  const allR2=b.relations.filter(r=>scopeName(r.relname)).length+b.functions.filter(r=>scopeName(r.proname)).length;
  const report={startedAt:new Date().toISOString(),mode:args.includes('--apply')?'apply-profile-contact':'read-only',databaseFingerprint:digest(b.identity[0].database),principalFingerprint:digest(b.identity[0].principal),migrationChecksums:Object.fromEntries(plan().map(m=>[m.file,m.checksum])),uatCounts:b.uat[0],applied:[],password:'NOT APPLIED: coordinated auth deployment/drain gate remains',blockers:[]};
  if(!args.includes('--backup')&&!args.includes('--apply')){
    report.existingProfileContactObjects=allR2;
        if(allR2){reconcileExisting(b,migrations);report.alreadyApplied=migrations.map(m=>m.file);report.outcome='Exact approved inventory and current schema match; read-only, no replay';}
        console.log(JSON.stringify(report,null,2));return report;
  }
  protect();const dir=path.join(local,'r2-rollout-'+stamp());fs.mkdirSync(dir,{mode:0o700});
  const record=()=>fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
  report.artifacts=path.relative(root,dir);record();
  let db,stage='backup';
  try {
    const text=JSON.stringify(b,null,2);save(path.join(dir,'snapshot.json'),text);
    const restore=recoverySql(b);save(path.join(dir,'restore-complete.sql'),restore);
    const manifest={files:{'snapshot.json':digest(text),'restore-complete.sql':digest(restore)},counts:Object.fromEntries(Object.entries(b.tables).map(([n,t])=>[n,Number(t.row_count)])),limitations:'App public-schema recovery, no role passwords or cloud control plane/PITR. Sequence last_value/is_called captured exactly but sequence state is non-MVCC; no cloud control plane or role passwords.'};
    save(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
    for(const [f,h]of Object.entries(manifest.files))if(digest(fs.readFileSync(path.join(dir,f)))!==h)throw new Error('Backup checksum mismatch');
    report.backup={tables:Object.keys(b.tables).length,snapshotChecksum:manifest.files['snapshot.json'],restoreChecksum:manifest.files['restore-complete.sql']};record();
    stage='native-recovery';db=await nativeDatabase(dir,b.roles.find(r=>r.rolsuper).rolname);db.run(restore);
    for(const [name,t]of Object.entries(b.tables)) {
      const result=db.query(comparisonSql(name,t.rows));
      if(result.missingCount||result.extraCount||String(result.expectedCount)!==t.row_count||result.expectedCount!==result.actualCount)throw new Error('Native data comparison failed');
    }
    const recovered=nativeCatalog(db);
    const expected=catalogComparable(b),actual=catalogComparable(recovered);
    const different=Object.keys(expected).filter(k=>!isDeepStrictEqual(expected[k],actual[k]));
    if(different.length){report.recoveryCatalogDifferences=different;throw new Error('Native catalog comparison failed');}
    for(const [name,state] of Object.entries(b.sequenceState)) {
      const restored=db.query(`SELECT row_to_json(t)::text FROM (SELECT last_value::text,is_called FROM public.${quote(name)}) t;`);
      if(!isDeepStrictEqual(state,restored))throw new Error('Sequence recovery mismatch');
    }
    report.recovery={engine:'native PostgreSQL18 / libpq adapter, not stock psql',dataTables:Object.keys(b.tables).length,catalogSections:Object.keys(expected).length,verified:'typed multiset equality including microseconds/numeric precision, catalog definitions/owners/ACL/default ACL/memberships',limitations:manifest.limitations};record();
    stage='migration-rehearsal';
    if(allR2) {
          reconcileExisting(b,migrations);
          report.outcome='Already applied: exact approved source checksums and recorded object definitions match; no production writes';
          report.alreadyApplied=migrations.map(m=>m.file);
          return report;
        }
    if(b.relations.some(r=>r.relname==='r2_schema_rollouts'))throw new Error('Existing metadata requires reconciliation; no overwrite');
    const principal=b.identity[0].principal;
    db.run(`SET ROLE ${quote(principal)}; SET search_path=public,pg_catalog; BEGIN; ${metadataDdl} ${migrations.flatMap(m=>m.statements).join(';\n')}; COMMIT;`);
    const staged=nativeCatalog(db),expectedScope=scopeCatalog(staged);
        save(path.join(dir,'rehearsal-scope.json'),JSON.stringify(expectedScope,null,2));
    const permissions=db.query(`SELECT json_agg(t)::text FROM (${permissionQuery()}) t;`);
    const tablePermissions=db.query(`SELECT json_agg(t)::text FROM (${tablePermissionQuery()}) t;`);
    if(tablePermissions.some(r=>r.new_access&&!r.baseline_trusted))throw new Error('New table exposure to untrusted principal');
    if(permissions.some(r=>r.new_execute&&!r.baseline_trusted))throw new Error('New function exposure to untrusted principal');
    if(expectedScope.functionAcl.some(a=>a.grantee==='PUBLIC')||expectedScope.relationAcl.some(a=>a.grantee==='PUBLIC'))throw new Error('PUBLIC exposure');
    for(const [name,t]of Object.entries(b.tables)){
      const result=db.query(comparisonSql(name,t.rows));if(result.missingCount||result.extraCount)throw new Error('Rehearsal altered existing data');
    }
    report.rehearsal={migrations:migrations.map(m=>m.file),newTables:expectedScope.relations.filter(r=>r.relkind==='r').length,newFunctions:expectedScope.functions.length,untrustedAccess:0,existingDataUnchanged:true};record();
    if(args.includes('--apply')) {
      stage='production-transaction';
      if(!isDeepStrictEqual(migrations,selectedPlan()))throw new Error('Source changed');
      // SHARE locks block writes/DDL during snapshot guard and additive schema installation.
      const statements=[sql.query("SET LOCAL lock_timeout='5s'"),sql.query("SET LOCAL statement_timeout='60s'"),sql.query("SET LOCAL TIME ZONE 'UTC'"),sql.query('SET LOCAL search_path=public,pg_catalog'),sql.query('SELECT pg_advisory_xact_lock(18261118,20)'),sql.query('LOCK TABLE '+Object.keys(b.tables).map(n=>'public.'+quote(n)).join(',')+' IN SHARE MODE')];
      for(const [name,t]of Object.entries(b.tables))statements.push(guard(sql,`(SELECT fingerprint FROM (${dataQuery(name)}) x)=$1`,[t.fingerprint]));
      for(const k of ['columns','relations','functions','constraints','triggers','memberships','policies','schemas','defaults','enums','indexes','views','relationAcl','functionAcl','schemaAcl','defaultAcl'])statements.push(guard(sql,`(SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM (${queries[k]}) t)=$1::jsonb`,[JSON.stringify(b[k])]));
      statements.push(...splitSql(metadataDdl).map(s=>sql.query(s)),...migrations.flatMap(m=>m.statements.map(s=>sql.query(s))));
      for(const m of migrations)statements.push(sql.query('INSERT INTO public.r2_schema_rollouts(name,checksum,objects) VALUES($1,$2,$3::jsonb)',[m.file,m.checksum,JSON.stringify(expectedScope)]));
      for(const [name,t]of Object.entries(b.tables))statements.push(guard(sql,`(SELECT fingerprint FROM (${dataQuery(name)}) x)=$1`,[t.fingerprint]));
      statements.push(guard(sql,`NOT EXISTS(SELECT 1 FROM (${permissionQuery()}) p WHERE p.new_execute AND NOT p.baseline_trusted)`));
            statements.push(guard(sql,`NOT EXISTS(SELECT 1 FROM (${tablePermissionQuery()}) p WHERE p.new_access AND NOT p.baseline_trusted)`));
      // Compare exact PostgreSQL-rendered post-migration definitions to native rehearsal before COMMIT.
      for(const [k,rows]of Object.entries(expectedScope)) {
        const field=['columns','constraints','triggers'].includes(k)?'table_name':['relations','relationAcl'].includes(k)?'relname':k==='indexes'?'tablename':'proname';
        const omit=['oid','relacl','proacl','nspacl','defaclacl','attacl'];
        statements.push(guard(sql,`(SELECT coalesce(jsonb_agg(to_jsonb(t)-$2::text[]),'[]'::jsonb) FROM (${queries[k]}) t WHERE ${quote(field)} ~ '^(admin_member_profile_|member_contact_)')=$1::jsonb`,[JSON.stringify(rows),omit]));
      }
      report.commitOutcome='unknown-until-confirmed';record();
      await sql.transaction(statements,{isolationLevel:'Serializable'});
      report.commitOutcome='committed';
      report.applied=migrations.map(m=>m.file);report.outcome='COMMITTED profile/contact schema only; no member/contact/audit writes';record();
      stage='production-postflight';
      const after=await capture(sql);
      if(!isDeepStrictEqual(scopeCatalog(after),expectedScope))throw new Error('Postflight definition drift');
      report.postflight={scopeDefinitionsMatch:true,newTableCounts:Object.fromEntries(Object.entries(after.tables).filter(([n])=>scopeName(n)).map(([n,t])=>[n,Number(t.row_count)])),passwordObjects:after.relations.filter(r=>r.relname.startsWith('admin_member_password_')).length};
      if(Object.values(report.postflight.newTableCounts).some(n=>n!==0)||report.postflight.passwordObjects)throw new Error('Unexpected postflight data/password object');
      report.outcome='VERIFIED profile/contact schema-only commit';
    }else report.outcome='Recovery and profile/contact schema rehearsal verified; production unchanged';
  }catch(e){report.blockers.push({stage,code:/^[0-9A-Z]{5}$/.test(e?.code??'')?e.code:'suppressed'});report.outcome=report.applied.length?'Committed; postflight requires inspection, do not replay':report.commitOutcome==='unknown-until-confirmed'?'Transaction attempted; reconcile inventory read-only before any retry (commit outcome unconfirmed)':'BLOCKED; no migration transaction attempted';process.exitCode=1;}
  finally{if(db)try{db.close();report.nativeStopped=true;}catch{report.nativeStopped=false;process.exitCode=1;}report.finishedAt=new Date().toISOString();record();console.log(JSON.stringify(report,null,2));}
  return report;
}
// Shared recovery primitives; importing this module never runs its CLI.
export { queries as recoveryQueries, driftCatalog, verifyRows, sequenceStates, protectedPasswordDirectory };
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(safeFailure);
