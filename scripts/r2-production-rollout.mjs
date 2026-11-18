import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { client, root, local, protect, save, stamp, digest, quote, safeFailure } from './db-safety.mjs';
import { splitSql } from './db-payments-sql.mjs';

const literal = v => "'" + String(v).replaceAll("'", "''") + "'";
const approved = {
  '20261118_R2_admin_member_profile.sql': '9d3b5f4722113fcae20513928ccba52876b90ed0029059d8009a5e0247c12cdc',
  '20261118_R2_admin_member_password.sql': '1e2122644fffd107dcd6c359320b1a67b2fc43f37ddebf5b3a5e3402136b3e08',
  '20261118_R2_member_contact_email.sql': '865febf7807952fcf2c68a71e4c7e4f15272a32235d0d61b05add1ad558aaccd',
};
export function plan() {
  return Object.entries(approved).map(([file, checksum]) => {
    const text = fs.readFileSync(path.join(root, 'src/db/migrations', file), 'utf8');
    const statements = splitSql(text);
    if (digest(text) !== checksum || statements.shift() !== 'BEGIN' || statements.pop() !== 'COMMIT') throw new Error('Unreviewed R2 migration');
    return { file, checksum, statements };
  });
}
export const selectedPlan = () => plan().filter(m => !m.file.includes('password'));

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
async function capture(sql) {
  const discovered = await sql.query("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY relname");
  const names = discovered.map(r => r.relname);
  const sequences = await sql.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename");
  const keys = Object.keys(queries);
  const results = await sql.transaction([sql.query("SET LOCAL TIME ZONE 'UTC'"), ...keys.map(k => sql.query(`SELECT coalesce(json_agg(t),'[]'::json)::text AS records FROM (${queries[k]}) t`)), ...names.map(n => sql.query(dataQuery(n))), ...sequences.map(s=>sql.query(`SELECT last_value::text,is_called FROM public.${quote(s.sequencename)}`))], { readOnly: true, isolationLevel: 'RepeatableRead' });
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
export function comparisonSql(name, rows) {
  return `WITH expected AS (SELECT to_jsonb(ROW(t.*))::text COLLATE "C" AS row FROM json_populate_recordset(NULL::public.${quote(name)},${literal(rows)}::json) t),actual AS (SELECT to_jsonb(ROW(t.*))::text COLLATE "C" AS row FROM public.${quote(name)} t),missing AS (SELECT row FROM expected EXCEPT ALL SELECT row FROM actual),extra AS (SELECT row FROM actual EXCEPT ALL SELECT row FROM expected) SELECT json_build_object('expectedCount',(SELECT count(*) FROM expected),'actualCount',(SELECT count(*) FROM actual),'missingCount',(SELECT count(*) FROM missing),'extraCount',(SELECT count(*) FROM extra))::text;`;
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
async function nativeDatabase(directory, bootstrap) {
  const tools = path.join(local,'portable-postgres-uat');
  const bin = path.join(tools,'package/native/bin');
  for (const f of ['initdb.exe','pg_ctl.exe']) if (!fs.existsSync(path.join(bin,f))) throw new Error('Native engine unavailable');
  const port = await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
  const env = Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG')&&!['DATABASE_URL','SMS_API_SECRET'].includes(k)));
  env.PYTHONIOENCODING='utf-8';
  const data=path.join(directory,'native-data');
  const invoke=(file,args,input,timeout=60000)=>{
    try { return execFileSync(file,args,{env,input,encoding:'utf8',timeout,maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}); }
    catch(e){ const safe=new Error('Native operation failed');safe.code=String(e.stderr??'').match(/SQLSTATE=([0-9A-Z]{5})/)?.[1];throw safe; }
  };
  invoke(path.join(bin,'initdb.exe'),['-D',data,'-U',bootstrap,'--auth-local=reject','--auth-host=trust','--encoding=UTF8','--locale=C']);
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
function nativeCatalog(db) {
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
function scopeCatalog(b) {
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
export async function main(args=process.argv.slice(2)) {
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
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(safeFailure);
