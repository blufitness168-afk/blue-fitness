import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { digest, local } from './db-safety.mjs';
import { nativeDatabase, protectedPasswordDirectory } from './r2-production-rollout.mjs';
import { catalogHashesSql, checkConfiguredWriters, executeSchemaBatches, inventory, migrationPlan, schemaBatches } from './r4-production-rehearsal.mjs';

const cli = new URL('./r4-production-rehearsal.mjs', import.meta.url);
test('R4 inventory pins the full chain and runs normalized SQL, not transaction wrappers', () => {
  const plan = migrationPlan();
  assert.equal(plan.length, 12);
  assert.deepEqual(plan.map(m => m.file), Object.keys(inventory));
  assert.match(plan[1].file, /foundation/);
  assert.match(plan[6].file, /free_z_cancellation/);
  assert.match(plan[7].file, /purchase_guard/);
  assert.match(plan.at(-2).file, /settlement_evidence/);
  assert.match(plan.at(-1).file, /online_cancellation/);
  assert.ok(plan.every(m => m.statements.every(s => !s.includes('\r') && !['BEGIN','COMMIT'].includes(s))));
});

test('R4 rejects changed source before newline normalization', () => {
  const source = new Map(migrationPlan().map(m => [m.file,m.text]));
  assert.throws(() => migrationPlan(f => source.get(f)+'\n'), /Unreviewed migration/);
});

test('apply without runtime confirmation stops before snapshot or transaction', () => {
  const out = spawnSync(process.execPath,[fileURLToPath(cli),'--apply-r4-schema'],{encoding:'utf8'});
  assert.equal(out.status,1);
  assert.equal(out.stderr,'');
  const report = JSON.parse(out.stdout);
  assert.equal(report.stage,'mode');
  assert.equal(report.commitOutcome,'not-attempted');
  assert.equal(report.productionRowsRead,false);
  assert.equal(report.productionWrites,false);
  assert.match(report.gate,/requires runtime confirmation/);
  assert.throws(()=>checkConfiguredWriters({ENABLE_STAFF_FREE:'true'},{}),/writer flags off/);
  assert.throws(()=>checkConfiguredWriters({},{ENABLE_ONLINE_CANCELLATION:'true'}),/writer flags off/);
});

const snapshot = {
  identity:[{database:'verified-db',principal:'app-owner',version:'180007'}],
  functions:[{proname:'finalize_package_payment',oid:34567}],
  tables:{members:{rows:'DO_NOT_SEND_ROW_PAYLOAD',row_count:'2',fingerprint:'a'.repeat(64)}},
  sequenceState:{members_id_seq:{last_value:'5',is_called:true}},
};
const sections = (catalogHashesSql(true).match(/jsonb_agg\(r ORDER BY/g)||[]).length;
const proof = {
  pre:Array(sections).fill('b'.repeat(64)), post:Array(sections).fill('c'.repeat(64)),
  allowPointsRenderingPair:true,
  acl:{principalMatches:true,objects:53,nonOwnerGrants:0,unexpectedEffective:0,builtinEffectiveRoles:5,principalMissing:0},
};

test('schema batch is identity-bound, locks before drift checks, and sends only pinned LF DDL', () => {
  const plan = migrationPlan();
  assert.throws(()=>schemaBatches(snapshot,plan,null),/rehearsal proof/);
  assert.throws(()=>schemaBatches(snapshot,plan,{...proof,pre:['bogus']}),/catalog fingerprint/);
  assert.throws(()=>schemaBatches(snapshot,plan.slice(1),proof),/migration bytes changed/);
  const {apply,postflight} = schemaBatches(snapshot,plan,proof);
  const idx = (match) => apply.findIndex(q=>q.includes(match));
  const ddl = plan.flatMap(m=>m.statements);
  const start = idx(ddl[0]);
  assert.ok(idx("current_database()='verified-db'") < idx('pg_advisory_xact_lock'));
  assert.ok(idx('pg_advisory_xact_lock') < idx('LOCK TABLE public."members" IN SHARE MODE'));
  for (const check of [proof.pre[0],snapshot.tables.members.fingerprint,'last_value::text',"'34567'::oid"]) {
    assert.ok(idx(check)>idx('LOCK TABLE public."members" IN SHARE MODE') && idx(check)<start);
  }
  assert.deepEqual(apply.slice(start,start+ddl.length),ddl);
  assert.ok(idx(proof.post[0])>=start+ddl.length);
  assert.ok(idx('nonOwnerGrants')>idx(proof.post[0]));
  assert.equal(apply.at(-1),'SELECT r4_online_private.assert_cancellation_stack()');
  const combined = [...apply,...postflight].join('\n');
  assert.doesNotMatch(combined,/DO_NOT_SEND_ROW_PAYLOAD|INSERT INTO r4_online_private.reader_cutover|\r/);
  assert.match(combined,/session_user=current_user/);
  assert.match(combined,/server_version_num'\)='180007'/);
  assert.match(combined,/session_replication_role'\)='origin'/);
  assert.match(postflight.join('\n'),/transaction_read_only'\)='on'.*repeatable read/);
  assert.ok(postflight.some(q=>q.includes(proof.post[0])));
  assert.ok(postflight.some(q=>q.includes('NOT EXISTS (SELECT FROM r4_online_private.reader_cutover)')));
  assert.ok(ddl.every(q=>!postflight.includes(q)));
});

function transport(failAt) {
  const calls = [];
  let count = 0;
  const connect = () => {
    const connection = ++count;
    return {query: text=>text, transaction: async (queries,options)=>{
      calls.push({connection,queries,options});
      if (connection===failAt) throw Object.assign(new Error('simulated failure'),{code:'RB401'});
    }};
  };
  return {calls,connect};
}

test('one write transaction, then independent read-only postflight', async () => {
  const batches = schemaBatches(snapshot,migrationPlan(),proof);
  const {calls,connect} = transport();
  const report = {}, stages = [];
  await executeSchemaBatches(connect,batches,report,s=>stages.push(s));
  assert.deepEqual(calls,[
    {connection:1,queries:batches.apply,options:{isolationLevel:'ReadCommitted'}},
    {connection:2,queries:batches.postflight,options:{readOnly:true,isolationLevel:'RepeatableRead'}},
  ]);
  assert.deepEqual(stages,['production-schema-transaction','production-read-only-postflight']);
  assert.deepEqual(report,{commitOutcome:'committed',productionWrites:true,postflight:{readOnly:true,verified:true}});
});

test('native guards reject wrong target and catalog, row or sequence drift before DDL', {
  timeout:30000,
  skip:process.platform!=='win32' || !fs.existsSync(path.join(local,'portable-postgres-uat/package/native/bin/initdb.exe')),
}, async () => {
  const dir = protectedPasswordDirectory('r4-guard-test-');
  let db;
  try {
    db = await nativeDatabase(dir,'r4_guard_test');
    db.run(`CREATE TABLE public.members(id integer);
      CREATE SEQUENCE public.members_id_seq;
      CREATE FUNCTION public.finalize_package_payment(uuid,integer,text,uuid) RETURNS integer LANGUAGE sql AS 'SELECT 1';`);
    const [identity,oid] = db.query(`SELECT json_build_array(
      json_build_object('database',current_database(),'principal',current_user,'version',current_setting('server_version_num')),
      'public.finalize_package_payment(uuid,integer,text,uuid)'::regprocedure::oid);`);
    const b = {
      identity:[identity], functions:[{proname:'finalize_package_payment',oid}],
      tables:{members:{row_count:'0',fingerprint:digest('[]')}},
      sequenceState:{members_id_seq:{last_value:'1',is_called:false}},
    };
    const pre = db.query(catalogHashesSql(false)+';');
    const plan = migrationPlan();
    const batches = (baseline) => schemaBatches(baseline,plan,{...proof,pre,post:pre,allowPointsRenderingPair:false});
    const beforeDdl = batch => batch.apply.slice(0,batch.apply.indexOf(plan[0].statements[0]));
    const run = (guards,before=[],readOnly=false) => db.run([
      readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN ISOLATION LEVEL READ COMMITTED',
      ...before,...guards,'ROLLBACK',
    ].join(';\n')+';');
    const guards = beforeDdl(batches(b));
    run(guards);
    for (const wrong of [{database:'wrong_db'},{principal:'wrong_role'},{version:'180000'}]) {
      assert.throws(()=>run(beforeDdl(batches({...b,identity:[{...identity,...wrong}]}))),{code:'RB401'});
    }
    assert.throws(()=>run(guards,['ALTER TABLE public.members ADD COLUMN drift int']),{code:'RB401'});
    assert.throws(()=>run(guards,['INSERT INTO public.members VALUES (1)']),{code:'RB401'});
    assert.throws(()=>run(batches(b).postflight,[],true),{code:'42P01'}); // Missing R4 postconditions, despite exact old baseline.
    db.run('SELECT nextval(\'public.members_id_seq\');'); // Sequence changes survive rollback, so run last.
    assert.throws(()=>run(guards),{code:'RB401'});
  } finally {
    if (db) db.close();
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:3});
  }
});

test('no retry after an uncertain write or a failed postflight', async () => {
  const batches = schemaBatches(snapshot,migrationPlan(),proof);
  for (const failAt of [1,2]) {
    const {calls,connect} = transport(failAt);
    const report = {productionWrites:false};
    await assert.rejects(executeSchemaBatches(connect,batches,report,()=>{}),/simulated failure/);
    assert.equal(calls.length,failAt);
    assert.equal(report.commitOutcome,failAt===1?'unknown':'committed');
    assert.equal(report.productionWrites,failAt===2);
    assert.equal(report.postflight,undefined);
  }
});
