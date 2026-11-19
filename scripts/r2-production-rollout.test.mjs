import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { local } from './db-safety.mjs';
import { plan, selectedPlan, cardAvatarPlan, cardAvatarAclCheck, passwordPlan, passwordAclCheck, main, comparisonSql, recoverySql, reconcileExisting, catalogOnlyBaseline, rehearseCardAvatar, nativeDatabase, nativeCatalog, scopeCatalog } from './r2-production-rollout.mjs';
import { splitSql } from './db-payments-sql.mjs';

const require=createRequire(import.meta.url);
const {PGlite}=require('../.local-db/payment-sql-tests/node_modules/@electric-sql/pglite');

test('R2 pinned inventory is bounded; production selection excludes password',()=>{
  const migrations=plan();
  assert.equal(migrations.length,3);
  assert.deepEqual(passwordPlan(),migrations.filter(m=>m.file==='20261118_R2_admin_member_password.sql'));
  assert.deepEqual(cardAvatarPlan().map(m=>m.file),['20261118_R2_member_cards.sql','20261118_R2_staff_avatar.sql']);
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
  await assert.rejects(main(['--apply-password-schema','--apply']),/Invalid arguments/);
  await assert.rejects(main(['--rehearse-password-schema','--apply-password-schema']),/Invalid arguments/);
  await assert.rejects(main(['--apply-card-avatar','--apply']),/Invalid arguments/);
  await assert.rejects(main(['--apply-card-avatar','--dry-run']),/Invalid arguments/);
  await assert.rejects(main(['--apply','--dry-run']),/Invalid arguments/);
  await assert.rejects(main(['--rehearse-card-avatar','--apply']),/Invalid arguments/);
  await assert.rejects(main(['--apply','--rehearse-card-avatar']),/Invalid arguments/);
  await assert.rejects(main(['--rehearse-card-avatar-protected','--apply']),/Invalid arguments/);
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

test('native synthetic card/avatar rehearsal: reject inventory drift before DDL and preserve old rows', {timeout:120000}, async()=>{
  const dir=fs.mkdtempSync(path.join(local,'r2-card-avatar-test-'));
  let db;
  try {
    db=await nativeDatabase(dir,'postgres');
    db.run(`CREATE ROLE fixture_owner; GRANT CREATE ON SCHEMA public TO fixture_owner;
      SET ROLE fixture_owner;
      CREATE TABLE members (id integer PRIMARY KEY, member_code text, role text, status text, full_name text, nickname text, gender text, birth_day integer, birth_month integer, emergency_name text, emergency_phone text, emergency_relation text, avatar_url text);
      CREATE TABLE auth_sessions (id integer PRIMARY KEY, member_id integer, token_hash text, mode text, revoked_at timestamptz, expires_at timestamptz);
      INSERT INTO members(id,member_code,avatar_url) VALUES (1,'SYNTHETIC',NULL),(2,'SYNTHETIC-2','legacy');
      CREATE FUNCTION kiosk_checkin(text,text,uuid,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
      CREATE FUNCTION real_frontdesk_checkin(text,text,uuid,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
      CREATE TABLE r2_schema_rollouts(name text PRIMARY KEY,checksum text NOT NULL,objects jsonb NOT NULL);
      ${selectedPlan().flatMap(m=>m.statements).join(';\n')};`);
    const json=JSON.stringify(scopeCatalog(nativeCatalog(db))).replaceAll("'","''");
    const seed=selectedPlan().map(m=>`('${m.file}','${m.checksum}','${json}'::jsonb)`).join(',');
    assert.throws(()=>rehearseCardAvatar(db,'fixture_owner'),/Unknown migration inventory/);
    db.run(`INSERT INTO r2_schema_rollouts VALUES ${seed}; UPDATE r2_schema_rollouts SET checksum='bad';`);
    assert.throws(()=>rehearseCardAvatar(db,'fixture_owner'),/source\/schema checksum mismatch/);
    db.run(`DELETE FROM r2_schema_rollouts; INSERT INTO r2_schema_rollouts VALUES ${seed}; ALTER TABLE member_contact_details ADD COLUMN drift integer;`);
    assert.throws(()=>rehearseCardAvatar(db,'fixture_owner'),/source\/schema checksum mismatch/);
    assert.equal(db.query("SELECT to_json(to_regclass('public.member_cards') IS NULL);"),true);
    db.run('ALTER TABLE member_contact_details DROP COLUMN drift;');
    const baseline=nativeCatalog(db);
    baseline.tables={members:{rows:'[{"member_code":"SYNTHETIC"}]',row_count:'1'},r2_schema_rollouts:{rows:JSON.stringify(selectedPlan().map(m=>({name:m.file,checksum:m.checksum,objects:scopeCatalog(baseline)}))),row_count:'2'}};
    const projected=catalogOnlyBaseline(baseline);
    assert.deepEqual(projected.tables.members,{rows:'[]',row_count:'0'});
    assert.equal(projected.tables.r2_schema_rollouts,baseline.tables.r2_schema_rollouts);
    assert.equal(baseline.tables.members.row_count,'1');
    assert.throws(()=>rehearseCardAvatar(db,'fixture_owner',{}),/Incomplete old-table inventory/);
    const result=rehearseCardAvatar(db,'fixture_owner');
    assert.deepEqual(result,{migrations:['20261118_R2_member_cards.sql','20261118_R2_staff_avatar.sql'],inventoryVerified:true,oldTablesCompared:6,rollbackVerified:true,avatarVersionDefault:0,avatarDefaultVerifiedOnExistingMembers:true,newEmptyTables:5});
    assert.equal(db.query(comparisonSql('members','[{"id":1},{"id":2}]',['id'])).missingCount,0);
    assert.equal(db.query(comparisonSql('members','[{"id":1},{"id":3}]',['id'])).missingCount,1);
    assert.throws(()=>rehearseCardAvatar(db,'fixture_owner'),/conflicting objects/);
    const acl=()=>db.query(`SET ROLE fixture_owner; SELECT to_json(${cardAvatarAclCheck});`);
    assert.equal(acl(),true);
    db.run(`CREATE ROLE fixture_outsider LOGIN; CREATE ROLE fixture_access;
      GRANT fixture_access TO fixture_outsider WITH INHERIT FALSE, SET TRUE;
      GRANT SELECT ON public.member_card_audit_id_seq TO fixture_access;`);
    assert.equal(acl(),false);
    db.run('REVOKE SELECT ON public.member_card_audit_id_seq FROM fixture_access;');
    assert.equal(acl(),true);
    db.run(`CREATE ROLE fixture_service LOGIN; CREATE ROLE fixture_managed;
      GRANT fixture_managed TO fixture_service WITH INHERIT TRUE, SET TRUE;
      GRANT pg_read_all_data, pg_write_all_data TO fixture_managed WITH INHERIT TRUE, SET TRUE;
      GRANT pg_maintain TO fixture_managed WITH INHERIT TRUE, SET FALSE;`);
    assert.equal(db.query(`SELECT to_json(pg_has_role('fixture_service','pg_read_all_data','USAGE')
      AND pg_has_role('fixture_service','pg_write_all_data','SET')
      AND pg_has_role('fixture_service','pg_maintain','USAGE')
      AND NOT pg_has_role('fixture_service','pg_maintain','SET')
      AND has_sequence_privilege('fixture_service','public.member_card_audit_id_seq','SELECT'));`),true);
    assert.equal(acl(),true,'intrinsic privileges match the same baseline operations');
    for(const [grant,revoke] of [
      ['SELECT ON member_cards TO fixture_service','SELECT ON member_cards FROM fixture_service'],
      ['TRUNCATE ON member_cards TO fixture_service','TRUNCATE ON member_cards FROM fixture_service'],
      ['SELECT ON SEQUENCE member_card_audit_id_seq TO fixture_managed WITH GRANT OPTION','SELECT ON SEQUENCE member_card_audit_id_seq FROM fixture_managed'],
      ['EXECUTE ON FUNCTION member_card_immutable() TO fixture_access','EXECUTE ON FUNCTION member_card_immutable() FROM fixture_access'],
      ['UPDATE (avatar_version) ON members TO fixture_service','UPDATE (avatar_version) ON members FROM fixture_service'],
      ['SELECT ON member_cards TO PUBLIC','SELECT ON member_cards FROM PUBLIC'],
    ]) {
      db.run(`SET ROLE fixture_owner; GRANT ${grant};`);
      assert.equal(acl(),false,grant);
      db.run(`SET ROLE fixture_owner; REVOKE ${revoke};`);
      assert.equal(acl(),true,revoke);
    }
    await testPasswordAcl(db);
  }finally{
    if(db)db.close();
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:3});
  }
});

function testPasswordAcl(db) {
  db.run(`SET ROLE fixture_owner; CREATE TABLE auth_password_tickets(id integer);
    ${passwordPlan()[0].statements.join(';\n')};`);
  const acl=()=>db.query(`SET ROLE fixture_owner; SELECT to_json(${passwordAclCheck});`);
  assert.equal(acl(),true,'unchanged inherited managed privileges match existing auth and audit analogs');
  for(const [grant,revoke] of [
    ['SELECT ON admin_member_password_requests TO fixture_service','SELECT ON admin_member_password_requests FROM fixture_service'],
    ['SELECT ON SEQUENCE admin_member_password_audit_id_seq TO fixture_access WITH GRANT OPTION','SELECT ON SEQUENCE admin_member_password_audit_id_seq FROM fixture_access'],
    ['SELECT(reason) ON admin_member_password_requests TO fixture_outsider','SELECT(reason) ON admin_member_password_requests FROM fixture_outsider'],
    ['EXECUTE ON FUNCTION admin_member_password_action(text,uuid,jsonb,text) TO PUBLIC','EXECUTE ON FUNCTION admin_member_password_action(text,uuid,jsonb,text) FROM PUBLIC'],
  ]) {
    db.run(`SET ROLE fixture_owner; GRANT ${grant};`);
    assert.equal(acl(),false,grant);
    db.run(`SET ROLE fixture_owner; REVOKE ${revoke};`);
    assert.equal(acl(),true,revoke);
  }
}
