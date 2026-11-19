import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { captureMetadata, historicalDelta, metadataQueries, migrationPlan, prerequisiteIssues } from './r3-production-rehearsal.mjs';
import { recoveryQueries } from './r2-production-rollout.mjs';

const source = file => fs.readFileSync(new URL(`../src/db/migrations/${file}`,import.meta.url),'utf8');

test('pins only the four R3 migrations in dependency order, rejects changed bytes', () => {
  const plan = migrationPlan();
  assert.deepEqual(plan.map(m=>m.file),['20261118_r3_package_catalog.sql','20261118_r3_package_catalog_checkin.sql','20261119_r3_package_bonus_points.sql','20261119_r3_member_time_override.sql']);
  assert.ok(plan.every(m=>m.statements.every(s=>!['BEGIN','COMMIT'].includes(s))));
  assert.throws(()=>migrationPlan(f=>source(f)+'\n'),/Unreviewed R3 migration/);
});

test('CLI rejects apply before target lookup', () => {
  const run = spawnSync(process.execPath,['scripts/r3-production-rehearsal.mjs','--apply'],{encoding:'utf8'});
  assert.equal(run.status,1);
  assert.equal(run.stderr,'');
  assert.deepEqual(JSON.parse(run.stdout),{productionWrites:false,productionRowsRead:false,commitOutcome:'not-attempted',outcome:'BLOCKED',stage:'mode'});
});

test('production capture submits one read-only metadata transaction and rejects wrong identity', async () => {
  const calls = [];
  let transactions = 0;
  const sql = {query:(text,params)=>{calls.push({text,params}); return text;},transaction:(queries,options)=>{
    transactions++;
    assert.deepEqual(options,{readOnly:true,isolationLevel:'RepeatableRead'});
    return queries.map(q=>[{records:q.includes('AS principal')?'[{"database":"wrong","principal":"wrong","read_only":"on","version":"180007"}]':'[]'}]);
  }};
  await assert.rejects(captureMetadata(sql),/Unexpected production target/);
  assert.equal(transactions,1);
  assert.equal(calls.length,4+Object.keys(metadataQueries).length);
  assert.match(calls[3].text,/transaction_read_only/);
  assert.equal(calls[3].params.length,2);
  assert.ok(!calls.some(({text})=>/\bFROM\s+public\.|\bnextval\(|\blast_value::text/i.test(text)));
});

test('prerequisite gate refuses missing sources, constraints and an enabled event trigger', () => {
  const issues = prerequisiteIssues({functions:[],functionAcl:[],constraints:[],triggers:[],eventTriggers:[{evtenabled:'O'}]});
  for (const check of ['source:kiosk_checkin','source:member_card_admit','source:guard_package_catalog_order_insert','constraint:package_catalog_id_check','trigger:package_paid_benefits','enabled event triggers']) assert.ok(issues.includes(check),check);
});

test('historical guard accepts password additions but rejects unrelated ACL drift', () => {
  const old = Object.fromEntries(Object.keys(recoveryQueries).map(k=>[k,[]]));
  const current = {...old,relations:[{relname:'admin_member_password_requests'}],relationAcl:[{relname:'admin_member_password_requests'}]};
  assert.deepEqual(historicalDelta(old,current),[]);
  current.relationAcl.push({relname:'member_cards',grantee:'PUBLIC'});
  assert.deepEqual(historicalDelta(old,current),['relationAcl']);
});
