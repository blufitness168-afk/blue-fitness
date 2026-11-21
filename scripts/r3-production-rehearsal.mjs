import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual as equal } from 'node:util';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { digest, local, quote, root, save } from './db-safety.mjs';
import { splitSql } from './db-payments-sql.mjs';
import { driftCatalog, nativeCatalog, nativeDatabase, protectedPasswordDirectory, recoveryQueries, recoverySql, reconcileExisting, sequenceStates, verifyRows } from './r2-production-rollout.mjs';

const inventory = {
  '20261118_r3_package_catalog.sql': 'dab6b9996948f8d22718daadcb4a18eb1902500db750e306713d0ea511ae9395',
  '20261118_r3_package_catalog_checkin.sql': 'd28adb069893222ffed042e835357b522fe6e87671a4e126169cc676afb3e2a2',
  '20261119_r3_package_bonus_points.sql': 'f07bb7aec2490ebdb32885ee6df7dd894a9ebaa2916ae26ef3c3ef1d613e28a2',
  '20261119_r3_member_time_override.sql': '2285ca3137e5632cec52e4e1be90ffd2e154b2543ac8492a2b76627c5d8f62d5',
};
const databaseHash = '693fe5919fc229a2cf404ad99e03e8e9277fa4a6d34e88a0d4224d81b0b057a8';
const principalHash = '6f198191100386e1f0c093fc1c902c0520c6382059d75fb4743ec1ec75cc7842';
const historical = 'r2-password-schema-doKqh4';
const historicalHash = 'abb32abafa780b5295e25c87eb751af0e7ecc8355068f157eb22b1cb8d8a3b59';
const readSource = file => fs.readFileSync(path.join(root, 'src/db/migrations', file), 'utf8');
const literal = s => `'${s.replaceAll("'", "''")}'`;

export function migrationPlan(sources = readSource) {
  return Object.entries(inventory).map(([file, checksum]) => {
    const text = sources(file);
    if (digest(text) !== checksum) throw new Error('Unreviewed R3 migration');
    const statements = splitSql(text);
    if (statements.shift() !== 'BEGIN' || statements.pop() !== 'COMMIT') throw new Error('Unexpected R3 transaction wrapper');
    return { file, statements };
  });
}

const extras = {
  eventTriggers: 'SELECT evtname, evtenabled FROM pg_event_trigger ORDER BY evtname',
  functionAttributes: "SELECT proname,pg_get_function_identity_arguments(p.oid) AS arguments,provolatile::text,proisstrict,proleakproof,proparallel::text,prosecdef,proconfig,pg_get_function_result(p.oid) AS result FROM pg_proc p WHERE pronamespace='public'::regnamespace ORDER BY proname,arguments",
};
export const metadataQueries = Object.fromEntries(Object.entries({...recoveryQueries, ...extras}).filter(([key]) => key !== 'uat').map(([key, query]) => [key, key === 'sequences' ? query.replace('s.last_value::text', 'NULL::text AS last_value') : query]));
const jsonQuery = q => `SELECT coalesce(json_agg(t),'[]'::json)::text AS records FROM (${q}) t`;
export async function captureMetadata(sql, discovery) {
  const keys = Object.keys(metadataQueries);
  const tables = discovery?.relations.filter(r=>r.relkind==='r').map(r=>r.relname) ?? [];
  const sequences = discovery?.sequences.map(s=>s.sequencename) ?? [];
  const readSequence = name=>sql.query(`SELECT last_value::text,is_called FROM public.${quote(name)}`);
  const results = await sql.transaction([
    sql.query("SET LOCAL statement_timeout='20s'"), sql.query("SET LOCAL lock_timeout='3s'"),
    sql.query('SET LOCAL search_path=public,pg_catalog'),
    sql.query("SELECT 1 / CASE WHEN encode(sha256(convert_to(current_database(),'UTF8')),'hex')=$1 AND encode(sha256(convert_to(current_user,'UTF8')),'hex')=$2 AND current_setting('transaction_read_only')='on' THEN 1 ELSE 0 END AS guard", [databaseHash,principalHash]),
    ...keys.map(k => sql.query(jsonQuery(metadataQueries[k]))),
    ...(discovery ? [sql.query("SELECT set_config('TimeZone','UTC',true),set_config('row_security','off',true)"),
      ...sequences.map(readSequence),
      ...tables.map(n=>sql.query(`SELECT row_count,rows,${shaSql('rows')} AS fingerprint FROM (${dataSql(n)}) data`)),
      ...sequences.map(readSequence)] : []),
  ], { readOnly: true, isolationLevel: 'RepeatableRead' });
  const b = Object.fromEntries(keys.map((k,i) => [k, JSON.parse(results[i+4][0].records)]));
  const { database, principal, read_only, version } = b.identity[0];
  if (read_only !== 'on' || digest(database) !== databaseHash || digest(principal) !== principalHash || !/^18\d{4}$/.test(version)) throw new Error('Unexpected production target');
  if (discovery) {
    requireGate(equal(b,discovery),'Production metadata changed during backup discovery');
    const start=keys.length+5;
    b.sequenceState=Object.fromEntries(sequences.map((n,i)=>{
      const early=results[start+i][0], late=results[start+sequences.length+tables.length+i][0];
      requireGate(early && equal(early,late),'Sequence changed during capture');
      return [n,early];
    }));
    b.tables=Object.fromEntries(tables.map((n,i)=>[n,results[start+sequences.length+i][0]]));
  }
  return b;
}

const dependencies = {
  '20261024_kiosk.sql': ['kiosk_checkin'],
  '20261024_real_frontdesk.sql': ['real_frontdesk_checkin'],
  '20261025_package_payment_benefits.sql': ['protect_package_benefits_version'],
  '20261031_package_catalog.sql': ['package_catalog_action','create_catalog_package_payment_order','issue_paid_package_benefits','protect_package_catalog','protect_package_catalog_audit'],
  '20261031_package_catalog_order_guard.sql': ['guard_package_catalog_order_insert'],
  '20261118_R2_member_cards.sql': ['member_scan_admit','member_card_admit','member_card_read'],
};
const helpers = ['package_catalog_daily_slot_valid','package_catalog_slot_allows','package_catalog_legacy_paid_slot'];
const replaced = ['package_catalog_action','kiosk_checkin','real_frontdesk_checkin'];
const bonusReplaced = ['create_catalog_package_payment_order','create_package_payment_order','guard_package_catalog_order_insert'];
const allReplaced = [...replaced,...bonusReplaced];
const journal = 'r3_member_time_override_events';
const overrideFns = {r3_override_immutable:'',r3_override_current_order:'integer,timestamptz',r3_override_slot:'integer,timestamptz',r3_override_staff:'text',r3_override_read:'text,text',r3_override_write:'text,uuid,jsonb',r3_override_r7_snapshot:'',r3_override_attach_r7:''};
const checkNames = ['package_catalog_id_check','package_catalog_time_slot_check','package_catalog_audit_action_check'];
const body = definition => definition?.match(/\bAS (\$\w*\$)([\s\S]*?)\1/i)?.[2];
export function prerequisiteIssues(b, sources = readSource) {
  const issues = [];
  for (const [file, names] of Object.entries(dependencies)) {
    const statements = splitSql(sources(file));
    for (const name of names) {
      const expected = statements.find(s => new RegExp(`^CREATE (?:OR REPLACE )?FUNCTION (?:public\\.)?${name}\\(`, 'i').test(s));
      const found = b.functions.filter(f => f.proname === name);
      if (!body(expected) || found.length !== 1 || body(found[0].definition) !== body(expected)) issues.push(`source:${name}`);
      if (found.length === 1 && (found[0].prosecdef || ![JSON.stringify(['search_path=public, pg_catalog']),JSON.stringify(['search_path=pg_catalog, public'])].includes(JSON.stringify(found[0].proconfig)))) issues.push(`invoker/path:${name}`);
    }
  }
  if (b.functions.some(f => helpers.includes(f.proname) || f.proname.startsWith('r3_override_')) || b.relations?.some(r=>r.relname===journal) || b.columns?.some(c=>c.table_name==='package_catalog' && c.column_name==='bonus_points')) issues.push('partial or applied R3 schema');
  if (b.functions.some(f=>['time_supplement_allows','r7_visit_action'].includes(f.proname)) || b.relations?.some(r=>r.relname==='r7_visits')) issues.push('unexpected later admission schema');
  if (b.eventTriggers.some(t => t.evtenabled !== 'D')) issues.push('enabled event triggers');
  for (const [table,name,parts] of [
    ['package_catalog',checkNames[0],['id >= 1','id <= 10']],
    ['package_catalog',checkNames[1],["'07:00-14:00'","'07:00-22:00'"]],
    ['package_catalog_audit',checkNames[2],["'update'"]],
  ]) {
    const check = b.constraints.find(c => c.table_name === table && c.conname === name && c.contype === 'c');
    if (!check || !parts.every(p => check.definition.includes(p))) issues.push(`constraint:${name}`);
  }
  for (const name of ['package_catalog_audit_guard','package_catalog_guard','package_catalog_truncate_guard','package_catalog_order_insert_guard','package_paid_benefits','package_benefits_version_guard','member_card_scan_guard']) {
    if (!b.triggers.some(t => t.tgname === name && ['O','A'].includes(t.tgenabled))) issues.push(`trigger:${name}`);
  }
  if (![...Object.values(dependencies).flat()].every(n => !b.functionAcl.some(a => a.proname === n && a.grantee === 'PUBLIC'))) issues.push('PUBLIC prerequisite EXECUTE');
  return issues;
}

class RolloutGateError extends Error {}
const requireGate = (ok, message) => { if (!ok) throw new RolloutGateError(message); };

function readHistorical() {
  const dir = path.join(local,historical);
  const files = [dir,...['snapshot.json','manifest.json'].map(n => path.join(dir,n))];
  for (const [i,file] of files.entries()) {
    const stat = fs.lstatSync(file);
    requireGate((i ? stat.isFile() : stat.isDirectory()) && !stat.isSymbolicLink() && fs.realpathSync(file) === file, 'Unexpected historical backup path');
  }
  const script = String.raw`
$ErrorActionPreference='Stop'
$p=$env:R3_HISTORICAL_DIRECTORY
$ids=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18')
foreach($name in @($p, (Join-Path $p 'snapshot.json'), (Join-Path $p 'manifest.json'))) {
 $a=Get-Acl -LiteralPath $name
 $r=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 if(($name -eq $p -and !$a.AreAccessRulesProtected) -or $r.Count -ne 2 -or @($r.IdentityReference.Value | Sort-Object -Unique).Count -ne 2 -or @($r | Where-Object { $_.IdentityReference.Value -notin $ids -or $_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne 'FullControl' }).Count -ne 0) { throw 'Unexpected historical ACL' }
}
`;
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...process.env,R3_HISTORICAL_DIRECTORY:dir},stdio:'pipe',timeout:15000});
  const manifest = JSON.parse(fs.readFileSync(files[2],'utf8'));
  const text = fs.readFileSync(files[1],'utf8');
  requireGate(manifest.files['snapshot.json'] === historicalHash && digest(text) === historicalHash, 'Historical backup pin mismatch');
  return JSON.parse(text);
}

const newPasswordObject = n => n.startsWith('admin_member_password_');
const oldCatalogKeys = {columns:'table_name', relations:'relname', functions:'proname', constraints:'table_name', triggers:'table_name', indexes:'tablename', sequences:'sequencename', relationAcl:'relname', functionAcl:'proname'};
export function historicalDelta(old, current) {
  const historic = driftCatalog(old), live = driftCatalog(current);
  return Object.keys(live).filter(k => !equal(historic[k],oldCatalogKeys[k] ? live[k].filter(row => !newPasswordObject(row[oldCatalogKeys[k]])) : live[k]));
}

const helpersByName = {package_catalog_daily_slot_valid:'text', package_catalog_slot_allows:'text,time',package_catalog_legacy_paid_slot:'jsonb'};
const callable = {...helpersByName,...overrideFns, package_catalog_action:'text,text,uuid,jsonb', kiosk_checkin:'text,text,uuid,text', real_frontdesk_checkin:'text,text,uuid,text', member_scan_admit:'text,text,uuid,text,text', member_card_admit:'text,text,uuid,text,text', member_card_read:'text,text', create_catalog_package_payment_order:'uuid,integer,text,uuid,jsonb,jsonb'};
const signature = name => `public.${name}(${callable[name]})`;
const sqlNames = names => names.map(literal).join(',');
const newFunctions = [...helpers,...Object.keys(overrideFns)];
const tableBits = ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'];
export function aclGate(principal) {
  return `WITH helpers AS (
    SELECT oid,proowner,proacl FROM pg_proc WHERE oid IN (${newFunctions.map(n=>`${literal(signature(n))}::regprocedure`).join(',')})
  ), required AS (SELECT unnest(ARRAY[${sqlNames(Object.keys(callable).map(signature))}])::regprocedure AS oid)
  SELECT to_json((SELECT count(*)=${newFunctions.length} FROM helpers)
    AND NOT EXISTS (SELECT FROM helpers h CROSS JOIN LATERAL aclexplode(coalesce(h.proacl,acldefault('f',h.proowner))) a WHERE a.grantee<>h.proowner OR a.grantor<>h.proowner)
    AND NOT EXISTS (SELECT FROM helpers h WHERE h.proowner<>${literal(principal)}::regrole)
    AND NOT EXISTS (SELECT FROM required WHERE NOT has_function_privilege(${literal(principal)},oid,'EXECUTE'))
    AND NOT EXISTS (SELECT FROM helpers h CROSS JOIN pg_roles r
      CROSS JOIN unnest(ARRAY[${sqlNames(replaced.map(signature))}]) f(signature)
      WHERE has_function_privilege(r.oid,f.signature,'EXECUTE') AND NOT has_function_privilege(r.oid,h.oid,'EXECUTE'))
    AND NOT EXISTS (SELECT FROM helpers h CROSS JOIN pg_roles r CROSS JOIN (VALUES ('EXECUTE'),('EXECUTE WITH GRANT OPTION')) p(bit)
      CROSS JOIN (SELECT oid FROM required WHERE oid NOT IN (SELECT oid FROM helpers)) old
      WHERE has_function_privilege(r.oid,h.oid,p.bit) AND NOT has_function_privilege(r.oid,old.oid,p.bit))
    AND NOT EXISTS (SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid='public.${journal}'::regclass AND (c.relowner<>${literal(principal)}::regrole OR a.grantee<>c.relowner OR a.grantor<>c.relowner))
    AND NOT EXISTS (SELECT FROM pg_roles r CROSS JOIN unnest(ARRAY[${sqlNames(tableBits)}]) p(bit) CROSS JOIN (VALUES (''),(' WITH GRANT OPTION')) g(suffix)
      WHERE has_table_privilege(r.oid,'public.${journal}',p.bit||g.suffix) AND NOT has_table_privilege(r.oid,'public.member_card_audit',p.bit||g.suffix))
    AND has_table_privilege(${literal(principal)},'public.${journal}','SELECT,INSERT')
    AND has_schema_privilege(${literal(principal)},'public','USAGE')
    AND has_table_privilege(${literal(principal)},'public.package_catalog_public','SELECT'));`;
}

function verifyR3Delta(before,after,principal,report) {
  const oldFormula = before.constraints.filter(c=>c.table_name==='package_payment_orders' && c.contype==='c' && c.definition==='CHECK ((points_earned = (amount_satang / 2000)))');
  requireGate(oldFormula.length===1,'Expected original points formula');
  const strip = (b,post) => {
    const c = driftCatalog(b);
    c.constraints = c.constraints.filter(r => !(['package_catalog','package_catalog_audit'].includes(r.table_name) && checkNames.includes(r.conname)) && !(r.table_name==='package_payment_orders' && r.conname===(post?'package_payment_orders_points_formula_check':oldFormula[0].conname)) && !(post && r.table_name==='package_catalog' && (r.conname==='package_catalog_bonus_points_check' || (r.conname==='package_catalog_bonus_points_not_null' && r.contype==='n' && r.definition==='NOT NULL bonus_points'))));
    c.functions = c.functions.filter(r => !newFunctions.includes(r.proname)).map(r => allReplaced.includes(r.proname) ? {...r,definition:undefined} : r);
    if (post) {
      c.functionAcl = c.functionAcl.filter(r => !newFunctions.includes(r.proname));
      c.columns=c.columns.filter(r=>!(r.table_name==='package_catalog' && r.column_name==='bonus_points') && !(r.table_name==='package_catalog_public' && r.column_name==='bonusPoints'));
      for (const [field,key] of Object.entries({columns:'table_name',constraints:'table_name',triggers:'table_name',indexes:'tablename',relationAcl:'relname'})) c[field]=c[field].filter(r=>r[key]!==journal);
      const indexes=b.indexes.filter(r=>r.tablename===journal).map(r=>r.indexname);
      c.relations=c.relations.filter(r=>r.relname!==journal && !indexes.includes(r.relname));
      c.views=c.views.map(r=>r.relname==='package_catalog_public'?{...r,definition:r.definition.replace(/,\s*bonus_points AS "bonusPoints"/,'')}:r);
    }
    return c;
  };
  const oldCatalog=strip(before,false), newCatalog=strip(after,true);
  report.unexpectedCommitCatalogSections=Object.keys(oldCatalog).filter(k=>!equal(oldCatalog[k],newCatalog[k]));
  if (report.unexpectedCommitCatalogSections.includes('constraints')) report.unexpectedConstraints=newCatalog.constraints.filter(c=>!oldCatalog.constraints.some(o=>equal(o,c))).map(c=>({table:c.table_name,name:c.conname,type:c.contype}));
  requireGate(!report.unexpectedCommitCatalogSections.length, 'Unexpected R3 catalog/ACL delta');
  requireGate(equal(before.eventTriggers,after.eventTriggers) && equal(before.functionAttributes,after.functionAttributes.filter(f=>!newFunctions.includes(f.proname))), 'Unexpected function attributes/event trigger delta');
  requireGate(allReplaced.every(n => before.functions.find(f=>f.proname===n).oid === after.functions.find(f=>f.proname===n).oid && before.functions.find(f=>f.proname===n).definition !== after.functions.find(f=>f.proname===n).definition), 'Replacement function identity preserved');
  requireGate(helpers.every(n => after.functions.filter(f=>f.proname===n && f.owner===principal && !f.prosecdef && equal(f.proconfig,['search_path=public, pg_catalog'])).length===1 && after.functionAttributes.some(f=>f.proname===n && f.result==='boolean' && f.provolatile==='i')), 'Unexpected helper metadata');
  requireGate(newFunctions.every(n=>after.functions.filter(f=>f.proname===n && f.owner===principal && !f.prosecdef && (equal(f.proconfig,['search_path=public, pg_catalog']) || equal(f.proconfig,['search_path=pg_catalog, public']))).length===1),'Unexpected new invoker metadata');
  requireGate(after.relations.some(r=>r.relname===journal && r.relkind==='r' && r.owner===principal) && after.triggers.filter(r=>r.table_name===journal).length===1 && after.triggers.some(r=>r.table_name===journal && r.tgname==='r3_override_immutable' && r.tgenabled==='O'),'Unexpected journal ownership/trigger');
  requireGate(after.columns.some(c=>c.table_name==='package_catalog' && c.column_name==='bonus_points' && c.type==='integer' && c.not_null && c.default_expr==='0' && !c.attacl) && after.columns.some(c=>c.table_name==='package_catalog_public' && c.column_name==='bonusPoints' && c.type==='integer' && !c.attacl),'Unexpected bonus column metadata');
  requireGate(after.constraints.some(c=>c.table_name==='package_payment_orders' && c.conname==='package_payment_orders_points_formula_check' && c.definition.includes('bonusPoints')) && after.constraints.some(c=>c.table_name==='package_catalog' && c.conname==='package_catalog_bonus_points_check' && c.definition.includes('1000000')),'Unexpected bonus checks');
  const checks = after.constraints.filter(c=>checkNames.includes(c.conname));
  requireGate(checks.length===3 && checks.some(c=>c.conname===checkNames[0] && c.definition==='CHECK ((id > 0))') && checks.some(c=>c.conname===checkNames[1] && c.definition==='CHECK (package_catalog_daily_slot_valid(time_slot))') && checks.some(c=>c.conname===checkNames[2] && c.definition.includes("'create'::text") && c.definition.includes("'update'::text")), 'Unexpected R3 constraints');
}
const inspect = db => ({...nativeCatalog(db),...Object.fromEntries(Object.entries(extras).map(([k,q])=>[k,db.query(`SELECT coalesce(json_agg(t),'[]'::json)::text FROM (${q}) t;`)]))});
const settings = principal => `SET LOCAL ROLE ${quote(principal)}; SET LOCAL search_path=public,pg_catalog; SET LOCAL TIME ZONE 'UTC'; SET LOCAL row_security=off; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='5s';`;

function captureLocalRows(db,names) {
  return Object.fromEntries(names.map(n => [n,db.query(`SELECT json_build_object('row_count',count(*)::text,'rows',coalesce(json_agg(t),'[]'::json)::text)::text FROM public.${quote(n)} t;`)]));
}

const code = v => literal(`BLU-98765432100${v}`);
const token = name => literal(`r3-local-only-${name}`);
const card = literal('CARD-987654321900001');
const station = literal('r3-local-kiosk');
const key = () => literal(randomUUID());
const target = `(SELECT id FROM public.members WHERE member_code=${code(3)})`;
const cardCall = (uuid, kiosk, name) => `public.member_card_admit(${token(kiosk?'kiosk':'owner')},${kiosk?station:literal(name)},${uuid},${card},${kiosk?'NULL':"'IN'"})`;
const fixedClock = (defs,clock) => defs.map(def => {
  requireGate(def.split('t:=clock_timestamp();').length===2,'Unexpected checkin clock assignment');
  return def.replace('t:=clock_timestamp();',`t:=((clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date+time '${clock}') AT TIME ZONE 'Asia/Bangkok';`)+';';
}).join('\n');
const checkinDefs = db => nativeCatalog(db).functions.filter(f=>['kiosk_checkin','real_frontdesk_checkin'].includes(f.proname)).map(f=>f.definition);
const assertSql = (cond,tag) => `DO $test$ BEGIN IF (${cond}) IS DISTINCT FROM true THEN RAISE EXCEPTION 'R3 compatibility check' USING ERRCODE='${tag}'; END IF; END $test$;`;

function prepareCompatibility(db,principal) {
  const defs = checkinDefs(db);
  const kioskKey = key(), deskKey = key(), pendingKey = key(), pendingId = key(), paidId = key(), attempt = key();
  const pkg = `(SELECT jsonb_build_object('package',jsonb_build_object('id',id,'catalogVersion',version)) FROM public.package_catalog WHERE is_active AND time_slot='07:00-14:00' ORDER BY id LIMIT 1)`;
  const receiver = `'{"promptpay":"0890000000","bankCode":"002","bankAccount":"1234567890","name":"SYNTHETIC"}'::jsonb`;
  const createOrder = (id,k,quote) => `public.create_catalog_package_payment_order(${id},${target},${token('customer')},${k},${quote},${receiver})`;
  db.run(`BEGIN; ${settings(principal)}
    INSERT INTO public.members(member_code,phone,full_name,status,role,expire_date) VALUES
      (${code(1)},'0009876501','R3 SYNTHETIC','ACTIVE','OWNER',NULL),(${code(2)},'0009876502','R3 SYNTHETIC','ACTIVE','ADMIN',NULL),(${code(3)},'0009876503','R3 SYNTHETIC','EXPIRED','MEMBER',NULL);
    INSERT INTO public.auth_sessions(member_id,token_hash,expires_at,mode,device_id) VALUES
      ((SELECT id FROM public.members WHERE member_code=${code(1)}),${token('owner')},now()+interval '1 day','NORMAL',NULL),
      ((SELECT id FROM public.members WHERE member_code=${code(2)}),${token('kiosk')},now()+interval '1 day','KIOSK',${station}),
      (${target},${token('customer')},now()+interval '1 day','NORMAL',NULL);
    SELECT public.member_card_update(${token('owner')},${key()},jsonb_build_object('memberCode',${code(3)},'cardCode',${card},'expectedVersion',0,'reason','Local synthetic fixture'));
    SELECT id FROM ${createOrder(paidId,key(),pkg)};

    SELECT * FROM public.claim_package_payment_attempt(${paidId},${target},${token('customer')},${attempt},repeat('a',64),false);
    UPDATE public.package_payment_attempts SET state='VERIFIED',evidence=(SELECT jsonb_build_object('transRef',${key()}::text,'paidAt',now(),'amountSatang',amount_satang,'bankCode','002','receiverEvidence','REGISTERED_ACCOUNT_V2','providerStrategy','EASYSLIP_V2_REGISTERED_ACCOUNT','orderId',id,'receiverIdentity',jsonb_build_object('matchingType','BANK_ACCOUNT','bankCode','002','bankAccount','1234567890','name','SYNTHETIC','expectedName','SYNTHETIC','normalizedName','SYNTHETIC')) FROM public.package_payment_orders WHERE id=${paidId}) WHERE id=${attempt};
    ${assertSql(`(SELECT status='PAID' FROM public.finalize_package_payment(${paidId},${target},${token('customer')},${attempt}))`,'RA301')}
    SELECT id FROM ${createOrder(pendingId,pendingKey,pkg)};
    ${fixedClock(defs,'10:00')}
    ${assertSql(`${cardCall(kioskKey,true)}->>'reason'='PAID_ENTRY'`,'RA302')}
    ${assertSql(`${cardCall(deskKey,false,'r3-local-pre-desk')}->>'reason'='PAID_ENTRY'`,'RA303')}
    ${defs.map(d=>d+';').join('\n')} COMMIT;`);
  return {kioskKey,deskKey,pendingKey,pendingId,createOrder};
}

function checkCompatibility(db,principal,{kioskKey,deskKey,pendingKey,pendingId,createOrder}) {
  const defs = checkinDefs(db);
  const pendingQuote = `(SELECT jsonb_build_object('package',package_snapshot) FROM public.package_payment_orders WHERE id=${pendingId})`;
  const kioskReplay = cardCall(kioskKey,true);
  const deskReplay = cardCall(deskKey,false,'r3-local-pre-desk');
  db.run(`BEGIN; ${settings(principal)}
    ${assertSql(`public.member_card_read(${token('owner')},${code(3)})=jsonb_build_object('cardCode',${card},'version',1)`,'RA304')}
    ${assertSql(`jsonb_typeof(public.package_catalog_action(${token('owner')},'list',NULL,'{}'))='array' AND EXISTS (SELECT 1 FROM public.package_catalog_public WHERE "timeSlot"='07:00-14:00' AND "catalogVersion">0)`,'RA305')}
    ${assertSql(`(SELECT id=${pendingId} AND status='PENDING' FROM ${createOrder(key(),pendingKey,pendingQuote)})`,'RA306')}
    ${assertSql(`${kioskReplay}=(SELECT result FROM public.member_card_scan_requests WHERE request_key=${kioskKey}) AND ${deskReplay}=(SELECT result FROM public.member_card_scan_requests WHERE request_key=${deskKey})`,'RA307')}
    ${fixedClock(defs,'10:00')}
    -- The old kiosk and frontdesk signatures and the CARD adapter still resolve legacy paid snapshots.
    DELETE FROM public.kiosk_member_bounce WHERE member_id=${target};
    ${assertSql(`${cardCall(key(),true)}->>'reason'='PAID_ENTRY'`,'RA308')}
    ${assertSql(`${cardCall(key(),false,'r3-local-post-desk')} @> '{"ok":true,"reason":"PAID_ENTRY","outSupported":false}'`,'RA309')}
    ${assertSql(`public.kiosk_checkin(${token('kiosk')},${station},${key()},${code(3)})->>'reason'='BOUNCE'`,'RA310')}
    ${assertSql(`public.real_frontdesk_checkin(${token('owner')},'r3-local-direct',${key()},${code(3)})->>'reason'='PAID_ENTRY'`,'RA311')}
    ${fixedClock(defs,'14:00')}
    ${assertSql(`${cardCall(key(),false,'r3-local-close')}->>'reason'='PAID_ENTRY' AND public.package_catalog_slot_allows('00:00-24:00',time '00:00') AND NOT public.package_catalog_slot_allows('00:00-24:00',time '24:00')`,'RA312')}
    ${fixedClock(defs,'22:01')}
    ${assertSql(`${cardCall(key(),false,'r3-local-closed')}->>'reason'='CLOSED'`,'RA318')}
    ${assertSql(`(SELECT public.package_catalog_action(${token('owner')},'update',${key()},jsonb_build_object('id',id,'expectedVersion',version,'name','R3 synthetic local update'))->>'catalogVersion'=(version+1)::text FROM public.package_catalog ORDER BY id LIMIT 1)`,'RA313')}
    ${assertSql(`(public.package_catalog_action(${token('owner')},'create',${key()},'{"name":"R3 synthetic zero","label":"R3 synthetic","description":"Local","priceSatang":15000,"durationDays":1,"timeSlot":"00:00-24:00","friendCoupons":0,"bonusDays":0,"isActive":false}')->>'bonusPoints')::integer=0`,'RA314')}
    ${defs.map(d=>d+';').join('\n')}
    DO $functional$
    DECLARE p jsonb; action_key uuid:=gen_random_uuid(); response jsonb; package jsonb; o package_payment_orders;
    BEGIN
      p:=jsonb_build_object('memberCode',${code(3)},'expectedVersion',0,'timeSlot','00:00-24:00','reason','Local synthetic',
        'expectedOrderId',(SELECT id FROM package_payment_orders WHERE member_id=${target} AND status='PAID'));
      response:=public.r3_override_write(${token('owner')},action_key,p);
      IF response->>'version' IS DISTINCT FROM '1' OR public.r3_override_write(${token('owner')},action_key,p) IS DISTINCT FROM response
        OR public.r3_override_read(${token('owner')},${code(3)})->'entitlement'->>'overrideSlot' IS DISTINCT FROM '00:00-24:00'
        OR public.r3_override_slot(${target},clock_timestamp()) IS DISTINCT FROM '00:00-24:00'
        OR public.member_card_admit(${token('owner')},'r3-override-fresh',gen_random_uuid(),${card},'IN')->>'reason' IS DISTINCT FROM 'PAID_ENTRY'
        THEN RAISE EXCEPTION 'Override gate' USING ERRCODE='RA315'; END IF;
      response:=public.r3_override_write(${token('owner')},gen_random_uuid(),p||'{"timeSlot":null,"expectedVersion":1}');
      IF response->>'version' IS DISTINCT FROM '2' OR public.r3_override_slot(${target},clock_timestamp()) IS NOT NULL THEN RAISE EXCEPTION 'Override clear gate' USING ERRCODE='RA316'; END IF;
      package:=public.package_catalog_action(${token('owner')},'create',gen_random_uuid(),'{"name":"R3 synthetic bonus","label":"Local","description":"Local","priceSatang":15000,"durationDays":1,"timeSlot":"00:00-24:00","friendCoupons":0,"bonusDays":0,"bonusPoints":17,"isActive":true}');
      SELECT * INTO o FROM public.create_catalog_package_payment_order(gen_random_uuid(),(SELECT id FROM members WHERE member_code=${code(1)}),${token('owner')},gen_random_uuid(),jsonb_build_object('package',package),'{"promptpay":"0890000000","bankCode":"002","bankAccount":"1234567890","name":"SYNTHETIC"}');
      IF o.package_snapshot->'r3HalfOpenTimeSlot' IS DISTINCT FROM 'true'::jsonb OR o.package_snapshot->'bonusPoints' IS DISTINCT FROM '17'::jsonb OR o.points_earned IS DISTINCT FROM o.amount_satang/2000+17 THEN RAISE EXCEPTION 'Bonus formula gate' USING ERRCODE='RA317'; END IF;
    END $functional$;
    ROLLBACK;`);
}

const shaSql = expr => `pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(${expr},'UTF8')),'hex')`;
const dataSql = (name,columns) => {
  const source=columns ? `(SELECT ${columns.map(quote).join(',')} FROM public.${quote(name)})` : `public.${quote(name)}`;
  return `SELECT count(*)::text AS row_count,coalesce(json_agg(t ORDER BY row_to_json(t)::text COLLATE "C"),'[]'::json)::text AS rows FROM ${source} t`;
};
const catalogGuardKeys = Object.keys(metadataQueries).filter(k=>k!=='identity');
const normalizedCatalogSql = key => {
  const omit=['oid','datacl','relacl','proacl','nspacl','defaclacl','last_value'].map(literal).join(',');
  return `SELECT ${shaSql(`coalesce(jsonb_agg(to_jsonb(t)-ARRAY[${omit}]),'[]'::jsonb)::text`)} FROM (${metadataQueries[key]}) t`;
};
const fingerprints = db => Object.fromEntries(catalogGuardKeys.map(k=>[k,db.query(`SELECT to_json((${normalizedCatalogSql(k)}));`)]));
const safetySettings = ["SET LOCAL statement_timeout='30s'","SET LOCAL lock_timeout='5s'","SET LOCAL transaction_timeout='90s'","SET LOCAL search_path=public,pg_catalog","SET LOCAL TIME ZONE 'UTC'","SET LOCAL row_security=off"];
const ddlStatements = plan => plan.flatMap(m=>m.statements);
const locked = b => ['SELECT pg_advisory_xact_lock(18261118,20)',`LOCK TABLE ${Object.keys(b.tables).map(n=>`public.${quote(n)}`).join(',')} IN SHARE MODE`];
const identityCondition = b => `current_database()=${literal(b.identity[0].database)} AND current_user=${literal(b.identity[0].principal)} AND current_setting('server_version_num')=${literal(b.identity[0].version)}`;
const tableChecks = (b,post) => Object.entries(b.tables).map(([name,t])=>{
  requireGate(/^[a-f0-9]{64}$/.test(t.fingerprint) && /^\d+$/.test(t.row_count),'Invalid captured table checksum');
  const columns=post && name==='package_catalog' ? b.columns.filter(c=>c.table_name===name).map(c=>c.column_name) : undefined;
  return `(SELECT row_count=${literal(t.row_count)} AND ${shaSql('rows')}=${literal(t.fingerprint)} FROM (${dataSql(name,columns)}) r)`;
});
const stateChecks = b => Object.entries(b.sequenceState).map(([name,s])=>{
  requireGate(/^\d+$/.test(s.last_value) && typeof s.is_called==='boolean','Invalid captured sequence state');
  return `(SELECT last_value::text=${literal(s.last_value)} AND is_called=${s.is_called} FROM public.${quote(name)})`;
});
const newEmpty = `NOT EXISTS (SELECT FROM public.${journal}) AND NOT EXISTS (SELECT FROM public.package_catalog WHERE bonus_points IS DISTINCT FROM 0)`;
export function guardedChecks(b,catalog,post) {
  const catalogChecks=catalogGuardKeys.map(k=>{
    requireGate(/^[a-f0-9]{64}$/.test(catalog[k]),'Invalid catalog checksum');
    return assertSql(`(${normalizedCatalogSql(k)})=${literal(catalog[k])}`,post?'RB305':'RB301');
  });
  return [...catalogChecks,...tableChecks(b,post).map(c=>assertSql(c,post?'RB306':'RB302')),
    ...stateChecks(b).map(c=>assertSql(c,post?'RB307':'RB303')),
    ...(post?[assertSql(newEmpty,'RB308'),assertSql(`((${aclGate(b.identity[0].principal).trimEnd().replace(/;$/,'')})::text)::boolean`,'RB309')]:[])];
}

async function rehearse(dir,b,report,stage) {
  stage('historical-drift-reference');
  const old = readHistorical();
  const principal = b.identity[0].principal;
  requireGate(old.identity[0].principal===principal && old.identity[0].database===b.identity[0].database, 'Historical target differs');
  report.historicalCatalogDrift = historicalDelta(old,b);
  requireGate(!report.historicalCatalogDrift.length, 'Historical baseline drift outside installed password schema');
  stage('backup-integrity');
  const baseline = b;
  const {tables,sequenceState}=baseline;
  reconcileExisting(baseline);
  stage('native-recovery');
  let db;
  try {
    const restore = recoverySql(baseline);
    db = await nativeDatabase(dir,b.roles.find(r=>r.rolsuper).rolname);
    report.nativeVersion = db.query("SELECT to_json(current_setting('server_version_num'));");
    requireGate(/^18\d{4}$/.test(report.nativeVersion), 'Unsupported native engine');
    db.run(restore);
    const before = inspect(db);
    const expected = driftCatalog(b), recovered = driftCatalog(before);
    report.recoveryCatalogDifferences = Object.keys(expected).filter(k=>!equal(expected[k],recovered[k]));
    requireGate(!report.recoveryCatalogDifferences.length && equal(b.eventTriggers,before.eventTriggers) && equal(b.functionAttributes,before.functionAttributes),'Native catalog recovery mismatch');
    const verifyData = (saved=tables, seq=sequenceState) => {
      verifyRows(db,saved);
      requireGate(equal(seq,sequenceStates(db,b.sequences)), 'Sequence state changed');
    };
    verifyData();
    report.recovery = {freshProductionTables:Object.keys(tables).length,sequences:Object.keys(sequenceState).length,catalogSections:Object.keys(expected).length+2};
        stage('native-data-prerequisites');
        requireGate(db.query(`SELECT to_json(NOT EXISTS (SELECT FROM public.package_payment_orders WHERE package_snapshot ?| ARRAY['bonusPoints','r3HalfOpenTimeSlot']));`),'Reserved metadata is already present in historical snapshots');
        requireGate(db.query(`SELECT to_json(count(*)=1) FROM pg_constraint WHERE conrelid='public.package_payment_orders'::regclass AND contype='c' AND convalidated AND pg_get_expr(conbin,conrelid)='(points_earned = (amount_satang / 2000))';`),'Unexpected historical points formula');
    stage('native-guarded-rollback');
    const plan=migrationPlan();
    const initial=fingerprints(db);
    const prefix=[`SET LOCAL ROLE ${quote(principal)}`,...safetySettings,...locked(b)];
    const nativeBatch=(statements,end)=>db.run(['BEGIN',...statements,end].join(';\n')+';');
    nativeBatch([...prefix,...guardedChecks(b,initial,false),...ddlStatements(plan)],'ROLLBACK');
    requireGate(equal(initial,fingerprints(db)), 'Guarded rollback catalog changed');
    verifyData();
    // Capture the exact post-DDL fingerprints on an untouched restored dataset, then
    // test the full production transaction and both sets of guards with rollback.
    stage('native-exact-guard-rehearsal');
    const expectedAfter=JSON.parse(db.run(['BEGIN',...prefix,...ddlStatements(plan),
      `SELECT json_build_array(${catalogGuardKeys.map(k=>`(${normalizedCatalogSql(k)})`).join(',')})::text`,'ROLLBACK'].join(';\n')+';').trim());
    const after=Object.fromEntries(catalogGuardKeys.map((k,i)=>[k,expectedAfter[i]]));
    nativeBatch([...prefix,...guardedChecks(b,initial,false),...ddlStatements(plan),...guardedChecks(b,after,true)],'ROLLBACK');
    verifyData();
    report.productionGuardsRehearsed=true;
    stage('existing-card-fixtures');
    const fixture = prepareCompatibility(db,principal);
    const fixtureTables = captureLocalRows(db,Object.keys(tables));
    const fixtureSeq = sequenceStates(db,b.sequences);
    const batch = `BEGIN; ${settings(principal)} ${migrationPlan().flatMap(m=>m.statements).join(';\n')};`;
    stage('native-rollback');
    db.run(`${batch} ROLLBACK;`);
    const rollback = inspect(db);
    requireGate(equal(driftCatalog(before),driftCatalog(rollback)) && equal(before.functionAttributes,rollback.functionAttributes) && equal(before.eventTriggers,rollback.eventTriggers), 'Rollback changed catalog');
    verifyData(fixtureTables,fixtureSeq);
    stage('native-local-commit');
    db.run(`${batch} COMMIT;`);
    verifyR3Delta(before,inspect(db),principal,report);
    requireGate(equal(after,fingerprints(db)),'Local commit catalog differs from guarded trial');
    const oldProjection = n => n==='package_catalog' ? b.columns.filter(c=>c.table_name===n).map(c=>c.column_name) : undefined;
    verifyRows(db,fixtureTables,oldProjection);
    requireGate(equal(fixtureSeq,sequenceStates(db,b.sequences)), 'Sequence state changed on commit');
    requireGate(db.query(`SELECT to_json(NOT EXISTS (SELECT FROM public.package_catalog WHERE bonus_points IS DISTINCT FROM 0) AND NOT EXISTS (SELECT FROM public.${journal}));`),'Unexpected new field/journal contents');
    report.rehearsal = {rollbackVerified:true,localCommitVerified:true,rowsAndSequencesPreserved:true};
    stage('native-acl');
    requireGate(db.query(aclGate(principal)), 'Function ACL/role compatibility');
    report.rehearsal.aclVerified = true;
    stage('old-app-and-card');
    checkCompatibility(db,principal,fixture);
    report.rehearsal.oldAppAndExistingCardVerified = true;
    return {initial,after,plan};
  } finally {
    if (db) {
      db.close();
      report.nativeStopped = true;
      for (const file of ['native-data','native-server.log','pg_ctl.log']) fs.rmSync(path.join(dir,file),{force:true,recursive:true,maxRetries:3});
    }
  }
}

async function main(args) {
  const report = { productionWrites: false, productionRowsRead: false, commitOutcome:'not-attempted' };
  let stage = 'mode', dir;
  try {
    if (args.length !== 1 || !['--metadata','--rehearse','--apply-r3-schema'].includes(args[0])) throw new Error('Usage: --metadata, --rehearse or --apply-r3-schema');
    stage = 'source'; migrationPlan();
    stage = 'target';
    const { DATABASE_URL: url } = dotenv.parse(fs.readFileSync(path.join(root,'.env.local')));
    if (!url || (process.env.DATABASE_URL && process.env.DATABASE_URL !== url)) throw new Error('Expected configured production, no overrides');
    stage = 'metadata';
    const sql = neon(url);
    const b = await captureMetadata(sql);
    report.productionVersion = b.identity[0].version;
    report.readOnlyRepeatableRead = true;
    report.migrationChecksums = inventory;
    report.prerequisiteIssues = prerequisiteIssues(b);
    report.productionTables = b.relations.filter(r => r.relkind === 'r').length;
    stage = 'protected-directory';
    dir = protectedPasswordDirectory('r3-rehearsal-');
    report.artifacts = path.relative(root,dir);
    stage = 'metadata-backup';
    const text = JSON.stringify(b);
    save(path.join(dir,'metadata.json'),text);
    const files={'metadata.json':digest(text)};
    stage = 'prerequisites';
    if (report.prerequisiteIssues.length) throw new Error('Prerequisite drift');
    if (args[0] !== '--metadata') {
      stage='fresh-read-only-backup';
      report.productionRowsRead = true;
      const fresh = await captureMetadata(sql,b);
      const snapshot = JSON.stringify(fresh);
      const file=path.join(dir,'snapshot.json');
      save(file,snapshot);
      files['snapshot.json']=digest(snapshot);
      save(path.join(dir,'manifest.json'),JSON.stringify({files}));
      stage='snapshot-checksum';
      const saved=fs.readFileSync(file,'utf8');
      requireGate(digest(saved)===JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')).files['snapshot.json'],'Snapshot checksum mismatch');
      report.snapshotChecksum=files['snapshot.json'];
      const baseline=JSON.parse(saved);
      const recovered=await rehearse(dir,baseline,report,next => {stage=next;});
      if (args[0]==='--apply-r3-schema') {
        stage='production-transaction-preparation';
        requireGate(equal(recovered.plan,migrationPlan()),'Pinned migration bytes changed since recovery');
        const pre=[...safetySettings,...locked(baseline),assertSql(identityCondition(baseline),'RB300'),...guardedChecks(baseline,recovered.initial,false)];
        const post=guardedChecks(baseline,recovered.after,true);
        const tx=[...pre,...ddlStatements(recovered.plan),...post].map(text=>sql.query(text));
        save(path.join(dir,'transaction-intent.json'),JSON.stringify({status:'reconcile read-only if outcome is unknown',migrations:inventory,backup:report.snapshotChecksum}));
        stage='production-transaction';
        report.commitOutcome='unknown';
        await sql.transaction(tx,{isolationLevel:'ReadCommitted'});
        report.commitOutcome='committed';
        report.productionWrites=true;
        report.applied=recovered.plan.map(m=>m.file);
        stage='production-read-only-postflight';
        const audit=neon(url);
        await audit.transaction([...safetySettings,assertSql(`${identityCondition(baseline)} AND current_setting('transaction_read_only')='on'`,'RB300'),...post].map(text=>audit.query(text)),{readOnly:true,isolationLevel:'RepeatableRead'});
        report.postflight={readOnly:true,oldTables:Object.keys(baseline.tables).length,sequences:Object.keys(baseline.sequenceState).length,catalogSections:catalogGuardKeys.length};
      }
    } else save(path.join(dir,'manifest.json'),JSON.stringify({files}));
    report.outcome = 'VERIFIED';
  } catch (e) {
    report.outcome = 'BLOCKED'; report.stage = stage;
    if (e instanceof RolloutGateError) report.gate = e.message;
    if (/^[0-9A-Z]{5}$/.test(e?.code ?? '')) report.code = e.code;
    process.exitCode = 1;
  } finally {
    if (dir) try { save(path.join(dir,'report.json'),JSON.stringify(report,null,2)); } catch { report.reportWriteFailed = true; process.exitCode = 1; }
    console.log(JSON.stringify(report,null,2));
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));
