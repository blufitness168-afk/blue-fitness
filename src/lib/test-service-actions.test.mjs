import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function setup(responses = []) {
  const calls = [];
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL("./test-service-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Buffer, Request, Response, File, FormData, URLSearchParams, AbortSignal, process: { env: { SMS_API_KEY: "mock", SMS_API_SECRET: "mock", EASYSLIP_API_KEY: "mock" } }, require: name => name === "server-only" ? {} : { json: (body, status = 200) => Response.json(body, { status }), readBody: request => request.json() }, fetch: async (url, init) => { calls.push({ url, init }); const next = responses.shift(); if (!next) throw new Error("Unexpected fetch"); return Response.json(next.body, { status: next.status ?? 200 }); } });
  return { ...exports, calls };
}
const sms = body => new Request("https://local/api/test-services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("rejects invalid phones and missing consent without provider calls", async () => {
  for (const body of [{ action: "send-test-sms", phone: "0812345678" }, { action: "send-test-sms", phone: "0812345678,0899999999", confirmed: true }]) {
    const app = setup();
    assert.equal((await app.testServiceAction(sms(body))).status, 400);
    assert.equal(app.calls.length, 0);
  }
});

test("SMS uses v2 form and compares both credit pools with mocked fetch", async () => {
  const app = setup([{ body: { remaining_credit: { standard: 5, corporate: 10 } } }, { body: { status: "success" } }, { body: { remaining_credit: { standard: 4, corporate: 10 } } }]);
  const result = await (await app.testServiceAction(sms({ action: "send-test-sms", phone: "0812345678", confirmed: true }))).json();
  assert.equal(result.success, true);
  assert.equal(result.balance.delta.standard, -1);
  assert.equal(result.balance.delta.corporate, 0);
  assert.equal(app.calls[1].url, "https://api-v2.thaibulksms.com/sms");
  assert.equal(app.calls[1].init.body.get("msisdn"), "0812345678");
  assert.ok(app.calls.every(call => call.init.signal));
});

test("rejects spoofed image without provider calls", async () => {
  const app = setup();
  const form = new FormData();
  form.append("action", "verify-test-slip"); form.append("confirmed", "true");
  form.append("file", new File(["not png"], "slip.png", { type: "image/png" }));
  assert.equal((await app.testServiceAction(new Request("https://local/api/test-services", { method: "POST", body: form }))).status, 400);
  assert.equal(app.calls.length, 0);
});

test("EasySlip image verify requires body status 200; HTTP 400 is not authorization", async () => {
  const app = setup([{ body: { status: 200, data: { currentCredit: 10, usedQuota: 0, remainingQuota: 5 } } }, { status: 400, body: { status: 400, message: "invalid_image" } }, { body: { status: 200, data: { currentCredit: 10, usedQuota: 0, remainingQuota: 5 } } }]);
  const form = new FormData(); form.append("action", "verify-test-slip"); form.append("confirmed", "true");
  form.append("file", new File([Buffer.from([137,80,78,71,13,10,26,10])], "slip.png", { type: "image/png" }));
  const result = await (await app.testServiceAction(new Request("https://local/api/test-services", { method: "POST", body: form }))).json();
  assert.equal(result.success, false);
  assert.equal(app.calls[1].url, "https://api.easyslip.com/v1/verify");
  assert.equal(app.calls[1].init.body.get("checkDuplicate"), "false");
  assert.equal(result.balance.delta.currentCredit, 0);
});
