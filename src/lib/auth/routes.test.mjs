import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Module } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function loadRoute(relative, server = {}) {
  const filename = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.require = name => {
    if (name === "@/lib/auth/http") return {
      readBody: async request => request.body,
      json: (body, status = 200) => ({ body, status, cookieWrites: [], cookies: { set() { throw new Error("OTP must never create a session cookie"); } } }),
    };
    if (name === "@/lib/auth/policy") return {
      validChallengeId: value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value),
      validCode: value => typeof value === "string" && /^\d{6}$/.test(value),
    };
    if (name === "@/lib/auth/server") return server;
    throw new Error(`Unexpected dependency ${name}`);
  };
  loaded._compile(compiled, filename);
  return loaded.exports;
}

test("legacy LOGIN OTP request is permanently closed without sending SMS", async () => {
  const route = loadRoute("../../app/api/auth/request/route.ts");
  assert.equal((await route.POST({ body: { phone: "0891234567" } })).status, 410);
});

test("OTP verification returns a scoped ticket and never writes a session", async () => {
  for (const purpose of ["REGISTER", "PASSWORD_SETUP", "PASSWORD_RESET"]) {
    const route = loadRoute("../../app/api/auth/verify/route.ts", { verifyOtp: async () => ({ purpose, ticket: "b".repeat(64) }) });
    const response = await route.POST({ body: { challengeId: "a".repeat(32), code: "123456" } });
    assert.equal(response.status, 200);
    assert.equal(response.body.purpose, purpose);
    assert.equal(response.body.ticket, "b".repeat(64));
    assert.deepEqual(response.cookieWrites, []);
  }
});

test("OTP verification rejects malformed, consumed or expired challenges", async () => {
  let calls = 0;
  const route = loadRoute("../../app/api/auth/verify/route.ts", { verifyOtp: async () => { calls++; return null; } });
  assert.equal((await route.POST({ body: { challengeId: "bad", code: "123456" } })).status, 400);
  assert.equal(calls, 0);
  assert.equal((await route.POST({ body: { challengeId: "a".repeat(32), code: "123456" } })).status, 401);
  assert.equal(calls, 1);
});
