import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitSql, migrationStatements, incrementalPaymentStatements } from './db-payments-sql.mjs';
test('SQL splitter handles quotes, dollar bodies and nested comments', () => {
  assert.deepEqual(splitSql(`-- ignored ;\n SELECT ';', "a;b", 'it''s'; /* outer ; /* nested */ */ DO $body$ BEGIN PERFORM ';'; END $body$; SELECT 2;`), [`SELECT ';', "a;b", 'it''s'`, "DO $body$ BEGIN PERFORM ';'; END $body$", 'SELECT 2']);
});
test('rejects malformed SQL and top-level mutation', () => {
  assert.throws(() => splitSql('SELECT $$broken'));
  assert.throws(() => migrationStatements('BEGIN; UPDATE members SET points=0; COMMIT;'));
  assert.throws(() => migrationStatements('CREATE TABLE test(id int);'));
});
test('incremental parser accepts reviewed replacements and empty trigger signature but original refuses', () => {
  const text = fs.readFileSync(new URL('../src/db/migrations/20261010_payment_promptpay.sql', import.meta.url), 'utf8');
  assert.equal(incrementalPaymentStatements(text).length, 12);
  assert.throws(() => migrationStatements(text));
  assert.throws(() => incrementalPaymentStatements(text.replace('REVOKE ALL ON FUNCTION protect_package_payment_attempt() FROM PUBLIC;', 'DELETE FROM members;')));
  assert.throws(() => incrementalPaymentStatements(text.replace('COMMIT;', 'UPDATE members SET points=0; COMMIT;')));
});
test('actual migration has additive top-level statements only', () => {
  const statements = migrationStatements(fs.readFileSync(new URL('../src/db/migrations/20261009_real_package_payments.sql', import.meta.url), 'utf8'));
  assert.ok(statements.length > 20);
  assert.ok(statements.some(s => s.startsWith('CREATE FUNCTION finalize_package_payment')));
});
