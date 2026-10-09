import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const filename = fileURLToPath(new URL("./server.ts", import.meta.url));
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ticket = "a".repeat(64);
const profile = { password: "strong-password", fullName: "สมาชิกใหม่", gender: "OTHER", birthDay: 1, birthMonth: 1 };

// Mock only DB/crypto adapters; assert emitted SQL guards as well as execution order.
// These tests do not execute PostgreSQL and never contact a database or SMS provider.
function loadServer(execute, hash = async () => "hashed-password") {
  const calls = [];
  const sql = (strings, ...values) => {
    const query = { text: strings.join("?"), values };
    return { query, then: (resolve, reject) => run(query, null).then(resolve, reject) };
  };
  async function run(query, options) {
    calls.push({ ...query, options });
    return execute(query, options);
  }
  sql.transaction = async (queries, options) => Promise.all(queries.map(item => run(item.query, options)));
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.require = name => {
    if (name === "server-only" || name === "@/db" || name === "@/db/schema" || name === "next/headers" || name === "./policy") return {};
    if (name === "@neondatabase/serverless") return { neon: () => sql };
    if (name === "./password") return { hashPassword: hash };
    return require(name);
  };
  loaded._compile(compiled, filename);
  process.env.DATABASE_URL = "postgresql://mock-only";
  process.env.SMS_API_SECRET = "mock-only";
  process.env.SMS_API_KEY = "mock-only";
  process.env.SMS_SENDER_NAME = "mock-only";
  return { api: loaded.exports, calls };
}

test("invalid, expired, consumed and wrong-scope tickets never run scrypt", async () => {
  for (const operation of ["password", "registration"]) {
    let hashes = 0;
    const { api, calls } = loadServer(query => {
      assert.match(query.text, /UPDATE auth_(password|signup)_tickets.*SET hash_started_at/s);
      assert.match(query.text, /consumed_at IS NULL/);
      assert.match(query.text, /expires_at > now\(\)/);
      assert.match(query.text, /hash_started_at IS NULL/);
      if (operation === "password") {
        assert.match(query.text, /t\.purpose =/);
        assert.match(query.text, /m\.password_hash IS NOT DISTINCT FROM t\.password_hash_at_issue/);
      }
      return [];
    }, async () => { hashes++; return "hash"; });
    const result = operation === "password" ? await api.completePassword(ticket, "PASSWORD_RESET", "password") : await api.completeRegistration(ticket, profile);
    assert.equal(result, operation === "password" ? false : null);
    assert.equal(hashes, 0);
    assert.equal(calls.length, 1);
  }
});

test("concurrent replay of one valid ticket claims at most one hash job", async () => {
  for (const operation of ["password", "registration"]) {
    let claimed = false;
    let hashes = 0;
    const { api, calls } = loadServer(query => {
      if (query.text.includes("SET hash_started_at")) {
        if (claimed) return [];
        claimed = true; return [{ id: 7 }];
      }
      assert.match(query.text, /hash_started_at IS NOT NULL/);
      assert.match(query.text, /consumed_at IS NULL AND expires_at > now\(\)/);
      return operation === "password" ? [{ id: 1 }] : [{ member_id: 1 }];
    }, async () => { hashes++; await new Promise(resolve => setTimeout(resolve, 5)); return "hash"; });
    const complete = () => operation === "password" ? api.completePassword(ticket, "PASSWORD_RESET", "password") : api.completeRegistration(ticket, profile);
    const results = await Promise.all([complete(), complete(), complete()]);
    assert.equal(hashes, 1);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(calls.filter(call => call.text.includes("WITH consumed")).length, 1);
  }
});

test("completion rechecks credential and expiry after hashing and atomically revokes recovery credentials", async () => {
  const { api } = loadServer((query, options) => {
    if (query.text.includes("SET hash_started_at")) return [{ id: 7 }];
    assert.equal(options.isolationLevel, "Serializable");
    assert.match(query.text, /members\.password_hash IS NOT DISTINCT FROM c\.password_hash_at_issue/);
    assert.match(query.text, /expires_at > now\(\)/);
    assert.match(query.text, /UPDATE auth_sessions SET revoked_at/);
    assert.match(query.text, /UPDATE auth_otp_challenges SET consumed_at/);
    assert.match(query.text, /purpose IN \('PASSWORD_SETUP', 'PASSWORD_RESET'\)/);
    assert.match(query.text, /UPDATE auth_password_tickets SET consumed_at/);
    assert.match(query.text, /id <>/); // Do not update the consumed ticket twice in a CTE.
    return []; // Credential changed or ticket expired during scrypt.
  });
  assert.equal(await api.completePassword(ticket, "PASSWORD_RESET", "password"), false);
});

test("OTP issuance stores the credential snapshot in its serializable reservation without sending SMS", async () => {
  const { api } = loadServer((query, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    assert.match(query.text, /INSERT INTO auth_otp_challenges .*password_hash_at_issue/s);
    assert.match(query.text, /SELECT password_hash FROM members WHERE phone =/);
    return []; // No reservation, therefore no provider call.
  });
  assert.equal(await api.sendOtp("0891234567", "PASSWORD_RESET"), null);
});

test("verification carries issuance snapshot, checks current credential and only returns inserted tickets", async () => {
  const { api } = loadServer((query, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    assert.match(query.text, /m\.password_hash IS NOT DISTINCT FROM c\.password_hash_at_issue/);
    assert.match(query.text, /SELECT v\.phone, v\.purpose, v\.password_hash_at_issue/);
    assert.doesNotMatch(query.text, /SELECT v\.phone, v\.purpose, m\.password_hash/);
    assert.match(query.text, /m\.password_hash IS NOT DISTINCT FROM v\.password_hash_at_issue/);
    assert.match(query.text, /SELECT purpose FROM signup UNION ALL SELECT purpose FROM password/);
    return []; // Old issuance credential no longer matches.
  });
  assert.equal(await api.verifyOtp("b".repeat(32), "123456"), null);
});

test("concurrent verify/reset serialization conflict fails closed without issuing a ticket", async () => {
  const { api } = loadServer(() => { throw Object.assign(new Error("serialization conflict"), { code: "40001" }); });
  await assert.rejects(api.verifyOtp("b".repeat(32), "123456"), { code: "40001" });
});

test("registration keeps final atomic consume when a prechecked ticket expires during hashing", async () => {
  let hashes = 0;
  const { api } = loadServer(query => {
    if (query.text.includes("SET hash_started_at")) return [{ id: 7 }];
    assert.match(query.text, /UPDATE auth_signup_tickets SET consumed_at/);
    assert.match(query.text, /hash_started_at IS NOT NULL AND consumed_at IS NULL AND expires_at > now\(\)/);
    assert.match(query.text, /INSERT INTO members/);
    assert.match(query.text, /INSERT INTO coupons/);
    assert.match(query.text, /INSERT INTO auth_sessions/);
    return [];
  }, async () => { hashes++; return "hash"; });
  assert.equal(await api.completeRegistration(ticket, profile), null);
  assert.equal(hashes, 1);
});
