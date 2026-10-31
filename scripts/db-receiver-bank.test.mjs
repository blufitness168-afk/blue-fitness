import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceBankGuard } from './db-receiver-bank-migrate.mjs';

test('deployment metadata expectation preserves literal regex dollar and the complete function suffix', () => {
 const prefix="CREATE FUNCTION example() RETURNS void AS $$ BEGIN IF false ";
 const obsolete="AND a.evidence->>'bankCode'='004'";
 const suffix=" AND a.evidence->'receiverIdentity'->>'bankCode'=o.receiver_snapshot->>'bankCode' THEN RAISE EXCEPTION 'Invalid payment evidence'; END IF; END $$";
 const replacement="AND (o.receiver_snapshot->>'bankCode') ~ '^[0-9]{3}$'";
 const definition=prefix+obsolete+suffix;
 assert.notEqual(definition.replace(obsolete,replacement),prefix+replacement+suffix,'Naive JS replacement expands dollar-quote as a suffix token');
 assert.equal(replaceBankGuard(definition),prefix+replacement+suffix);
 assert.equal(replaceBankGuard(definition).split(suffix).length-1,1);
});
test('deployment rejects missing, already patched or repeated obsolete guards', () => {
 for(const definition of ['',"AND (o.receiver_snapshot->>'bankCode') ~ '^[0-9]{3}$'", "AND a.evidence->>'bankCode'='004' AND a.evidence->>'bankCode'='004'"])
  assert.throws(()=>replaceBankGuard(definition),/Expected exactly one/);
});
