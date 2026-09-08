import { test } from "node:test";
import assert from "node:assert/strict";
import { setupMock } from "./mock-test-harness.mjs";
const json = value => JSON.parse(JSON.stringify(value));
const DAY = 86400000;
const packageFor = s => s.load("mock-data").mockPackages.find(p => p.id === 7);
async function extraFixture() {
  const s = await fixture();
  const d = { ...s.definition, benefit: "EXTRA_DAYS", amount: 5 };
  await s.saveDefinition(d, s.definition);
  s.definition = d;
  const [g] = await issue(s);
  return { ...s, coupon: g };
}
async function fixture(kind = "COUPON", options = {}) {
  const s = setupMock(options);
  const api = s.load("benefits");
  const definition = { ...api.newDefinition(kind), name: "สิทธิ์ทดสอบ", code: "TEST-01", amount: kind === "PROMO" ? 100 : 1, quota: 100 };
  if (options.locks !== false) await api.saveDefinition(definition, null);
  return { ...s, ...api, definition, admin: s.load("admin-mock") };
}
async function issue(s, codes = ["BLU-1001"], mode = "SELECTED") {
  const plan = s.previewGrant(s.definition.id, codes, mode);
  await s.commitGrant(plan);
  return s.readBenefits().grants;
}

test("v1 membership defaults and Bangkok end-of-day defaults are backwards compatible", async () => {
  const s = await fixture();
  const old = json(s.readBenefits()); delete old.memberships;
  assert.deepEqual(json(s.parseBenefits(JSON.stringify(old)).memberships), []);
  assert.equal(s.readMembership("BLU-1001"), null);
  assert.equal(s.newDefinition("COUPON").expiresAt, "2026-10-07T23:59:59+07:00");
  s.clock.now = Date.parse("2026-12-31T20:00:00Z");
  assert.equal(s.newDefinition("PROMO").expiresAt, "2027-01-31T23:59:59+07:00");
});
test("package purchase creates real membership, stacks active/expired dates and never invents friend coupons", async () => {
  const s = await fixture(); const pkg = packageFor(s);
  const start = s.clock.now; const writes = s.writes.length;
  await s.purchaseMockPackage("BLU-1001", pkg, null);
  assert.equal(s.writes.length, writes + 1);
  assert.deepEqual(json(s.readMembership("BLU-1001")), {
    memberCode: "BLU-1001", startedAt: new Date(start).toISOString(), expiresAt: new Date(start + 30 * DAY).toISOString(),
    name: pkg.name, timeSlot: pkg.timeSlot, totalDays: 30, friendCouponsLeft: 0,
  });
  assert.equal(s.readMembership("BLU-1012"), null);
  s.clock.now += DAY;
  await s.purchaseMockPackage("BLU-1001", pkg, null);
  assert.equal(Date.parse(s.readMembership("BLU-1001").expiresAt), start + 60 * DAY);
  s.clock.now = start + 100 * DAY;
  await s.purchaseMockPackage("BLU-1001", pkg, null);
  const m = s.readMembership("BLU-1001");
  assert.equal(Date.parse(m.expiresAt), s.clock.now + 30 * DAY);
  assert.equal(m.totalDays, 90); assert.equal(m.startedAt, new Date(start).toISOString());
  assert.equal(setupMock({ storage: s.storage }).load("benefits").readMembership("BLU-1001").expiresAt, m.expiresAt);
});
test("canonical package fields, member, assigned promo subtotal and totals cannot be forged", async () => {
  const s = await fixture("PROMO"); const pkg = packageFor(s); const [g] = await issue(s);
  const p = s.previewMockPayment(g.code, g.memberCode, pkg.price);
  const before = s.storage.get(s.BENEFITS_KEY);
  for (const key of ["id", "price", "name", "timeSlot", "durationDays", "bonusDays", "friendCoupons"]) {
    await assert.rejects(s.purchaseMockPackage(g.memberCode, { ...pkg, [key]: typeof pkg[key] === "number" ? -1 : "forged" }, p));
  }
  for (const changes of [{ memberCode: "BLU-1012" }, { subtotal: pkg.price + 1 }, { total: 0 }, { paymentId: "invalid" }, { grantCode: "FREE5" }]) {
    await assert.rejects(s.purchaseMockPackage(g.memberCode, pkg, { ...p, ...changes }));
  }
  await assert.rejects(s.purchaseMockPackage("BLU-1012", pkg, p));
  await assert.rejects(s.purchaseMockPackage("BLU-99999", pkg, null));
  assert.equal(s.storage.get(s.BENEFITS_KEY), before);
});
test("purchase consumes promo and creates membership atomically once; failed storage consumes neither", async () => {
  const s = await fixture("PROMO"); const pkg = packageFor(s); const [g] = await issue(s);
  const p = s.previewMockPayment(g.code, g.memberCode, pkg.price);
  const before = s.storage.get(s.BENEFITS_KEY), events = s.events.length;
  s.failures.write = true;
  await assert.rejects(s.purchaseMockPackage(g.memberCode, pkg, p), /บันทึก/);
  assert.equal(s.storage.get(s.BENEFITS_KEY), before); assert.equal(s.events.length, events);
  s.failures.write = false;
  const writes = s.writes.length;
  const results = await Promise.allSettled([s.purchaseMockPackage(g.memberCode, pkg, p), s.purchaseMockPackage(g.memberCode, pkg, p)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(s.writes.length, writes + 1);
  assert.equal(s.readBenefits().grants[0].paidAmount, pkg.price - 100);
  assert.equal(s.readMembership(g.memberCode).totalDays, 30);
  const reload = setupMock({ storage: s.storage }).load("benefits");
  await assert.rejects(reload.purchaseMockPackage(g.memberCode, pkg, p), /ใช้แล้ว/);
});
test("purchase captures inputs and re-quotes expiry, suspension and revisions under lock", async () => {
  for (const change of ["inputs", "expiry", "disable", "revision"]) {
    const s = await fixture("PROMO"); const pkg = { ...packageFor(s) }; const [g] = await issue(s);
    const p = s.previewMockPayment(g.code, g.memberCode, pkg.price);
    if (change === "disable") await s.removeDefinition(s.definition);
    if (change === "revision") await s.purchaseMockPackage("BLU-1012", pkg, null);
    const release = s.holdLock(s.BENEFITS_KEY);
    const work = s.purchaseMockPackage(g.memberCode, pkg, p);
    if (change === "inputs") { pkg.durationDays = 999; p.total = 0; }
    if (change === "expiry") s.clock.now = Date.parse(g.definition.expiresAt);
    release();
    if (change === "inputs") { await work; assert.equal(s.readMembership(g.memberCode).totalDays, 30); }
    else { await assert.rejects(work); assert.equal(s.readMembership(g.memberCode), null); assert.equal(s.readBenefits().grants[0].status, "UNUSED"); }
  }
});
test("EXTRA_DAYS requires own membership, including after reload; failure never consumes coupon", async () => {
  const s = await extraFixture();
  await s.purchaseMockPackage("BLU-1012", packageFor(s), null);
  const before = s.storage.get(s.BENEFITS_KEY);
  await assert.rejects(s.redeemCoupon(s.coupon), /แพ็กเกจ/);
  assert.equal(s.storage.get(s.BENEFITS_KEY), before);
  assert.equal(s.readBenefits().grants[0].status, "UNUSED");
  assert.equal(s.readMembership("BLU-1012").totalDays, 30);
});
test("EXTRA_DAYS atomically extends active or expired membership and rejects concurrent/reloaded replay", async () => {
  for (const expired of [false, true]) {
    const s = await extraFixture();
    await s.purchaseMockPackage(s.coupon.memberCode, s.load("mock-data").mockPackages[0], null);
    const prior = s.readMembership(s.coupon.memberCode);
    if (expired) s.clock.now += 2 * DAY;
    const before = s.storage.get(s.BENEFITS_KEY), events = s.events.length;
    s.failures.write = true;
    await assert.rejects(s.redeemCoupon(s.coupon), /บันทึก/);
    assert.equal(s.storage.get(s.BENEFITS_KEY), before); assert.equal(s.events.length, events);
    s.failures.write = false;
    const writes = s.writes.length;
    const results = await Promise.allSettled([s.redeemCoupon(s.coupon), s.redeemCoupon(s.coupon)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(s.writes.length, writes + 1);
    const m = s.readMembership(s.coupon.memberCode);
    assert.equal(Date.parse(m.expiresAt), Math.max(s.clock.now, Date.parse(prior.expiresAt)) + 5 * DAY);
    assert.equal(m.totalDays, 6); assert.equal(m.friendCouponsLeft, 0);
    assert.equal(m.startedAt, prior.startedAt); assert.equal(m.name, prior.name);
    const reload = setupMock({ storage: s.storage }).load("benefits");
    await assert.rejects(reload.redeemCoupon(s.coupon), /ใช้แล้ว/);
  }
});
test("EXTRA_DAYS cap rejects old oversized definitions and issued snapshots without migration/reset", async () => {
  const s = await extraFixture();
  await s.saveDefinition({ ...s.definition, amount: 3650 }, s.definition);
  await assert.rejects(s.saveDefinition({ ...s.definition, amount: 3651 }, { ...s.definition, amount: 3650 }), /3650/);
  for (const target of ["definition", "grant"]) {
    const old = json(s.readBenefits()); delete old.memberships;
    (target === "definition" ? old.definitions[0] : old.grants[0].definition).amount = 3651;
    assert.throws(() => s.parseBenefits(JSON.stringify(old)), /เสียหาย/);
  }
});
test("invalid or duplicate membership data fails closed before coupon consumption", async () => {
  const s = await extraFixture(); await s.purchaseMockPackage(s.coupon.memberCode, packageFor(s), null);
  const valid = json(s.readBenefits());
  for (const mutate of [
    x => x.memberships.push(x.memberships[0]), x => { x.memberships[0].expiresAt = "bad"; },
    x => { x.memberships[0].totalDays = 0; }, x => { x.memberships[0].friendCouponsLeft = -1; },
    x => { x.memberships[0].timeSlot = "ALL"; }, x => { x.memberships[0].expiresAt = x.memberships[0].startedAt; },
  ]) {
    const state = json(valid); mutate(state); const raw = JSON.stringify(state); s.storage.set(s.BENEFITS_KEY, raw);
    await assert.rejects(s.redeemCoupon(s.coupon), /เสียหาย/);
    assert.equal(s.storage.get(s.BENEFITS_KEY), raw);
  }
});

test("CRUD creates, edits, reads and deletes only never-issued definitions", async () => {
  for (const kind of ["PROMO", "COUPON"]) {
    const s = await fixture(kind);
    const edited = { ...s.definition, name: "แก้ไข", amount: 2 };
    await s.saveDefinition(edited, s.definition);
    assert.equal(s.readBenefits().definitions[0].name, "แก้ไข");
    await assert.rejects(s.saveDefinition(s.definition, s.definition), /เปลี่ยน/);
    assert.equal(await s.removeDefinition(edited), "DELETED");
    assert.equal(s.readBenefits().definitions.length, 0);
  }
});
test("CRUD validation rejects invalid amounts, duplicate codes, dates and quotas", async () => {
  const s = await fixture("PROMO");
  for (const changes of [{ name: " " }, { code: "x x" }, { expiresAt: "bad" }, { amount: -1 }, { amount: 0 }, { amount: 101, discountType: "PERCENT" }, { amount: 1.5 }, { quota: 0 }, { minSpend: -1 }]) {
    await assert.rejects(s.saveDefinition({ ...s.definition, ...changes }, s.definition));
  }
  await assert.rejects(s.saveDefinition({ ...s.newDefinition("PROMO"), name: "อื่น", code: s.definition.code }, null), /ซ้ำ/);
  assert.equal(s.readBenefits().definitions.length, 1);
});
test("physical card/member code share the roster and selected multiselect deduplicates before preview", async () => {
  const s = await fixture();
  assert.equal(s.resolveBenefitMember(" card-1188 \r\n").memberCode, "BLU-1012");
  for (const code of ["BLU-99999", "BLU-RW-2-DEMO01", "BLU-CP-DEMO01", "https://host/BLU-1001", ""]) assert.throws(() => s.resolveBenefitMember(code));
  assert.throws(() => s.previewGrant(s.definition.id, [], "SELECTED"));
  assert.throws(() => s.previewGrant(s.definition.id, ["CARD-8899"], "SELECTED"));
  const p = s.previewGrant(s.definition.id, ["BLU-1001", "BLU-1001", "BLU-1012"], "SELECTED");
  assert.equal(p.newCodes.length, 2);
  assert.equal(s.readBenefits().grants.length, 0);
  assert.equal(await s.commitGrant(p), 2);
  const grants = s.readBenefits().grants;
  assert.equal(grants.length, 2);
  assert.ok(grants.every(g => g.status === "UNUSED" && g.usedAt === undefined));
});
test("ambiguous cards fail closed instead of choosing an arbitrary member", async () => {
  const s = await fixture();
  s.admin.mockAdminMembers[1].cardNumber = "CARD-8899";
  assert.throws(() => s.resolveBenefitMember("CARD-8899"), /กำกวม/);
});

test("ALL takes current roster snapshot, not search results or future users; includes every status", async () => {
  const s = await fixture();
  const p = s.previewGrant(s.definition.id, ["BLU-1001"], "ALL");
  assert.deepEqual(json(p.memberCodes), json(s.admin.mockAdminMembers.map(m => m.memberCode)));
  const count = p.memberCodes.length;
  s.admin.mockAdminMembers.push({ id: 999, memberCode: "BLU-9999", cardNumber: "CARD-9999", fullName: "สมาชิกใหม่", points: 0 });
  assert.equal(await s.commitGrant(p), count);
  assert.equal(s.readBenefits().grants.length, count);
  assert.ok(!s.readBenefits().grants.some(g => g.memberCode === "BLU-9999"));
  assert.equal(s.readBenefits().batches[0].mode, "ALL");
});
test("mixed existing recipients are explicitly skipped; no duplicate even after coupon is used", async () => {
  const s = await fixture();
  const [g] = await issue(s);
  await s.redeemCoupon(s.previewCoupon(g.code));
  const p = s.previewGrant(s.definition.id, ["BLU-1001", "BLU-1012"], "SELECTED");
  assert.equal(p.skipped, 1); assert.deepEqual(json(p.newCodes), ["BLU-1012"]);
  await s.commitGrant(p);
  assert.throws(() => s.previewGrant(s.definition.id, ["BLU-1001", "BLU-1012"], "SELECTED"), /ได้รับ.*แล้ว/);
  assert.equal(s.readBenefits().grants.length, 2);
});
test("duplicate and concurrent commits write one grant batch, replay survives reload", async () => {
  const s = await fixture();
  const p = s.previewGrant(s.definition.id, ["BLU-1001"], "SELECTED");
  const results = await Promise.allSettled([s.commitGrant(p), s.commitGrant(p)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const reload = setupMock({ storage: s.storage }).load("benefits");
  await assert.rejects(reload.commitGrant(p), /บันทึกแล้ว/);
  assert.throws(() => reload.previewGrant(s.definition.id, ["BLU-1001"], "SELECTED"), /ได้รับ.*แล้ว/);
  assert.equal(reload.readBenefits().batches.length, 1);
});
test("latest revision and recipient count are revalidated under lock; stale previews never silently expand", async () => {
  const s = await fixture();
  const first = s.previewGrant(s.definition.id, ["BLU-1001"], "SELECTED");
  const second = s.previewGrant(s.definition.id, ["BLU-1012"], "SELECTED");
  await s.commitGrant(first);
  await assert.rejects(s.commitGrant(second), /ข้อมูลเปลี่ยน/);
  const changed = s.previewGrant(s.definition.id, ["BLU-1012"], "SELECTED");
  await s.saveDefinition({ ...s.definition, name: "เงื่อนไขใหม่" }, s.definition);
  await assert.rejects(s.commitGrant(changed), /ข้อมูลเปลี่ยน/);
  assert.equal(s.readBenefits().grants.length, 1);
});
test("queued grant captures caller plan and rereads storage corruption before writing", async () => {
  const s = await fixture();
  const p = s.previewGrant(s.definition.id, ["BLU-1001"], "SELECTED");
  const release = s.holdLock(s.BENEFITS_KEY);
  const work = s.commitGrant(p);
  p.memberCodes.push("BLU-1012");
  release();
  assert.equal(await work, 1);
  assert.equal(s.readBenefits().grants[0].memberCode, "BLU-1001");
  const next = s.previewGrant(s.definition.id, ["BLU-1012"], "SELECTED");
  const unlock = s.holdLock(s.BENEFITS_KEY);
  const queued = s.commitGrant(next);
  s.storage.set(s.BENEFITS_KEY, "corrupt");
  unlock();
  await assert.rejects(queued, /เสียหาย/);
  assert.equal(s.storage.get(s.BENEFITS_KEY), "corrupt");
});

test("quota is checked before confirmation and cannot shrink below issued count", async () => {
  const s = await fixture();
  const d = { ...s.definition, quota: 1 };
  await s.saveDefinition(d, s.definition); s.definition = d;
  assert.throws(() => s.previewGrant(d.id, [], "ALL"), /โควต้า/);
  await issue(s);
  assert.throws(() => s.previewGrant(d.id, ["BLU-1012"], "SELECTED"), /โควต้า/);
  await assert.rejects(s.saveDefinition({ ...d, quota: 0 }, d));
});
test("expired or disabled definitions cannot grant, including expiry while waiting for lock", async () => {
  for (const kind of ["PROMO", "COUPON"]) {
    const s = await fixture(kind);
    const p = s.previewGrant(s.definition.id, ["BLU-1001"], "SELECTED");
    const release = s.holdLock(s.BENEFITS_KEY);
    const commit = s.commitGrant(p);
    s.clock.now = Date.parse(s.definition.expiresAt);
    release();
    await assert.rejects(commit, /หมดอายุ/);
    assert.equal(s.readBenefits().grants.length, 0);
    await s.saveDefinition({ ...s.definition, active: false }, s.definition);
    assert.throws(() => s.previewGrant(s.definition.id, ["BLU-1001"], "SELECTED"), /ปิดใช้งาน/);
  }
});
test("coupon issue and redeem are separate, confirmation verifies snapshot and prevents replay", async () => {
  const s = await fixture();
  const [g] = await issue(s);
  const before = s.storage.get(s.BENEFITS_KEY);
  const preview = s.previewCoupon(g.code.toLowerCase());
  assert.equal(s.storage.get(s.BENEFITS_KEY), before);
  await assert.rejects(s.redeemCoupon({ ...preview, memberName: "เปลี่ยนชื่อ" }), /เปลี่ยน/);
  const results = await Promise.allSettled([s.redeemCoupon(preview), s.redeemCoupon(preview)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(s.readBenefits().grants[0].usedAt, new Date(s.clock.now).toISOString());
  assert.throws(() => s.previewCoupon(g.code), /ใช้แล้ว/);
  assert.ok(s.writes.every(key => key === s.BENEFITS_KEY));
});
test("coupon redemption expiry checked again at exact boundary inside queued lock", async () => {
  const s = await fixture();
  const [g] = await issue(s);
  const p = s.previewCoupon(g.code);
  const release = s.holdLock(s.BENEFITS_KEY);
  const redeem = s.redeemCoupon(p);
  s.clock.now = Date.parse(g.definition.expiresAt);
  release();
  await assert.rejects(redeem, /หมดอายุ/);
  assert.equal(s.readBenefits().grants[0].status, "UNUSED");
  assert.throws(() => s.previewCoupon("BLU-CP-DEMO01"), /ไม่พบ/);
});
test("issued definitions soft-disable even before use; immutable granted terms survive edits", async () => {
  const s = await fixture();
  const [g] = await issue(s);
  const edited = { ...s.definition, name: "ชื่อใหม่", amount: 5, expiresAt: "2099-01-01T00:00:00Z" };
  await s.saveDefinition(edited, s.definition);
  assert.equal(s.previewCoupon(g.code).definition.amount, 1);
  assert.equal(s.previewCoupon(g.code).definition.name, s.definition.name);
  assert.equal(await s.removeDefinition(edited), "DISABLED");
  assert.equal(s.readBenefits().definitions.length, 1);
  assert.equal(s.readBenefits().grants.length, 1);
  assert.throws(() => s.previewCoupon(g.code), /ระงับ/);
});
test("promo assignment does not count as usage; quote/cancel has no write; payment records usage atomically once", async () => {
  const s = await fixture("PROMO");
  const [g] = await issue(s);
  assert.equal(g.status, "UNUSED"); assert.equal(g.paymentId, undefined);
  const before = s.storage.get(s.BENEFITS_KEY);
  const p = s.previewMockPayment(g.code, g.memberCode, 1000);
  assert.equal(p.discount, 100); assert.equal(p.total, 900);
  assert.equal(s.storage.get(s.BENEFITS_KEY), before);
  assert.throws(() => s.previewCoupon(g.code), /ไม่พบ/);
  assert.throws(() => s.previewMockPayment(g.code, "BLU-1012", 1000), /ไม่ได้แจก/);
  const results = await Promise.allSettled([s.completeMockPayment(p), s.completeMockPayment(p)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const used = s.readBenefits().grants[0];
  assert.equal(used.status, "USED"); assert.equal(used.paymentId, p.paymentId); assert.equal(used.paidAmount, 900);
  assert.throws(() => s.previewGrant(s.definition.id, [g.memberCode], "SELECTED"), /ได้รับ.*แล้ว/);
  assert.ok(s.writes.every(key => key === s.BENEFITS_KEY));
});
test("promo percent/fixed limits and minimum spend are enforced without negative totals", async () => {
  const s = await fixture("PROMO");
  const d = { ...s.definition, discountType: "PERCENT", amount: 25, minSpend: 100 };
  await s.saveDefinition(d, s.definition);
  const [g] = await issue(s);
  assert.throws(() => s.previewMockPayment(g.code, g.memberCode, 99), /ขั้นต่ำ/);
  assert.throws(() => s.previewMockPayment(g.code, g.memberCode, 100.5), /ไม่ถูกต้อง/);
  assert.equal(s.previewMockPayment(g.code, g.memberCode, 101).discount, 25);
  const fixed = await fixture("PROMO");
  const [f] = await issue(fixed);
  assert.equal(fixed.previewMockPayment(f.code, f.memberCode, 50).total, 0);
});
test("promo payment rejects stale totals and expiry/disable between quote and payment", async () => {
  for (const change of ["expiry", "disable", "tamper"]) {
    const s = await fixture("PROMO");
    const [g] = await issue(s);
    const p = s.previewMockPayment(g.code, g.memberCode, 1000);
    if (change === "expiry") s.clock.now = Date.parse(g.definition.expiresAt);
    if (change === "disable") await s.removeDefinition(s.definition);
    if (change === "tamper") p.total = 0;
    await assert.rejects(s.completeMockPayment(p));
    assert.equal(s.readBenefits().grants[0].status, "UNUSED");
  }
});
test("storage read/write failures and unsupported Web Locks fail closed with no success event", async () => {
  const unsupported = await fixture("COUPON", { locks: false });
  await assert.rejects(unsupported.saveDefinition(unsupported.definition, null), /Web Locks/);
  for (const failure of ["read", "write"]) {
    const s = await fixture();
    const p = s.previewGrant(s.definition.id, ["BLU-1001"], "SELECTED");
    const before = s.storage.get(s.BENEFITS_KEY), count = s.events.length;
    s.failures[failure] = true;
    await assert.rejects(s.commitGrant(p));
    assert.equal(s.storage.get(s.BENEFITS_KEY), before); assert.equal(s.events.length, count);
    s.failures[failure] = false;
    assert.equal(s.readBenefits().grants.length, 0);
  }
});
test("failed coupon/payment writes never consume rights or return success", async () => {
  for (const kind of ["PROMO", "COUPON"]) {
    const s = await fixture(kind);
    const [g] = await issue(s);
    const p = kind === "COUPON" ? s.previewCoupon(g.code) : s.previewMockPayment(g.code, g.memberCode, 1000);
    const before = s.storage.get(s.BENEFITS_KEY);
    s.failures.write = true;
    await assert.rejects(kind === "COUPON" ? s.redeemCoupon(p) : s.completeMockPayment(p), /บันทึก/);
    assert.equal(s.storage.get(s.BENEFITS_KEY), before);
  }
});
test("malformed storage, duplicates, dangling grant/batch references and inconsistent statuses fail closed", async () => {
  const s = await fixture();
  await issue(s);
  const valid = json(s.readBenefits());
  const invalid = ["", "{", "null", "[]", "{}", JSON.stringify({ ...valid, version: 2 })];
  for (const mutate of [
    x => x.definitions.push(x.definitions[0]), x => x.grants.push(x.grants[0]), x => x.batches.push(x.batches[0]),
    x => { x.definitions = []; }, x => { x.batches = []; }, x => { x.grants[0].status = "USED"; },
    x => { x.grants[0].code = "BLU-CP-DEMO01"; }, x => { x.grants[0].definition.expiresAt = "bad"; },
    x => { x.batches[0].memberCodes.push("BLU-9999"); }, x => { x.grants[0].paidAmount = 0; },
  ]) { const copy = json(valid); mutate(copy); invalid.push(JSON.stringify(copy)); }
  for (const raw of invalid) {
    s.storage.set(s.BENEFITS_KEY, raw);
    assert.throws(() => s.readBenefits(), /เสียหาย/);
    await assert.rejects(s.saveDefinition(s.definition, null), /เสียหาย/);
    assert.equal(s.storage.get(s.BENEFITS_KEY), raw);
  }
});
