import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("./policy.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { hasRole, normalizePhone, validCode, validChallengeId, canAttempt } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

test("roles are explicit; MEMBER cannot gain ADMIN or OWNER", () => {
  assert.equal(hasRole("MEMBER", ["ADMIN", "OWNER"]), false);
  assert.equal(hasRole("ADMIN", ["ADMIN", "OWNER"]), true);
  assert.equal(hasRole("OWNER", ["OWNER"]), true);
  assert.equal(hasRole("ADMIN", ["OWNER"]), false);
});

test("phone normalization accepts only Thai mobile numbers", () => {
  assert.equal(normalizePhone("+66 81-234-5678"), "0812345678");
  assert.equal(normalizePhone("0812345678"), "0812345678");
  for (const invalid of ["021234567", "081234567", "08123456789", "08123abc78", null]) assert.equal(normalizePhone(invalid), null);
});

test("OTP inputs and attempts enforce exact length, expiry and lockout", () => {
  assert.equal(validCode("000001"), true);
  assert.equal(validCode("12345"), false);
  assert.equal(validCode("1234567"), false);
  assert.equal(validChallengeId("a".repeat(32)), true);
  assert.equal(validChallengeId("x".repeat(32)), false);
  const now = new Date("2026-01-01T00:00:00Z");
  const later = new Date(now.getTime() + 1000);
  assert.equal(canAttempt(4, 5, later, null, now), true);
  assert.equal(canAttempt(5, 5, later, null, now), false);
  assert.equal(canAttempt(0, 5, now, null, now), false);
  assert.equal(canAttempt(0, 5, later, now, now), false);
});
