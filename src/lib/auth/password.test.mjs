import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const filename = fileURLToPath(new URL("./password.ts", import.meta.url));
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = new Module(filename);
loaded.filename = filename;
loaded.require = createRequire(import.meta.url);
loaded._compile(compiled, filename);
const { hashPassword, verifyPassword, PasswordWorkLimitError } = loaded.exports;
test("scrypt passwords are salted, verified and malformed hashes fail closed", async () => {
  const password = "รหัสผ่านปลอดภัย-123";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  for (const invalid of [null, "plaintext", first.replace("32768", "999999999"), first.slice(0, -1)]) {
    assert.equal(await verifyPassword(password, invalid), false);
  }
});

test("scrypt has a runtime-wide concurrency cap without an unbounded queue and releases slots", async () => {
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => hashPassword("safe-password")));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 2);
  const rejected = results.filter(result => result.status === "rejected");
  assert.equal(rejected.length, 6);
  for (const result of rejected) assert.ok(result.reason instanceof PasswordWorkLimitError);
  assert.equal(await verifyPassword("safe-password", results.find(result => result.status === "fulfilled").value), true);
});
