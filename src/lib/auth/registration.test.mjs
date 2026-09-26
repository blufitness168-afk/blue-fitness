import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const filename = fileURLToPath(new URL("./registration.ts", import.meta.url));
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const registrationModule = new Module(filename);
registrationModule.filename = filename;
registrationModule.paths = Module._nodeModulePaths(fileURLToPath(new URL(".", import.meta.url)));
registrationModule.require = require;
registrationModule._compile(compiled, filename);
const { registrationSchema } = registrationModule.exports;

const valid = { fullName: "สมชาย ใจดี", gender: "OTHER", birthDay: 29, birthMonth: 2 };

test("registration accepts valid Thai birth dates and defaults optional fields", () => {
  const result = registrationSchema.parse(valid);
  assert.equal(result.fullName, valid.fullName);
  assert.equal(result.nickname, "");
  assert.equal(result.emergencyPhone, "");
});

test("registration rejects invalid profile fields and date bounds", () => {
  assert.equal(registrationSchema.safeParse({ ...valid, fullName: "x" }).success, false);
  assert.equal(registrationSchema.safeParse({ ...valid, gender: "OWNER" }).success, false);
  assert.equal(registrationSchema.safeParse({ ...valid, birthDay: 32 }).success, false);
  assert.equal(registrationSchema.safeParse({ ...valid, birthDay: 31, birthMonth: 4 }).success, false);
  assert.equal(registrationSchema.safeParse({ ...valid, birthMonth: 13 }).success, false);
});
