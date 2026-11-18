// Offline only: never loads env, connects to a server, or downloads dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const read = name => readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), 'utf8');
const migration = read('20261118_R4_online_provenance');
test('R4 shadow scope: no backfill, payment replacement, grants or staff success path', () => {
 assert.doesNotMatch(migration, /CREATE OR REPLACE|SECURITY DEFINER|UPDATE public\.|INSERT INTO (members|coupons|package_payment_point_ledger)/i);
 assert.match(migration, /OLD.status IS DISTINCT FROM 'PENDING'/);
 assert.match(migration, /REVOKE ALL ON public.entitlement_online_observations FROM PUBLIC/);
 assert.match(migration, /BEFORE UPDATE OR DELETE OR TRUNCATE/);
});
test('R4 isolated SQL: real finalizer, immutable legacy, ledger linkage, replay and rollback', { timeout: 120000 }, async () => {
 let PGlite;
 for (const location of [import.meta.url, new URL('../../.local-db/payment-sql-tests/package.json', import.meta.url)]) {
  try { ({ PGlite } = createRequire(location)('@electric-sql/pglite')); break; }
  catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
 }
 assert.ok(PGlite, 'Required offline PGlite runtime missing; SQL validation NOT passed. Do not auto-install or connect to DB.');
 const db = new PGlite();
 try {
  await db.exec(`
   CREATE TYPE member_status AS ENUM ('PENDING','ACTIVE','EXPIRED','SUSPENDED');
   CREATE TYPE member_role AS ENUM ('MEMBER','ADMIN','OWNER');
   CREATE TABLE members(id serial PRIMARY KEY, phone text, full_name text, member_code text,
    status member_status DEFAULT 'ACTIVE', role member_role DEFAULT 'MEMBER', points integer DEFAULT 7,
    expire_date timestamptz, updated_at timestamptz DEFAULT now());
   CREATE TABLE auth_sessions(id serial PRIMARY KEY, member_id integer REFERENCES members(id),
    token_hash text, expires_at timestamptz, revoked_at timestamptz);
   CREATE TABLE payments(id serial PRIMARY KEY,easyslip_trans_ref varchar(100));
  `);
  await db.exec(read('20261009_real_package_payments'));
  await db.exec(read('20261010_payment_promptpay'));
  const one = async sql => (await db.query(sql)).rows[0];
  // Settle through the actual historical finalizer, not a fake PAID insertion.
  await db.exec(`
   CREATE FUNCTION r4_test_settle(ref text) RETURNS uuid LANGUAGE plpgsql AS $$
   DECLARE o package_payment_orders; a package_payment_attempts; proof jsonb;
   BEGIN
    SELECT * INTO o FROM create_package_payment_order(gen_random_uuid(),1,repeat('a',64),gen_random_uuid(),
     '{"package":{"durationDays":30,"timeSlot":"07:00-14:00"},"subtotalSatang":90000,"discountSatang":0,"amountSatang":90000,"pointsEarned":45}',
     '{"bankCode":"004","bankAccount":"0000000000","name":"OFFLINE TEST"}');
    SELECT * INTO a FROM claim_package_payment_attempt(o.id,1,repeat('a',64),gen_random_uuid(),repeat('1',64));
    proof:=jsonb_build_object('transRef',ref,'paidAt',clock_timestamp(),'amountSatang',90000,'bankCode','004',
     'receiverEvidence','REGISTERED_ACCOUNT_V2','providerStrategy','EASYSLIP_V2_REGISTERED_ACCOUNT','orderId',o.id,
     'receiverIdentity',jsonb_build_object('bankCode','004','bankAccount','0000000000','name','OFFLINE TEST',
      'expectedName','OFFLINE TEST','normalizedName','OFFLINETEST'));
    UPDATE package_payment_attempts SET state='VERIFIED',evidence=proof WHERE id=a.id;
    PERFORM finalize_package_payment(o.id,1,repeat('a',64),a.id);
    PERFORM finalize_package_payment(o.id,1,repeat('a',64),a.id);
    RETURN o.id;
   END $$;
   INSERT INTO members(expire_date) VALUES(clock_timestamp()+interval '10 days');
   INSERT INTO auth_sessions(member_id,token_hash,expires_at) VALUES(1,repeat('a',64),clock_timestamp()+interval '1 hour');
   SELECT r4_test_settle('R4-LEGACY');
  `);
  const legacy = await one('SELECT to_jsonb(o) AS value FROM package_payment_orders o');
  const legacyAward = await one('SELECT to_jsonb(l) AS value FROM package_payment_point_ledger l');
  await db.exec(migration);
  assert.equal((await one('SELECT count(*)::int AS n FROM entitlement_online_observations')).n, 0);
  assert.deepEqual(await one('SELECT to_jsonb(l) AS value FROM package_payment_point_ledger l'), legacyAward);
  assert.equal((await one(`SELECT count(*)::int AS n FROM information_schema.role_table_grants
   WHERE table_name='entitlement_online_observations' AND grantee='PUBLIC'`)).n, 0);
  await db.exec("SELECT r4_test_settle('R4-NEW')");
  await db.exec("UPDATE package_payment_orders SET status=status WHERE status='PAID'");
  assert.deepEqual(await one("SELECT to_jsonb(o) AS value FROM package_payment_orders o WHERE trans_ref='R4-LEGACY'"), legacy);
  assert.equal((await one('SELECT count(*)::int AS n FROM entitlement_online_observations')).n, 1);
  assert.equal((await one(`SELECT count(*)::int AS n FROM entitlement_online_observations e
   JOIN package_payment_orders o ON o.id=e.order_id JOIN package_payment_point_ledger l ON l.order_id=e.point_ledger_order_id
   WHERE e.package_snapshot=o.package_snapshot AND e.member_id=l.member_id AND e.points_delta=l.delta
   AND e.confirmed_at=o.confirmed_at AND e.membership_expires_at=o.membership_expires_at`)).n, 1);
  for (const sql of ['UPDATE entitlement_online_observations SET points_delta=0',
   'DELETE FROM entitlement_online_observations', 'TRUNCATE entitlement_online_observations']) await assert.rejects(db.exec(sql), /append-only/);
  await db.exec('BEGIN');
  await db.exec("SELECT r4_test_settle('R4-ROLLBACK')");
  await db.exec('ROLLBACK');
  assert.equal((await one('SELECT count(*)::int AS n FROM entitlement_online_observations')).n, 1);
  assert.equal((await one("SELECT count(*)::int AS n FROM payment_transfer_refs WHERE trans_ref='R4-ROLLBACK'")).n, 0);
  // Hook failure must roll back the finalizer, not leave PAID without audit.
  await db.exec(`CREATE FUNCTION r4_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'R4 injected failure'; END $$;
   CREATE TRIGGER r4_test_failure BEFORE INSERT ON entitlement_online_observations FOR EACH ROW EXECUTE FUNCTION r4_test_fail();`);
  await assert.rejects(db.exec("SELECT r4_test_settle('R4-FAIL')"), /R4 injected failure/);
  assert.equal((await one("SELECT count(*)::int AS n FROM payment_transfer_refs WHERE trans_ref='R4-FAIL'")).n, 0);
  assert.equal((await one('SELECT points FROM members WHERE id=1')).points, 97);
  await db.exec(`DROP TRIGGER r4_test_failure ON entitlement_online_observations;
   CREATE FUNCTION r4_test_bad_award() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.delta:=NEW.delta+1; RETURN NEW; END $$;
   CREATE TRIGGER r4_bad_award BEFORE INSERT ON package_payment_point_ledger FOR EACH ROW EXECUTE FUNCTION r4_test_bad_award();`);
  await assert.rejects(db.exec("SELECT r4_test_settle('R4-BAD-LEDGER')"), /matching original point ledger/);
  assert.equal((await one('SELECT points FROM members WHERE id=1')).points, 97);
  assert.equal((await one('SELECT count(*)::int AS n FROM entitlement_online_observations')).n, 1);
 } finally { await db.close(); }
});
