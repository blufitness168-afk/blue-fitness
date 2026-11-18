import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { plan, selectedPlan, main, comparisonSql, recoverySql, reconcileExisting } from './r2-production-rollout.mjs';
import { splitSql } from './db-payments-sql.mjs';

const require=createRequire(import.meta.url);
const {PGlite}=require('../.local-db/payment-sql-tests/node_modules/@electric-sql/pglite');

test('R2 pinned inventory is bounded; production selection excludes password',()=>{
  const migrations=plan();
  assert.equal(migrations.length,3);
  assert.deepEqual(selectedPlan().map(m=>m.file),['20261118_R2_admin_member_profile.sql','20261118_R2_member_contact_email.sql']);
  for(const m of migrations){
    assert.match(m.checksum,/^[a-f0-9]{64}$/);
    assert.ok(m.statements.some(s=>s.startsWith('CREATE FUNCTION ')));
    assert.ok(m.statements.every(s=>!/^(BEGIN|COMMIT|DROP|UPDATE|DELETE|INSERT|ALTER)\b/.test(s)));
  }
  assert.equal(splitSql('BEGIN; CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END $$; COMMIT;').length,3);
});

test('unknown/conflicting flags fail before env/database access',async()=>{
  await assert.rejects(main(['--all']),/Invalid arguments/);
  await assert.rejects(main(['--apply','--dry-run']),/Invalid arguments/);
});

test('unsupported recovery features fail closed',()=>{
  assert.throws(()=>recoverySql({unsupported:[{kind:'unsupported'}]}),/Unsupported recovery feature/);
});

test('existing objects without recorded approved inventory cannot be adopted',()=>{
  assert.throws(()=>reconcileExisting({relations:[]}),/no trusted migration inventory/);
  assert.throws(()=>reconcileExisting({relations:[{relname:'r2_schema_rollouts'}],tables:{}}),/Unknown migration inventory/);
});

test('typed comparison preserves microseconds, bigint/numeric precision, JSON and duplicate counts',async()=>{
  const db=new PGlite();
  try{
    await db.exec("CREATE TYPE example_enum AS ENUM ('ONE','TWO'); CREATE TABLE example(t timestamptz,n numeric(30,8),b bigint,e example_enum,j jsonb,s text); SET TIME ZONE 'Asia/Bangkok';");
    const source='[{"t":"2026-01-01T00:00:00.123456+00:00","n":1234567890123456789012.12345678,"b":9007199254740993,"e":"ONE","j":{"b":2,"a":1},"s":"literal +00:00"}]';
    await db.query('INSERT INTO example SELECT * FROM json_populate_recordset(NULL::example,$1::json)',[source]);
    const compare=async rows=>{
      const value=(await db.query(comparisonSql('example',rows))).rows[0].json_build_object;
      return typeof value==='string'?JSON.parse(value):value;
    };
    assert.deepEqual(await compare(source),{expectedCount:1,actualCount:1,missingCount:0,extraCount:0});
    assert.equal((await compare(source.replace('.123456+00:00','.123455+00:00'))).missingCount,1,'one microsecond must not be rounded away');
    assert.equal((await compare(source.replace('9007199254740993','9007199254740992'))).missingCount,1,'bigints beyond JS safe integers remain distinct');
    assert.equal((await compare(source.replace('12345678','12345679'))).missingCount,1,'numeric fractional changes must fail');
    assert.equal((await compare(source.replace('literal +00:00','literal +07:00'))).missingCount,1,'text is never timezone-normalized');
    assert.equal((await compare(source.replace('"ONE"','"TWO"'))).missingCount,1,'enum changes must fail');
    await db.exec('INSERT INTO example SELECT * FROM example');
    assert.equal((await compare(source)).extraCount,1,'EXCEPT ALL must retain duplicate multiplicity');
  }finally{await db.close();}
});

test('comparison SQL safely quotes data and identifiers without broad normalization',()=>{
  const sql=comparisonSql('table"name',JSON.stringify([{text:"O'Reilly"}]));
  assert.ok(sql.includes('"table""name"'));
  assert.ok(sql.includes("O''Reilly"));
  assert.match(sql,/EXCEPT ALL/);
  assert.doesNotMatch(sql,/date_trunc|round\(|substring|regexp_replace/);
});
