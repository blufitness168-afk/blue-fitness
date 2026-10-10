import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
const nodeRequire = createRequire(import.meta.url);
function loadPolicy(name) {
 if (!name.startsWith("./")) return nodeRequire(name);
 const exports = {};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(`${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: loadPolicy, Buffer });
 return exports;
}
const policy = loadPolicy("./payment-policy");

function setup(responses = []) {
  const calls = [];
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL("./test-service-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Buffer, Request, Response, File, FormData, URLSearchParams, AbortSignal, process: { env: { SMS_API_KEY: "mock", SMS_API_SECRET: "mock", EASYSLIP_API_KEY: "mock", PAYMENT_PROMPTPAY_MOBILE: "0973355322", PAYMENT_RECEIVER_NAME: "นาย ณัฐนที รุ่งทองใบสุรีย์", PAYMENT_RECEIVER_BANK_CODE: "004", PAYMENT_RECEIVER_BANK_ACCOUNT: "0528938965" } }, require: name => name === "server-only" ? {} : name === "./payment-policy" ? policy : { json: (body, status = 200) => Response.json(body, { status }), readBody: request => request.json() }, fetch: async (url, init) => { calls.push({ url, init }); const next = responses.shift(); if (!next) throw new Error("Unexpected fetch"); return Response.json(next.body, { status: next.status ?? 200 }); } });
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

const v2Balance = { success: true, data: { account: { credit: 0 }, application: { quota: { used: 1, remaining: 999 } }, branch: { quota: { used: 1 } } } };
function v2Request() {
  const form = new FormData();
  form.append("action", "verify-test-slip-v2");
  form.append("confirmed", "true");
  form.append("file", new File([Buffer.from([137,80,78,71,13,10,26,10])], "private-name.png", { type: "image/png" }));
  return new Request("https://local/api/test-services", { method: "POST", body: form });
}
test("v2 uses documented matching fields, exposes only receiver diagnostics and never approves payment", async () => {
  const app = setup([{ body: v2Balance }, { body: { success: true, data: { isDuplicate: true, matchedAccount: { bank: { code: "004" }, bankNumber: "052-8-93896-5", nameTh: "TEST" }, rawSlip: { transRef: "REF-TEST", date: "2026-10-06T20:29:34+07:00", amount: { amount: 25 }, payload: "PRIVATE_QR", sender: { name: "PRIVATE_SENDER" }, receiver: { bank: { id: "004" }, account: { bank: { type: "BANKAC", account: "xxx-x-x3896-x" } } } } } } }, { body: v2Balance }]);
  const result = await (await app.testServiceAction(v2Request())).json();
  assert.equal(result.success, true);
  assert.equal(result.paymentApproved, false);
  assert.equal(result.matchedRegisteredReceiver, true);
  assert.equal(result.isDuplicate, true);
  assert.equal(app.calls[1].url, "https://api.easyslip.com/v2/verify/bank");
  assert.equal(app.calls[1].init.body.get("file"), null);
  assert.equal(app.calls[1].init.body.get("image").name, "slip.png");
  assert.equal(app.calls[1].init.body.get("matchAccount"), "true");
  assert.equal(app.calls[1].init.body.get("checkDuplicate"), "true");
  assert.equal(result.balance.before.branchUsedQuota, 1);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_"));
});
test("v2 success without a matched recipient is a diagnostic success, never a payment approval", async () => {
  const app = setup([{ body: v2Balance }, { body: { success: true, data: { matchedAccount: null, rawSlip: { transRef: "OTHER", amount: { amount: 25 } } } } }, { body: v2Balance }]);
  const result = await (await app.testServiceAction(v2Request())).json();
  assert.equal(result.success, true);
  assert.equal(result.matchedRegisteredReceiver, false);
  assert.equal(result.paymentApproved, false);
});
test("v2 provider errors expose bounded code/message without calling v1 verify", async () => {
  const app = setup([{ body: v2Balance }, { status: 403, body: { success: false, error: { code: "QUOTA_EXCEEDED", message: "no quota" } } }, { body: v2Balance }]);
  const result = await (await app.testServiceAction(v2Request())).json();
  assert.equal(result.success, false);
  assert.equal(result.providerCode, "QUOTA_EXCEEDED");
  assert.equal(result.slip, null);
  assert.equal(app.calls.filter(c => c.url.includes("/verify")).length, 1);
});

test("diagnostic registered PromptPay compares full normalized mobile and name", async () => {
 for (const [number, name, expected] of [["0973355322", "ณัฐนที รุ่งทองใบสุรีย์", true], ["0873355322", "ณัฐนที รุ่งทองใบสุรีย์", false], ["0973355322", "คนอื่น", false]]) {
 const app = setup([{ body: v2Balance }, { body: { success: true, data: { isDuplicate: true, matchedAccount: { bank: { code: "PROMPTPAY" }, bankNumber: number, nameTh: name }, rawSlip: { transRef: "OFFLINE", amount: { amount: 100 }, receiver: { account: { proxy: { type: "MSISDN", account: "XXXXXX5322" } } } } } } }, { body: v2Balance }]);
 const result = await (await app.testServiceAction(v2Request())).json();
 assert.equal(result.matchedRegisteredReceiver, expected);
 assert.equal(result.paymentApproved, false);
 }
});
