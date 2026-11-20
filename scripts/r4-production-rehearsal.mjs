import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual as equal } from 'node:util';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { digest, quote, root, save } from './db-safety.mjs';
import { splitSql } from './db-payments-sql.mjs';
import { captureMetadata, metadataQueries } from './r3-production-rehearsal.mjs';
import { driftCatalog, nativeDatabase, protectedPasswordDirectory, recoverySql, reconcileExisting, verifyRows, sequenceStates } from './r2-production-rollout.mjs';

export const inventory = {
  '20261118_R4_online_provenance.sql': 'c019f04c1bb249f312c6516229df7601bfa2f21852b0a25d92b7a3aa0efb14c0',
  '20261119_R4_staff_free_foundation.sql': '59061043ed4531ee08fce1fd60b0fa7b11afc804c63d26ee11694f3a86ed86ed',
  '20261119_R4_staff_free_admission.sql': '16779c4ee5489a35d4f9f8acd08350cbed515f0cb2314faa96c9175b706f55a9',
  '20261119_R4_staff_free_finance.sql': 'e00881f732d2b0df69ce10a37993fb70236bbcc97fadf9347b0bd2d799506388',
  '20261119_R4_staff_free_writer.sql': 'a37cdb704764ba1edd0d1220e12a8fa14d8b1c3519366d2dfccb9ac451cb8609',
  '20261120_R4_staff_free_display.sql': 'c3dc485076b20db2fc85d416c7585fbb61a335b7fe58487e30ad80817e369f18',
  '20261120_R4_staff_free_z_cancellation.sql': '18e7178ce365b595a72989574fd078445f838c00f6177ca1138dbf28b175fc0c',
  '20261121_R4_staff_free_purchase_guard.sql': 'dd9444f1eddabddcf5451c5caea28e243a7787804a130e9cb29a9f8cea940e70',
  '20261122_R4_staff_paid_transfer.sql': 'adb28392ca2cb42500e3b5cee8b9ef7ed4d93583aa35e1249b3b8c0d5023dd42',
  '20261123_R4_staff_paid_cancellation.sql': 'e2b0df338a1a8c9bb9f61150bd83f692bcf76fa7dc6bfe2f5028d94a0c41d5cd',
  '20261124_R4_online_settlement_evidence.sql': '3f4f333c8bdd2fd0b61d02e4ef4aabef79c569bf80d3eedc2b41869a9da2650b',
  '20261125_R4_online_cancellation.sql': 'b3b336a970453c74835f540eee054551e923b65a320f02664e069b36e9f486ef',
};

class Gate extends Error {}
const guard = (condition, reason) => { if (!condition) throw new Gate(reason); };
const lit = value => `'${value.replaceAll("'", "''")}'`;
const migrationDir = path.join(root, 'src/db/migrations');
export function migrationPlan(read = name => fs.readFileSync(path.join(migrationDir, name), 'utf8')) {
  const files = fs.readdirSync(migrationDir).filter(f => /_r4_.*\.sql$/i.test(f)).sort();
  guard(equal(files, Object.keys(inventory).sort()), 'R4 migration inventory differs');
  return Object.entries(inventory).map(([file, checksum]) => {
    const text = read(file);
    guard(digest(text) === checksum, `Unreviewed migration: ${file}`);
    // Like the native Python harness, execute LF text; literal upgrade anchors
    // are compared against LF-normalized installed function definitions.
    const statements = splitSql(text.replaceAll('\r\n','\n'));
    guard(statements.shift() === 'BEGIN' && statements.pop() === 'COMMIT', `Invalid wrapper: ${file}`);
    return { file, statements, text };
  });
}

const finalizer = 'public.finalize_package_payment(uuid,integer,text,uuid)';
const newTables = ['public.entitlement_online_observations', ...['free_sales', 'free_sale_cancellations', 'paid_transfer_cancellations'].map(n => `r4_staff_private.${n}`), ...['settlement_before', 'settlement_effects', 'cancellations', 'reader_cutover'].map(n => `r4_online_private.${n}`)];
const privateSchemas = "('r4_staff_private','r4_online_private')";
const inspect = db => db.query(`SELECT json_build_object(${Object.entries(metadataQueries).filter(([k]) => k !== 'identity').map(([k,q]) => `${lit(k)},(SELECT coalesce(json_agg(t),'[]') FROM (${q}) t)`).join(',')});`);
const catalog = b => ({ ...driftCatalog(b), eventTriggers:b.eventTriggers, functionAttributes:b.functionAttributes });
const normalized = text => text.replaceAll('\r\n','\n');

// PostgreSQL 18.4 deparses this left-nested AND chain flat. Pin both full
// definitions; do not normalize general constraint differences or skip validation.
function pointsConstraintDefinitions() {
  const start = 'CHECK (\nCASE\n';
  const first = "    WHEN (NOT (package_snapshot ? 'bonusPoints'::text)) THEN (points_earned = (amount_satang / 2000))\n";
  const second = "    WHEN ((jsonb_typeof((package_snapshot -> 'bonusPoints'::text)) = 'number'::text) AND ((package_snapshot ->> 'bonusPoints'::text) ~ '^(0|[1-9][0-9]{0,6})$'::text)) THEN ";
  const lower = "(((package_snapshot ->> 'bonusPoints'::text))::integer >= 0)";
  const upper = "(((package_snapshot ->> 'bonusPoints'::text))::integer <= 1000000)";
  const formula = "(points_earned = ((amount_satang / 2000) + ((package_snapshot ->> 'bonusPoints'::text))::integer))";
  const expression = test => start + first + second + test + '\n    ELSE false\nEND)';
  const prod = expression(`((${lower} AND ${upper}) AND ${formula})`);
  const native = expression(`(${lower} AND ${upper} AND ${formula})`);
  return {prod,native};
}
const pointsConstraint = {table_name:'package_payment_orders',conname:'package_payment_orders_points_formula_check',contype:'c'};
export function recoveryCatalogDifferences(stored, recovered, nativeVersion) {
  const expected = catalog(stored), actual = catalog(recovered);
  const {prod,native} = pointsConstraintDefinitions();
  if (stored.identity[0].version === '180007' && nativeVersion === '180004') {
    expected.constraints = expected.constraints.map(r => equal(r,{...pointsConstraint,definition:prod}) ? {...r,definition:native} : r);
  }
  return Object.keys(expected).filter(k=>!equal(expected[k],actual[k]));
}
function finalizerExpected(before, migration) {
  let expected = normalized(before);
  for (const [key, anchor, prepend] of [
    ['pre_hook', ' UPDATE members SET expire_date=expiry,status=CASE', true],
    ['post_hook', 'trans_ref=ref,verification_snapshot=a.evidence WHERE id=p_order RETURNING *;', false],
  ]) {
    const hook = normalized(migration).match(new RegExp(`${key} constant text := \\$hook\\$([\\s\\S]*?)\\$hook\\$;`))?.[1];
    guard(hook && expected.split(anchor).length === 2, 'Unexpected finalizer hook anchors');
    expected = expected.replace(anchor, () => prepend ? hook + anchor : anchor + hook);
  }
  return expected;
}

// Check grants even when an object is unreachable through schema USAGE.
const acl = `WITH obj(kind,oid,owner,acl) AS (
  SELECT 'n'::"char",oid,nspowner,nspacl FROM pg_namespace WHERE nspname IN ${privateSchemas}
  UNION ALL SELECT 'r',c.oid,c.relowner,c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname IN ${privateSchemas} AND c.relkind IN ('r','v')) OR (n.nspname='public' AND c.relname='entitlement_online_observations')
  UNION ALL SELECT 'f',p.oid,p.proowner,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ${privateSchemas} OR (n.nspname='public' AND p.proname IN ('entitlement_observe_online_paid','entitlement_observation_immutable'))
), rights AS (
  SELECT obj.*,r.oid AS role,r.rolsuper,pg_has_role(r.oid,owner,'USAGE') AS inherits_owner,
    CASE kind WHEN 'n' THEN has_schema_privilege(r.oid,obj.oid,'USAGE,CREATE')
      WHEN 'f' THEN has_function_privilege(r.oid,obj.oid,'EXECUTE')
      ELSE has_table_privilege(r.oid,obj.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') END AS any_access
  FROM obj CROSS JOIN pg_roles r
)
SELECT json_build_object(
  'principalMatches',bool_and(owner=current_user::regrole),
  'objects',count(*),
  'nonOwnerGrants',(SELECT count(*) FROM obj o CROSS JOIN LATERAL aclexplode(coalesce(o.acl,acldefault(o.kind,o.owner))) a WHERE a.grantee<>o.owner),
  'unexpectedEffective',(SELECT count(*) FROM rights WHERE NOT rolsuper AND NOT inherits_owner AND any_access AND NOT (
    (kind IN ('n','r') AND (pg_has_role(role,'pg_read_all_data','USAGE') OR pg_has_role(role,'pg_write_all_data','USAGE')))
    OR (kind='r' AND pg_has_role(role,'pg_maintain','USAGE')))),
  'builtinEffectiveRoles',(SELECT count(DISTINCT role) FROM rights WHERE NOT rolsuper AND NOT inherits_owner AND any_access),
  'principalMissing',(SELECT count(*) FROM rights WHERE role=current_user::regrole AND NOT any_access)
) FROM obj;`;

const assertions = condition => `DO $gate$ BEGIN IF (${condition}) IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='RB401', MESSAGE='R4 rehearsal guard failed'; END IF; END $gate$`;
const rowGuards = (b, includeSequences = true) => [
  ...Object.entries(b.tables).map(([n,t]) => assertions(`(SELECT count(*)::text=${lit(t.row_count)} AND encode(sha256(convert_to(coalesce(json_agg(x ORDER BY row_to_json(x)::text COLLATE "C"),'[]')::text,'UTF8')),'hex')=${lit(t.fingerprint)} FROM public.${quote(n)} x)`)),
  ...(includeSequences ? Object.entries(b.sequenceState).map(([n,s]) => assertions(`(SELECT last_value::text=${lit(s.last_value)} AND is_called=${s.is_called} FROM public.${quote(n)})`)) : []),
];
const emptyNew = assertions(newTables.map(n => `NOT EXISTS (SELECT FROM ${n})`).join(' AND '));
const history = assertions(`NOT EXISTS (SELECT * FROM public.package_payment_orders WHERE status='PAID' EXCEPT ALL SELECT * FROM r4_online_private.active_paid_orders) AND NOT EXISTS (SELECT * FROM r4_online_private.active_paid_orders EXCEPT ALL SELECT * FROM public.package_payment_orders WHERE status='PAID')`);
const ddl = plan => plan.flatMap(m => m.statements);
const settings = ["SET LOCAL statement_timeout='30s'","SET LOCAL lock_timeout='5s'","SET LOCAL transaction_timeout='90s'",'SET LOCAL search_path=public,pg_catalog',"SET LOCAL TIME ZONE 'UTC'",'SET LOCAL row_security=off'];
const lockTables = b => `LOCK TABLE ${Object.keys(b.tables).map(n=>`public.${quote(n)}`).join(',')} IN SHARE MODE`;
const advisoryLock = 'SELECT pg_advisory_xact_lock(18261118,20)'; // Same deployment lock as R3.
const stackGuard = 'SELECT r4_online_private.assert_cancellation_stack()';

// Use the R3 catalog inventory, including expanded ACLs, and repeat its scoped
// queries for the private schemas. OIDs are cluster-local; ACL array order is not
// semantic. Column ACLs have no expanded section, so keep those intact.
const stableCatalog = Object.fromEntries(Object.entries(metadataQueries).filter(([k])=>k!=='identity'));
const scoped = ['columns','relations','functions','constraints','triggers','policies','indexes','sequences','views','relationAcl','functionAcl','schemaAcl','unsupported','functionAttributes','enums'];
for (const schema of ['r4_staff_private','r4_online_private']) {
  for (const key of scoped) stableCatalog[`${schema}.${key}`] = metadataQueries[key]
    .replaceAll("'public'::regnamespace",`to_regnamespace(${lit(schema)})`).replaceAll("'public'",lit(schema));
}
const shaSql = expr => `encode(sha256(convert_to(${expr},'UTF8')),'hex')`;
export function catalogHashesSql(allowPointsRenderingPair) {
  const omit = "ARRAY['oid','datacl','relacl','proacl','nspacl','defaclacl','last_value']";
  return `SELECT json_build_array(${Object.entries(stableCatalog).map(([key,query])=>{
    let row = `(to_jsonb(t)-${omit})`;
    if (key==='constraints' && allowPointsRenderingPair) {
      const {prod,native} = pointsConstraintDefinitions();
      row = `CASE WHEN to_jsonb(t)=${lit(JSON.stringify({...pointsConstraint,definition:prod}))}::jsonb THEN ${lit(JSON.stringify({...pointsConstraint,definition:native}))}::jsonb ELSE ${row} END`;
    }
    return `(SELECT ${shaSql("coalesce(jsonb_agg(r ORDER BY r::text COLLATE \"C\"),'[]'::jsonb)::text")} FROM (SELECT ${row} AS r FROM (${query}) t) normalized)`;
  }).join(',')})`;
}
const assertCatalog = (catalogSql, hashes) => {
  guard(hashes.length===Object.keys(stableCatalog).length && hashes.every(h=>/^[0-9a-f]{64}$/.test(h)), 'Invalid catalog fingerprint inventory');
  return assertions(`(${catalogSql})::jsonb=${lit(JSON.stringify(hashes))}::jsonb`);
};
const assertAcl = expected => assertions(`(${acl.slice(0,-1)})::jsonb=${lit(JSON.stringify(expected))}::jsonb`);
const assertFinalizerOid = oid => {
  guard(/^\d+$/.test(String(oid)), 'Missing installed finalizer OID');
  return assertions(`${lit(finalizer)}::regprocedure::oid=${lit(String(oid))}::oid`);
};
const identityGuard = (b,readOnly) => {
  const {database,principal,version} = b.identity[0];
  return assertions(`current_database()=${lit(database)} AND current_user=${lit(principal)} AND session_user=current_user AND current_setting('server_version_num')=${lit(version)} AND current_setting('transaction_read_only')=${lit(readOnly?'on':'off')} AND current_setting('transaction_isolation')=${lit(readOnly?'repeatable read':'read committed')} AND current_setting('session_replication_role')='origin'`);
};
export function schemaBatches(b,plan,proof) {
  guard(equal(plan,migrationPlan()),'Pinned migration bytes changed since rehearsal');
  guard(proof && Array.isArray(proof.pre) && Array.isArray(proof.post) && proof.acl?.principalMatches && proof.acl.objects>0 && proof.acl.nonOwnerGrants===0 && proof.acl.unexpectedEffective===0 && proof.acl.principalMissing===0,'Complete rehearsal proof required');
  const catalogSql = catalogHashesSql(proof.allowPointsRenderingPair);
  const pre = [assertCatalog(catalogSql,proof.pre),...rowGuards(b)];
  const post = [assertCatalog(catalogSql,proof.post),...rowGuards(b),emptyNew,history,assertAcl(proof.acl)];
  const oid = assertFinalizerOid(b.functions.find(f=>f.proname==='finalize_package_payment')?.oid);
  return {
    apply:[...settings,identityGuard(b,false),advisoryLock,lockTables(b),...pre,oid,...ddl(plan),settings[3],...post,oid,stackGuard],
    // The runtime stack assertion requires Read Committed. Repeatable Read
    // postflight instead verifies its exact catalog and all persisted invariants.
    postflight:[...settings,identityGuard(b,true),...post,oid],
    pre,post,
  };
}
export async function executeSchemaBatches(connect,batches,report,advance) {
  const writer = connect();
  const statements = batches.apply.map(text=>writer.query(text));
  advance('production-schema-transaction');
  report.commitOutcome='unknown';
  await writer.transaction(statements,{isolationLevel:'ReadCommitted'});
  report.commitOutcome='committed';
  report.productionWrites=true;
  advance('production-read-only-postflight');
  const reader = connect();
  await reader.transaction(batches.postflight.map(text=>reader.query(text)),{readOnly:true,isolationLevel:'RepeatableRead'});
  report.postflight={readOnly:true,verified:true};
}

const applyMode = '--apply-r4-schema';
const runtimeConfirmation = '--confirm-runtime-ready';
const writerFlags = ['ENABLE_STAFF_FREE','ENABLE_STAFF_PAID_TRANSFER','ENABLE_STAFF_PAID_CANCELLATION','ENABLE_ONLINE_CANCELLATION'];
export function checkConfiguredWriters(config,env) {
  guard(writerFlags.every(k=>config[k]!=='true' && env[k]!=='true'),'Keep all configured R4 writer flags off for schema-only apply');
}

// Run only on the local clone. Synthetic evidence exercises the DB finalizer,
// not the bank/provider verification service. Roll back all fixture rows.
const settlementFixture = `DO $fixture$
DECLARE
 m integer; owner_id integer; uid uuid:=gen_random_uuid(); aid uuid:=gen_random_uuid();
 buyer text:=gen_random_uuid()::text; actor text:=gen_random_uuid()::text;
 req uuid:=gen_random_uuid(); amount integer; offer jsonb; snapshot jsonb; result jsonb;
BEGIN
 SELECT jsonb_build_object('package',jsonb_build_object('id',id,'catalogVersion',version)) INTO STRICT offer
 FROM public.package_catalog WHERE is_active AND friend_quota=0 AND bonus_days=0 ORDER BY id LIMIT 1;
 INSERT INTO public.members(id,member_code,phone,full_name,status,role) OVERRIDING SYSTEM VALUE VALUES
  (2147483601,'BLU-987654329001','0009876591','R4 SYNTHETIC','EXPIRED','MEMBER'),
  (2147483602,'BLU-987654329002','0009876592','R4 SYNTHETIC','ACTIVE','OWNER');
 m:=2147483601; owner_id:=2147483602;
 INSERT INTO public.auth_sessions(member_id,token_hash,expires_at,mode) VALUES
  (m,buyer,now()+interval '1 day','NORMAL'),(owner_id,actor,now()+interval '1 day','NORMAL');
 PERFORM public.create_catalog_package_payment_order(uid,m,buyer,gen_random_uuid(),offer,
  '{"promptpay":"0890000000","bankCode":"002","bankAccount":"1234567890","name":"SYNTHETIC"}');
 SELECT amount_satang INTO STRICT amount FROM public.package_payment_orders WHERE id=uid AND status='PENDING';
 PERFORM public.claim_package_payment_attempt(uid,m,buyer,aid,repeat('a',64),false);
 UPDATE public.package_payment_attempts SET state='VERIFIED',evidence=jsonb_build_object(
  'transRef',gen_random_uuid()::text,'paidAt',now(),'amountSatang',amount,'bankCode','002',
  'receiverEvidence','REGISTERED_ACCOUNT_V2','providerStrategy','EASYSLIP_V2_REGISTERED_ACCOUNT','orderId',uid,
  'receiverIdentity',jsonb_build_object('matchingType','BANK_ACCOUNT','bankCode','002','bankAccount','1234567890',
  'name','SYNTHETIC','expectedName','SYNTHETIC','normalizedName','SYNTHETIC')) WHERE id=aid;
 BEGIN
  PERFORM public.finalize_package_payment(uid,m,'missing-session',aid);
  RAISE EXCEPTION USING ERRCODE='RB402',MESSAGE='Expected unauthorized finalization';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Unauthorized' THEN RAISE; END IF;
 END;
 IF (SELECT status FROM public.finalize_package_payment(uid,m,buyer,aid)) IS DISTINCT FROM 'PAID' THEN
  RAISE EXCEPTION USING ERRCODE='RB403',MESSAGE='Expected PAID';
 END IF;
 SELECT to_jsonb(o) INTO STRICT snapshot FROM public.package_payment_orders o WHERE o.id=uid;
 IF (SELECT count(*) FROM r4_online_private.settlement_before b JOIN r4_online_private.settlement_effects e USING(order_id)
     JOIN public.entitlement_online_observations v ON v.order_id=b.order_id WHERE b.order_id=uid AND b.verified_attempt_id=aid)<>1
 OR r4_online_private.preview_online_cancellation(actor,uid)->>'blocker' IS DISTINCT FROM 'READERS_NOT_ENABLED' THEN
  RAISE EXCEPTION USING ERRCODE='RB404',MESSAGE='Expected one evidence chain and empty activation interlock';
 END IF;
 INSERT INTO r4_online_private.reader_cutover VALUES(1);
 result:=r4_online_private.cancel_online_order(actor,uid,req,amount,'Synthetic external refund',true);
 IF result->>'status' IS DISTINCT FROM 'CANCELLED'
 OR result IS DISTINCT FROM r4_online_private.cancel_online_order(actor,uid,req,amount,'Synthetic external refund',true)
 OR (SELECT status FROM public.finalize_package_payment(uid,m,buyer,aid)) IS DISTINCT FROM 'PAID'
 OR (SELECT to_jsonb(o) FROM public.package_payment_orders o WHERE id=uid) IS DISTINCT FROM snapshot
 OR EXISTS (SELECT FROM r4_online_private.active_paid_orders WHERE id=uid)
 OR (SELECT count(*) FROM r4_online_private.finance_refunds WHERE order_id=uid AND amount_satang=amount)<>1 THEN
  RAISE EXCEPTION USING ERRCODE='RB405',MESSAGE='Cancellation/replay changed PAID history or refund projection';
 END IF;
END $fixture$`;

async function main(args) {
  const report = { productionWrites:false, productionRowsRead:false, commitOutcome:'not-attempted' };
  let dir, db, stage = 'mode';
  const advance = name => { stage = name; };
  try {
    const apply = args[0]===applyMode;
    guard(apply || (args.length===1 && ['--metadata','--rehearse'].includes(args[0])), `Usage: --metadata | --rehearse | ${applyMode} ${runtimeConfirmation}`);
    guard(!apply || (args.length===2 && args[1]===runtimeConfirmation), 'Apply requires runtime confirmation: deployed DB principal verified, writer flags off, writers paused through postflight');
    advance('pinned-plan');
    const plan = migrationPlan();
    report.migrationChecksums = inventory;
    report.executionLfChecksums = Object.fromEntries(plan.map(m=>[m.file,digest(normalized(m.text))]));
    advance('production-target');
    const config = () => dotenv.parse(fs.readFileSync(path.join(root,'.env.local')));
    const configured = config();
    const { DATABASE_URL:url } = configured;
    guard(url && (!process.env.DATABASE_URL || url === process.env.DATABASE_URL), 'Expected configured production, no overrides');
    if (apply) checkConfiguredWriters(configured,process.env);
    advance('protected-directory');
    dir = protectedPasswordDirectory('r4-rehearsal-');
    report.artifacts = path.relative(root,dir);
    advance('production-read-only-inventory');
    const sql = neon(url);
    const b = await captureMetadata(sql);
    const { principal, version } = b.identity[0];
    report.production = { version, readOnlyRepeatableRead:true, tables:b.relations.filter(r=>r.relkind==='r').length, sequences:b.sequences.length, catalogSections:Object.keys(catalog(b)).length };
    const files = {};
    const write = (name,text) => { save(path.join(dir,name),text); files[name] = digest(text); };
    write('metadata.json',JSON.stringify(b));
    save(path.join(dir,'inventory-manifest.json'),JSON.stringify({files}));
    const f = b.functions.filter(f=>f.proname==='finalize_package_payment');
    guard(f.length===1 && f[0].owner===principal && !f[0].prosecdef,'Unreviewed finalizer ownership/signature');
    report.finalizerDefinitionSha256 = digest(normalized(f[0].definition));
    const finalizerBody = (normalized(f[0].definition).split('$function$')[1] ?? '');
    report.installedFinalizer = {
      ownerIsConfiguredPrincipal:true, invoker:true, searchPath:f[0].proconfig,
      executeGrantEntries:b.functionAcl.filter(a=>a.proname==='finalize_package_payment' && a.privilege_type==='EXECUTE').map(a=>({ principal:a.grantee===principal, public:a.grantee==='PUBLIC', grantable:a.is_grantable })),
      evidenceBodyPinMatches: (await import('node:crypto')).createHash('md5').update(finalizerBody).digest('hex')==='bb83b0f4fac7703df0b9c9b2833d96a4',
    };
    guard(!b.eventTriggers.some(t=>t.evtenabled!=='D') && !b.schemas.some(s=>s.nspname!=='public') && !b.relations.some(r=>/^(entitlement_online_observations|r7_visits)$/.test(r.relname)) && !b.functions.some(f=>/^(entitlement_observ|time_supplement_allows|r7_visit_action)/.test(f.proname)), 'Partial stack, nonpublic schema, later admission, or enabled event trigger');
    if (args[0] !== '--metadata') {
      advance('fresh-read-only-snapshot');
      report.productionRowsRead = true;
      write('snapshot.json',JSON.stringify(await captureMetadata(sql,b)));
      save(path.join(dir,'manifest.json'),JSON.stringify({files}));
      advance('snapshot-integrity');
      const manifest = JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
      for (const name of ['metadata.json','snapshot.json']) guard(digest(fs.readFileSync(path.join(dir,name),'utf8')) === manifest.files[name], 'Snapshot checksum mismatch');
      const stored = JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json'),'utf8'));
      reconcileExisting(stored);
      report.snapshotVerified = true;
      advance('native-recovery');
      const restore = recoverySql(stored);
      db = await nativeDatabase(dir,stored.roles.find(r=>r.rolsuper).rolname);
      report.nativeVersion = db.query("SELECT to_json(current_setting('server_version_num'));");
      guard(/^18\d{4}$/.test(report.nativeVersion),'Expected native PostgreSQL 18');
      db.run(restore);
      const before = inspect(db);
      const verifyData = () => {
        verifyRows(db,stored.tables);
        guard(equal(stored.sequenceState,sequenceStates(db,stored.sequences)),'Sequence state changed');
      };
      const differences = recoveryCatalogDifferences(stored,before,report.nativeVersion);
      report.recoveryDifferences = differences;
      guard(!differences.length,'Native catalog recovery mismatch');
      verifyData();
      report.recoveryVerified = true;
      const prefix = ['BEGIN ISOLATION LEVEL READ COMMITTED',`SET LOCAL ROLE ${quote(principal)}`,...settings,assertions(`current_user=${lit(principal)} AND current_database()='blu_modules_test_r2_recovery'`),advisoryLock,lockTables(stored)];
      const allowPointsRenderingPair = version==='180007' && report.nativeVersion==='180004';
      const catalogSql = catalogHashesSql(allowPointsRenderingPair);
      advance('native-baseline-fingerprints');
      const catalogPre = db.query(catalogSql+';');
      const run = (statements,end='ROLLBACK') => db.run([...prefix,...statements,end].join(';\n')+';');
      const checks = rowGuards(stored);
      advance('native-preflight');
      run(checks);
      report.stagesPassed = 0;
      // A failed prefix identifies the first enforcing migration without leaking SQL error details.
      for (let i=1;i<=plan.length;i++) {
        advance(plan[i-1].file);
        try { run(ddl(plan.slice(0,i))); }
        catch (e) {
          if (i===7 && e.code==='P0001') {
            const readers = `SELECT json_agg(json_build_object('function',r.signature,'bodyMd5',md5(replace(p.prosrc,chr(13),'')), 'ownerIsPrincipal',p.proowner=current_user::regrole,'invoker',NOT p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'strict',p.proisstrict,'parallel',p.proparallel,'language',l.lanname,'publicExecute',EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))) FROM (VALUES ('r4_staff_private.admission_term(integer,timestamptz,uuid)'),('r4_staff_private.display_terms(text,text)'),('public.real_finance_action(text,text,uuid,jsonb)')) r(signature) JOIN pg_proc p ON p.oid=to_regprocedure(r.signature) JOIN pg_language l ON l.oid=p.prolang`;
            report.failingReaderInventory = JSON.parse(run([...ddl(plan.slice(0,i-1)),readers]).trim());
          }
          guard(equal(catalog(before),catalog(inspect(db))),'Failed migration left catalog changes on clone');
          run(checks);
          report.failedPrefixRollbackVerified = true;
          throw e;
        }
        report.stagesPassed = i;
      }
      advance('native-catalog-proof');
      const trial = JSON.parse(run([...ddl(plan),settings[3], `SELECT json_build_object('post',(${catalogSql}),'acl',(${acl.slice(0,-1)}))`]).trim());
      const proof = {pre:catalogPre,...trial,allowPointsRenderingPair};
      const batches = schemaBatches(stored,plan,proof);
      const oldOid = db.query(`SELECT to_json(oid::text) FROM pg_proc WHERE oid=${lit(finalizer)}::regprocedure;`);
      const localOid = assertFinalizerOid(oldOid);
      const guardedDdl = [...batches.pre,localOid,...ddl(plan),settings[3],...batches.post,localOid,stackGuard];
      advance('native-guarded-rollback');
      run(guardedDdl);
      guard(equal(catalog(before),catalog(inspect(db))), 'Rollback changed catalog');
      report.rollbackVerified = true;
      advance('native-guarded-local-commit');
      run(guardedDdl,'COMMIT');
      verifyData();
      report.oldRowsSequencesAndPaidHistoryPreserved = true;
      advance('finalizer-and-acl');
      const after = inspect(db);
      const final = after.functions.find(f=>f.proname==='finalize_package_payment');
      guard(final && final.definition===finalizerExpected(f[0].definition,plan.at(-2).text) && String(final.oid)===oldOid && final.owner===principal && equal(final.proacl,before.functions.find(f=>f.proname==='finalize_package_payment').proacl), 'Finalizer changed beyond pinned evidence hooks or ACL/OID drift');
      const oldFns = new Set(before.functions.map(f=>`${f.proname}(${f.arguments})`));
      const oldRelations = new Set(before.relations.map(r=>r.relname));
      guard(equal(before.functionAcl,after.functionAcl.filter(f=>oldFns.has(`${f.proname}(${f.arguments})`))) && equal(before.relationAcl,after.relationAcl.filter(r=>oldRelations.has(r.relname))) && equal(before.functionAttributes,after.functionAttributes.filter(f=>oldFns.has(`${f.proname}(${f.arguments})`))) && equal(before.defaults,after.defaults) && equal(before.memberships,after.memberships),'Existing ACL or function attributes changed');
      report.exactFinalizerHooksVerified = true;
      report.acl = db.query(`SET ROLE ${quote(principal)}; ${acl};`);
      guard(report.acl.principalMatches && report.acl.objects>0 && report.acl.nonOwnerGrants===0 && report.acl.unexpectedEffective===0 && report.acl.principalMissing===0,'Unexpected new effective access or grant');
      advance('live-stack-guards-on-clone');
      run([stackGuard,emptyNew,history]);
      report.newTablesEmpty = newTables.length;
      report.stackGuardsVerified = true;
      advance('actual-principal-settlement-and-cancellation-fixture');
      run([settlementFixture]);
      run([...rowGuards(stored,false),emptyNew,history]);
      report.actualPrincipalSettlementAndCancellation = { unauthorizedRejected:true, settlementPaid:true, evidenceCaptured:true, disabledBeforeLocalCutover:true, cancellationReplay:true, terminalFinalizerReplay:true, paidHistoryUnchanged:true, fixtureRollbackVerified:true };
      advance('fixture-sequence-cleanup-on-clone');
      const fixtureStates = sequenceStates(db,stored.sequences);
      const advanced = Object.entries(stored.sequenceState).filter(([n,s])=>!equal(s,fixtureStates[n]));
      // Sequence increments survive a fixture rollback. Restore only the affected
      // sequences after the install-time guards and the fixture row guards passed.
      report.cloneFixtureSequencesRestored = advanced.map(([n])=>n);
      run(advanced.map(([n,s])=>`SELECT setval(${lit(`public.${quote(n)}`)},${lit(s.last_value)}::bigint,${s.is_called})`),'COMMIT');
      run([...checks,emptyNew,history]);
      advance('native-exact-transaction-and-postflight-guards');
      // Recheck the clone commit with the same persisted postflight guard SQL,
      // substituting only cluster-local identity and finalizer OID.
      db.run(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',`SET LOCAL ROLE ${quote(principal)}`,...settings,
        ...batches.post,assertFinalizerOid(oldOid),'ROLLBACK'].join(';\n')+';');
      report.exactPostflightGuardsVerified = true;
      advance('production-read-only-baseline-guards');
      await sql.transaction([...settings,identityGuard(stored,true),...batches.pre].map(text=>sql.query(text)),{readOnly:true,isolationLevel:'RepeatableRead'});
      report.liveBaselineGuardsVerified = true;
      if (apply) {
        advance('production-transaction-preparation');
        const currentConfig = config();
        guard(currentConfig.DATABASE_URL===url,'Configured production target changed during rehearsal');
        checkConfiguredWriters(currentConfig,process.env);
        guard(equal(plan,migrationPlan()),'Pinned migration bytes changed since rehearsal');
        save(path.join(dir,'transaction-intent.json'),JSON.stringify({
          status:'Reconcile read-only if commit outcome is unknown; do not retry blindly',
          snapshot:manifest.files['snapshot.json'], migrations:report.executionLfChecksums,
          catalog:proof, oldRowFingerprints:Object.fromEntries(Object.entries(stored.tables).map(([n,t])=>[n,{count:t.row_count,sha256:t.fingerprint}])),
          sequences:stored.sequenceState,
        }));
        await executeSchemaBatches(()=>neon(url),batches,report,advance);
      }
    }
    report.outcome = 'VERIFIED';
  } catch (e) {
    report.outcome='BLOCKED'; report.stage=stage;
    if (e instanceof Gate || ['Production metadata changed during backup discovery','Sequence changed during capture','Unknown migration inventory','Existing R2 source/schema checksum mismatch','Unsupported recovery feature; fail closed','Native engine unavailable'].includes(e.message)) report.gate=e.message;
    if (e.name === 'NeonDbError' && !e.code) report.transportFailure=true;
    if (['EACCES','EPERM','EEXIST','ENOENT'].includes(e.code)) report.filesystemCode=e.code;
    if (/^[0-9A-Z]{5}$/.test(e?.code??'')) report.code=e.code;
    process.exitCode=1;
  } finally {
    if (db) {
      try { db.close(); report.nativeStopped=true; } catch { report.nativeStopped=false; }
    }
    if (dir && (!db || report.nativeStopped)) {
      try { for (const name of ['native-data','native-server.log','pg_ctl.log']) fs.rmSync(path.join(dir,name),{force:true,recursive:true,maxRetries:3}); }
      catch { report.cleanupFailed=true; }
    }
    if (report.nativeStopped===false || report.cleanupFailed) { report.outcome='BLOCKED'; process.exitCode=1; }
    if (dir) try { save(path.join(dir,'report.json'),JSON.stringify(report,null,2)); } catch { report.reportWriteFailed=true; process.exitCode=1; }
    console.log(JSON.stringify(report,null,2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
