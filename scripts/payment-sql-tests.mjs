// Isolated PostgreSQL WASM assertions. Never connects to Neon or a provider.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
if (!process.argv.includes("--run-memory")) {
  console.log("Prepare only. Use --run-memory for isolated in-memory PostgreSQL; no production connection.");
  process.exit(0);
}
const requireTest = createRequire(path.join(root, ".local-db/payment-sql-tests/package.json"));
const { PGlite } = requireTest("@electric-sql/pglite");
const db = new PGlite();
try {
  // Minimal existing-table contract, not a substitute for full production-schema acceptance.
  await db.exec(`
    CREATE TYPE member_status AS ENUM ('PENDING','ACTIVE','EXPIRED','SUSPENDED');
    CREATE TYPE member_role AS ENUM ('MEMBER','ADMIN','OWNER');
    CREATE TABLE members (
      id serial PRIMARY KEY, phone varchar(20) UNIQUE NOT NULL,
      full_name text NOT NULL, member_code varchar(50) UNIQUE NOT NULL,
      status member_status NOT NULL DEFAULT 'PENDING', role member_role NOT NULL DEFAULT 'MEMBER',
      points integer NOT NULL DEFAULT 0, expire_date timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE auth_sessions (
      id serial PRIMARY KEY, member_id integer NOT NULL REFERENCES members(id),
      token_hash varchar(64) NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
      revoked_at timestamptz
    );
    CREATE TABLE payments (id serial PRIMARY KEY, easyslip_trans_ref varchar(100));
  `);
  await db.exec(await readFile(path.join(root, "src/db/migrations/20261009_real_package_payments.sql"), "utf8"));
  await db.exec(await readFile(path.join(root, "src/db/migrations/20261010_payment_promptpay.sql"), "utf8"));
  await db.exec(await readFile(path.join(root, "src/db/migrations/payment-integration.test.sql"), "utf8"));
  await db.exec(`
 BEGIN;
 DO $$
 DECLARE m integer; o uuid := gen_random_uuid(); a uuid := gen_random_uuid(); claimed package_payment_attempts; failed boolean;
 BEGIN
 INSERT INTO members(phone,full_name,member_code,status,role) VALUES('0991111111','ISOLATED OWNER','RECHECK-TEST','ACTIVE','OWNER') RETURNING id INTO m;
 INSERT INTO auth_sessions(member_id,token_hash,expires_at) VALUES(m,repeat('a',64),clock_timestamp()+interval '1 hour');
 INSERT INTO package_payment_orders(id,member_id,request_key,package_snapshot,receiver_snapshot,subtotal_satang,discount_satang,amount_satang,points_earned,created_at,expires_at,upload_deadline)
 VALUES(o,m,gen_random_uuid(),'{}','{"promptpay":"0973355322","bankCode":"004","bankAccount":"0528938965","name":"TEST"}',10000,0,10000,5,now()-interval '2 hours',now()-interval '105 minutes',now()-interval '75 minutes');
 INSERT INTO package_payment_attempts(id,order_id,image_sha256,lease_token,state,rejection_reason,created_at) VALUES(a,o,repeat('f',64),a,'REJECTED','PROVIDER_VALIDATION_FAILED',clock_timestamp()-interval '118 minutes');
 failed:=false;
 BEGIN UPDATE package_payment_attempts SET state='UNKNOWN',rejection_reason=NULL WHERE id=a; EXCEPTION WHEN OTHERS THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Unaudited reopening allowed'; END IF;
 PERFORM prepare_owner_payment_recheck(o,m,repeat('a',64));
 IF (SELECT count(*) FROM package_payment_resolution_audit WHERE action='OWNER_RECHECK' AND order_id=o)<>1 THEN RAISE EXCEPTION 'Missing audit'; END IF;
 SELECT * INTO claimed FROM claim_package_payment_attempt(o,m,repeat('a',64),gen_random_uuid(),repeat('f',64),true);
 IF claimed.state<>'PROCESSING' OR claimed.provider_calls<>2 OR claimed.lease_token=a THEN RAISE EXCEPTION 'Bad recovery lease'; END IF;
 failed:=false;
 BEGIN PERFORM prepare_owner_payment_recheck(o,m,repeat('a',64)); EXCEPTION WHEN OTHERS THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Repeated recovery allowed'; END IF;
 IF EXISTS(SELECT 1 FROM package_payment_point_ledger WHERE order_id=o) OR (SELECT status FROM package_payment_orders WHERE id=o)<>'PENDING' THEN RAISE EXCEPTION 'Recovery granted benefits'; END IF;
 END $$;
 ROLLBACK;
 `);
  const { rows } = await db.query("SELECT (SELECT count(*) FROM members)::int AS members, (SELECT count(*) FROM package_payment_orders)::int AS orders");
  if (rows[0].members !== 0 || rows[0].orders !== 0) throw Error("SQL fixture failed to roll back");
  console.log("PASS: payment migration compiles; SQL transaction fixtures pass and roll back in isolated PostgreSQL WASM.");
  console.log("No Neon, EasySlip, SMS or actual funds involved. Multi-connection locks and full production schema still need acceptance.");
} catch (error) {
  console.error("Isolated payment SQL validation failed:", error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
