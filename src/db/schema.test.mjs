import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { getTableConfig } from "drizzle-orm/pg-core";

// Load the schema in memory so these tests never connect to or mutate a database.
const filename = fileURLToPath(new URL("./schema.ts", import.meta.url));
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const schemaModule = new Module(filename);
schemaModule.filename = filename;
schemaModule.paths = Module._nodeModulePaths(fileURLToPath(new URL(".", import.meta.url)));
schemaModule.require = require;
schemaModule._compile(compiled, filename);
const { memberRoleEnum, profileGenderEnum, authOtpPurposeEnum, members, otpRequests, authOtpChallenges, authSignupTickets, authSessions } = schemaModule.exports;

function columnNames(table) {
  return getTableConfig(table).columns.map((column) => column.name);
}

test("persisted roles default to MEMBER, without a GUEST role", () => {
  assert.deepEqual(memberRoleEnum.enumValues, ["MEMBER", "ADMIN", "OWNER"]);
  assert.equal(members.role.default, "MEMBER");
  assert.equal(members.role.notNull, true);
  assert.deepEqual(profileGenderEnum.enumValues, ["MALE", "FEMALE", "OTHER"]);
  assert.ok(columnNames(members).includes("emergency_name"));
  assert.ok(columnNames(members).includes("emergency_phone"));
});

test("auth OTP challenges provide hash, attempt limit, expiry and consumption fields", () => {
  const config = getTableConfig(authOtpChallenges);
  assert.equal(config.name, "auth_otp_challenges");
  assert.deepEqual(columnNames(authOtpChallenges), [
    "id", "phone", "challenge_id", "code_hash", "purpose", "attempts", "max_attempts",
    "expires_at", "consumed_at", "created_at",
  ]);
  assert.deepEqual(authOtpPurposeEnum.enumValues, ["LOGIN", "REGISTER"]);
  assert.equal(authOtpChallenges.purpose.default, "LOGIN");
  assert.equal(authOtpChallenges.challengeId.isUnique, true);
  assert.equal(authOtpChallenges.codeHash.notNull, true);
  assert.equal(authOtpChallenges.attempts.default, 0);
  assert.equal(authOtpChallenges.maxAttempts.default, 5);
  assert.equal(authOtpChallenges.expiresAt.notNull, true);
  assert.equal(authOtpChallenges.consumedAt.notNull, false);
  assert.equal(columnNames(authOtpChallenges).includes("otp_code"), false);
  assert.equal(columnNames(otpRequests).includes("otp_code"), true); // legacy remains untouched
});

test("signup tickets store unique hashed one-time tokens with expiry", () => {
  const config = getTableConfig(authSignupTickets);
  assert.equal(config.name, "auth_signup_tickets");
  assert.equal(authSignupTickets.tokenHash.isUnique, true);
  assert.equal(authSignupTickets.expiresAt.notNull, true);
  assert.equal(authSignupTickets.consumedAt.notNull, false);
});

test("sessions store unique token hashes with member FK, expiry and revocation", () => {
  const config = getTableConfig(authSessions);
  assert.equal(config.name, "auth_sessions");
  assert.deepEqual(columnNames(authSessions), [
    "id", "member_id", "token_hash", "expires_at", "revoked_at", "created_at",
  ]);
  assert.equal(authSessions.tokenHash.isUnique, true);
  assert.equal(authSessions.memberId.notNull, true);
  assert.equal(authSessions.expiresAt.notNull, true);
  assert.equal(authSessions.revokedAt.notNull, false);
  assert.equal(config.foreignKeys.length, 1);
  const fk = config.foreignKeys[0].reference();
  assert.equal(fk.foreignTable, members);
  assert.deepEqual(fk.columns, [authSessions.memberId]);
  assert.deepEqual(fk.foreignColumns, [members.id]);
  assert.equal(config.foreignKeys[0].onDelete, "cascade");
});
