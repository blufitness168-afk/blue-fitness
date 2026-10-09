import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";
import { setupMock } from "./mock-test-harness.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
test("new coupons count visits; demo drinks count items; promo remains baht", () => {
  const api = setupMock().load("benefits");
  assert.equal(api.newDefinition("COUPON").unit, "VISITS");
  assert.equal(api.newDefinition("PROMO").unit, "BAHT");
  assert.equal(api.parseBenefits(null).definitions.find(d => d.code === "DRINKFREE").unit, "ITEMS");
});
test("legacy definitions and issued snapshots normalize units without changing quotas, amounts or status", () => {
  const api = setupMock().load("benefits");
  const state = plain(api.parseBenefits(null));
  for (const d of [...state.definitions, ...state.grants.map(g => g.definition)]) if (d.kind === "COUPON") d.unit = "BAHT";
  const normalized = plain(api.parseBenefits(JSON.stringify(state)));
  assert.deepEqual(normalized.grants.map(g => [g.id, g.status, g.definition.amount]), state.grants.map(g => [g.id, g.status, g.definition.amount]));
  assert.equal(normalized.grants.find(g => g.definition.code === "DRINKFREE").definition.unit, "ITEMS");
  const extra = state.definitions.find(d => d.kind === "COUPON");
  extra.benefit = "EXTRA_DAYS"; extra.amount = 5;
  assert.equal(api.parseBenefits(JSON.stringify(state)).definitions.find(d => d.id === extra.id).unit, "DAYS");
});
test("incompatible modern units fail closed", () => {
  const api = setupMock().load("benefits");
  for (const unit of ["PERCENT", "POINTS", "DAYS"]) {
    const state = plain(api.parseBenefits(null));
    state.definitions.find(d => d.kind === "COUPON").unit = unit;
    assert.throws(() => api.parseBenefits(JSON.stringify(state)), /ข้อมูลสิทธิ์/);
  }
});
function serverFixture(token, rows = []) {
  const calls = [];
  const sql = (strings, ...values) => ({ text: strings.join("?"), values });
  sql.transaction = async (queries, options) => { calls.push({ queries, options }); return [rows]; };
  const context = { exports: {}, process: { env: { DATABASE_URL: "offline-test" } }, require(name) {
    if (name === "server-only") return {};
    if (name === "node:crypto") return { createHash };
    if (name === "@neondatabase/serverless") return { neon: () => sql };
    if (name === "next/headers") return { cookies: async () => ({ get: () => token ? { value: token } : undefined }) };
    if (name === "@/lib/auth/server") return { SESSION_COOKIE: "blu_session" };
    if (["drizzle-orm", "@/db", "@/db/schema"].includes(name)) return {};
    throw new Error(name);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("./benefits-server.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { api: context.exports, calls };
}
test("missing/malformed session never executes redemption SQL", async () => {
  for (const token of [undefined, "forged"]) {
    const s = serverFixture(token);
    assert.equal(await s.api.redeemWelcomeEntry(1), null);
    assert.equal(s.calls.length, 0);
  }
});
test("redemption is one serializable statement with owner, session, quota, expiry and checkin predicates", async () => {
  const token = "a".repeat(64);
  const s = serverFixture(token, [{ id: 42, checkin_time: "2026-10-09" }]);
  assert.equal((await s.api.redeemWelcomeEntry(7)).checkinId, 42);
  assert.equal(s.calls.length, 1);
  const { queries, options } = s.calls[0];
  assert.equal(options.isolationLevel, "Serializable");
  assert.equal(queries.length, 1);
  const query = queries[0];
  for (const predicate of ["UPDATE coupons", "INSERT INTO checkins", "FROM consumed", "s.member_id = c.member_id", "s.revoked_at IS NULL", "s.expires_at > now()", "m.status <> 'SUSPENDED'", "c.total_quota = 1", "c.used_count = 0", "c.status = 'AVAILABLE'", "interval '30 days'", "c.expire_date > now()", "WELCOME_REGISTRATION", "FREE_ENTRY"]) assert.ok(query.text.includes(predicate), predicate);
  assert.deepEqual(plain(query.values), [7, createHash("sha256").update(token).digest("hex")]);
  assert.equal(await serverFixture(token).api.redeemWelcomeEntry(7), null);
});
