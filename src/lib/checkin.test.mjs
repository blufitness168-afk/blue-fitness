import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Compile the domain and shared roster without adding a test runner dependency.
const source = fs.readFileSync(new URL("./checkin.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const adminContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("./admin-mock.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, adminContext);
const context = { exports: {}, Intl, Date, require: () => adminContext.exports };
vm.runInNewContext(output, context);
const { evaluateCheckin, createDemoMembers, parseCheckinRecords, bangkokDay } = context.exports;
const at = (time) => new Date(`2026-09-07T${time}+07:00`);
const members = createDemoMembers(at("09:00:00"));
const scan = (code = "BLU-1001", time = "09:00:00", records = []) => evaluateCheckin(code, members, records, at(time), "USB_MANUAL", "test-id");

test("checkin uses the complete shared admin identity roster while retaining separate eligibility", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(members.map(m => [m.memberCode, m.cardNumber, m.fullName, m.points]))), JSON.parse(JSON.stringify(adminContext.exports.mockAdminMembers.map(m => [m.memberCode, m.cardNumber, m.fullName, m.points]))));
  assert.equal(scan("CARD-1188").status, "success");
  assert.equal(scan("CARD-5522").status, "success");
});

test("normalizes input and accepts both member and physical card IDs", () => {
  for (const code of [" blu-1001 \r\n", "card-8899"]) {
    const result = scan(code);
    assert.equal(result.status, "success");
    assert.equal(result.record.points, 0);
    assert.equal(result.record.memberCode, "BLU-1001");
  }
});
test("rejects unknown, empty, oversized and malformed QR payloads", () => {
  for (const code of ["", "UNKNOWN", "x".repeat(101), '{"memberCode":"BLU-1001"}', "https://example.com/BLU-1001"]) {
    assert.equal(scan(code).status, "error");
    assert.equal(scan(code).record, undefined);
  }
});
test("expired and pending memberships do not get a check-in or points", () => {
  for (const code of ["BLU-1020", "BLU-1025"]) {
    assert.equal(scan(code).status, "error");
    assert.equal(scan(code).record, undefined);
  }
});
test("off-peak accepts exactly 14:00 and warns after the cutoff", () => {
  assert.equal(scan("BLU-1015", "14:00:00").status, "success");
  const result = scan("BLU-1015", "14:00:01");
  assert.equal(result.status, "warning");
  assert.equal(result.record, undefined);
});
test("opening and closing boundaries use Bangkok time", () => {
  for (const time of ["07:00:00", "22:00:00"]) assert.equal(scan("BLU-1001", time).status, "success");
  for (const time of ["06:59:59", "22:00:01"]) assert.equal(scan("BLU-1001", time).status, "warning");
});
test("repeat entry is allowed and never earns check-in points", () => {
  const first = scan().record;
  const repeat = scan("CARD-8899", "10:00:00", [first]);
  assert.equal(repeat.status, "success");
  assert.equal(repeat.record.points, 0);
});
test("next Bangkok day still records entry without awarding points", () => {
  const first = scan().record;
  const next = evaluateCheckin("BLU-1001", members, [first], new Date("2026-09-08T07:00:00+07:00"), "CAMERA", "next");
  assert.equal(next.record.points, 0);
  assert.equal(next.record.source, "CAMERA");
  assert.notEqual(bangkokDay(new Date("2026-09-07T16:59:59Z")), bangkokDay(new Date("2026-09-07T17:00:00Z")));
});
test("expiry is enforced at the exact instant and invalid expiry fails closed", () => {
  for (const expiresAt of [at("09:00:00").toISOString(), "invalid"]) {
    const result = evaluateCheckin("BLU-1001", [{ ...members[0], expiresAt }], [], at("09:00:00"), "CAMERA", "expiry");
    assert.equal(result.status, "error");
  }
});
test("history reader rejects corruption and normalizes legacy check-in points to zero", () => {
  assert.equal(parseCheckinRecords(null).length, 0);
  assert.equal(parseCheckinRecords(JSON.stringify([scan().record])).length, 1);
  const legacy = { ...scan().record, points: 1 };
  assert.equal(parseCheckinRecords(JSON.stringify([legacy]))[0].points, 0);
  assert.equal(parseCheckinRecords(JSON.stringify([scan().record, { ...scan().record, id: "different-id" }])).length, 2);
  for (const raw of ["", "invalid", "{}", "null", '[{"points":100}]', JSON.stringify([{ ...scan().record, checkedAt: "invalid" }]), JSON.stringify([scan().record, scan().record])]) {
    assert.throws(() => parseCheckinRecords(raw));
  }
});
