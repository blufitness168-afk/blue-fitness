import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const outputs = new Map(["admin-mock", "checkin", "front-desk"].map((name) => [name,
  ts.transpileModule(fs.readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
]));
const now = new Date("2026-09-07T09:00:00+07:00");
function setup({ locks = true } = {}) {
  const storage = new Map();
  const writes = [];
  const events = [];
  const requests = [];
  const failures = { read: false, write: false, readAt: 0 };
  const clock = { milliseconds: 0 };
  let reads = 0;
  let queue = Promise.resolve();
  const globals = {
    Date, Intl, Error,
    performance: { now: () => clock.milliseconds },
    localStorage: {
      getItem(key) { reads++; if (failures.read || reads === failures.readAt) throw new Error("denied"); return storage.get(key) ?? null; },
      setItem(key, value) { if (failures.write) throw new Error("quota"); writes.push(key); storage.set(key, value); },
    },
    CustomEvent: class { constructor(type) { this.type = type; } },
    window: { dispatchEvent(event) { events.push(event.type); return true; } },
    navigator: locks ? { locks: { request(key, options, callback) {
      requests.push({ key, options });
      const result = queue.then(callback);
      queue = result.catch(() => {});
      return result;
    } } } : {},
  };
  const modules = new Map();
  function load(name) {
    name = name.replace(/^\.\//, "");
    if (!modules.has(name)) {
      const context = { ...globals, exports: {}, require: load };
      vm.runInNewContext(outputs.get(name), context, { filename: `${name}.js` });
      modules.set(name, context.exports);
    }
    return modules.get(name);
  }
  const api = load("front-desk");
  return { ...api, storage, writes, events, requests, failures, clock, admin: load("admin-mock"),
    holdLock() {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      globals.navigator.locks.request(api.DESK_LOCK_KEY, { mode: "exclusive" }, () => held);
      return release;
    },
    lookup: (code, mode = "AUTO", date = now) => api.lookupDeskCode(code, mode, date),
    preview(code) {
      const result = api.lookupDeskCode(code, "AUTO", now);
      assert.equal(result.kind, "ACTION", result.message);
      return result.action;
    },
  };
}
const reward = "BLU-RW-2-DEMO01";
const coupon = "BLU-CP-DEMO01";

test("routes known members/cards and explicit member grammar, rejects unknown and wrong modes", () => {
  const s = setup();
  for (const code of [" blu-1001 \r\n", "CARD-8899", "BLU-1012", "CARD-1188", "BLU-999999"]) {
    for (const mode of ["AUTO", "CHECKIN"]) assert.equal(s.lookup(code, mode).kind, "CHECKIN");
    for (const mode of ["REWARD", "COUPON"]) assert.equal(s.lookup(code, mode).kind, "ERROR");
  }
  for (const [code, kind] of [[reward, "REWARD"], ["BLU-RW-3-DEMO02", "REWARD"], [coupon, "COUPON"]]) {
    assert.equal(s.lookup(code.toLowerCase(), kind).action.kind, kind);
    for (const mode of ["CHECKIN", kind === "REWARD" ? "COUPON" : "REWARD"]) assert.equal(s.lookup(code, mode).kind, "ERROR");
  }
  for (const code of ["", "x".repeat(101), "UNKNOWN", "CARD-0000", "BLU-CP-REAL01", "BLU-RW-2-UNKNOWN", "BLU-ABC", "https://example.com/BLU-1001", '{"code":"BLU-1001"}']) {
    assert.equal(s.lookup(code).kind, "ERROR");
  }
  assert.equal(s.lookup(reward, "INVALID").kind, "ERROR");
  assert.equal(s.lookup(coupon, "AUTO", new Date(NaN)).kind, "ERROR");
  assert.equal(s.writes.length, 0);
  assert.equal(s.events.length, 0);
  assert.equal(s.storage.size, 0);
});

test("strict reader merges seeds, preserves completion and optional metadata without mutating seeds", async () => {
  const s = setup();
  const records = s.readDeskRewards();
  const custom = { ...records[0], id: "custom", rewardCode: "BLU-RW-3-CUSTOM", source: "MEMBER" };
  s.storage.set(s.REWARD_STORAGE_KEY, JSON.stringify([custom]));
  assert.equal(s.readDeskRewards().length, 3);
  await s.confirmDeskAction(s.preview(reward), now);
  assert.equal(s.readDeskRewards().find((r) => r.rewardCode === reward).status, "COMPLETED");
  assert.equal(s.readDeskRewards().find((r) => r.id === "custom").source, "MEMBER");
  assert.equal(setup().preview(reward).kind, "REWARD");
});

test("reward confirmation updates status and audit time, never deducts points, and rejects concurrent/replayed confirmation", async () => {
  const s = setup();
  s.storage.set("blu_points", "200");
  const before = JSON.parse(JSON.stringify(s.readDeskRewards()));
  const members = JSON.stringify(s.admin.mockAdminMembers);
  const action = s.preview(reward);
  const results = await Promise.allSettled([s.confirmDeskAction(action, now), s.confirmDeskAction(action, now)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(s.confirmDeskAction(action, now), /รับรางวัลแล้ว/);
  assert.deepEqual(JSON.parse(s.storage.get(s.REWARD_STORAGE_KEY)), before.map((r) => r.rewardCode === reward ? { ...r, status: "COMPLETED", completedAt: now.toISOString() } : r));
  assert.equal(s.storage.get("blu_points"), "200");
  assert.equal(JSON.stringify(s.admin.mockAdminMembers), members);
  assert.deepEqual(s.writes, [s.REWARD_STORAGE_KEY]);
  assert.deepEqual(s.events, ["blu-front-desk-updated"]);
  assert.ok(s.requests.every((r) => r.key === "blu_front_desk" && r.options.mode === "exclusive"));
});

test("coupon DEMO only: expired/used rejected, confirmation persists once without touching actual coupons", async () => {
  const s = setup();
  s.storage.set("blu_coupons", "actual-member-data");
  for (const code of [s.DEMO_COUPON_CODES.expired, s.DEMO_COUPON_CODES.used]) assert.equal(s.lookup(code).kind, "ERROR");
  const action = s.preview(coupon);
  assert.match(action.detail, /DEMO.*ไม่ต่ออายุสมาชิก/);
  const results = await Promise.allSettled([s.confirmDeskAction(action, now), s.confirmDeskAction(action, now)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(s.confirmDeskAction(action, now), /ใช้แล้ว/);
  const records = JSON.parse(s.storage.get(s.COUPON_STORAGE_KEY));
  assert.equal(records.find((c) => c.code === coupon).usedAt, now.toISOString());
  assert.equal(s.storage.get("blu_coupons"), "actual-member-data");
  assert.deepEqual(s.writes, [s.COUPON_STORAGE_KEY]);
  assert.deepEqual(s.events, [s.DESK_UPDATED_EVENT]);
});

test("expiry is checked again at confirmation including exact boundary", async () => {
  for (const date of ["2099-12-31T23:59:59Z", "2100-01-01T00:00:00Z"]) {
    const s = setup();
    const action = s.preview(coupon);
    await assert.rejects(s.confirmDeskAction(action, new Date(date)), /หมดอายุ/);
    assert.equal(s.writes.length, 0);
  }
});

test("queued coupon expiry uses monotonic wait time, including the exact expiry boundary", async () => {
  const expiresAt = new Date("2099-12-31T23:59:59Z").getTime();
  for (const elapsed of [999, 1000, 1001]) {
    const s = setup();
    const requestedAt = new Date(expiresAt - 1000);
    const preview = s.lookup(coupon, "COUPON", requestedAt);
    assert.equal(preview.kind, "ACTION");
    s.clock.milliseconds = 500;
    const release = s.holdLock();
    const pending = s.confirmDeskAction(preview.action, requestedAt);
    await Promise.resolve();
    assert.equal(s.writes.length, 0);
    s.clock.milliseconds += elapsed;
    release();
    if (elapsed >= 1000) {
      await assert.rejects(pending, /หมดอายุ/);
      assert.equal(s.storage.has(s.COUPON_STORAGE_KEY), false);
      assert.equal(s.writes.length, 0);
      assert.equal(s.events.length, 0);
    } else {
      await pending;
      const record = JSON.parse(s.storage.get(s.COUPON_STORAGE_KEY)).find((c) => c.code === coupon);
      assert.equal(record.usedAt, new Date(requestedAt.getTime() + elapsed).toISOString());
    }
  }
});

test("reward audit time includes lock wait and survives replay without modifying points or metadata", async () => {
  const s = setup();
  const records = s.readDeskRewards();
  records.find((r) => r.rewardCode === reward).source = "MEMBER";
  s.storage.set(s.REWARD_STORAGE_KEY, JSON.stringify(records));
  const action = s.preview(reward);
  s.clock.milliseconds = 100;
  const release = s.holdLock();
  const suppliedNow = new Date(now.getTime());
  const pending = s.confirmDeskAction(action, suppliedNow);
  suppliedNow.setFullYear(2100);
  await Promise.resolve();
  assert.equal(s.writes.length, 0);
  s.clock.milliseconds += 2500;
  release();
  await pending;
  const expected = records.map((r) => r.rewardCode === reward
    ? { ...r, status: "COMPLETED", completedAt: new Date(now.getTime() + 2500).toISOString() }
    : r);
  assert.deepEqual(JSON.parse(JSON.stringify(s.readDeskRewards())), JSON.parse(JSON.stringify(expected)));
  const stored = s.storage.get(s.REWARD_STORAGE_KEY);
  await assert.rejects(s.confirmDeskAction(action, now), /รับรางวัลแล้ว/);
  assert.equal(s.storage.get(s.REWARD_STORAGE_KEY), stored);
  assert.deepEqual(s.writes, [s.REWARD_STORAGE_KEY]);
  assert.deepEqual(s.events, [s.DESK_UPDATED_EVENT]);
});

test("invalid monotonic elapsed time fails closed", async () => {
  for (const elapsed of [-1, NaN, Infinity]) {
    const s = setup();
    const pending = s.confirmDeskAction(s.preview(coupon), now);
    s.clock.milliseconds = elapsed;
    await assert.rejects(pending, /ตรวจสอบเวลารอไม่ได้/);
    assert.equal(s.writes.length, 0);
    assert.equal(s.events.length, 0);
  }
});

test("all displayed snapshot fields are verified, including storage changes after preview", async () => {
  for (const code of [reward, coupon]) {
    for (const field of ["kind", "code", "memberCode", "memberName", "title", "detail"]) {
      const s = setup();
      const action = s.preview(code);
      await assert.rejects(s.confirmDeskAction({ ...action, [field]: `${action[field]}X` }, now));
      assert.equal(s.writes.length, 0);
    }
  }
  for (const field of ["memberCode", "memberName", "rewardTitle", "pointsSpent", "redeemedAt", "id"]) {
    const s = setup();
    const action = s.preview(reward);
    const records = s.readDeskRewards();
    const record = records.find((r) => r.rewardCode === reward);
    record[field] = field === "pointsSpent" ? 999 : field === "memberCode" ? "BLU-9999" : field === "redeemedAt" ? "2026-09-06T00:00:00Z" : "เปลี่ยนข้อมูล";
    s.storage.set(s.REWARD_STORAGE_KEY, JSON.stringify(records));
    await assert.rejects(s.confirmDeskAction(action, now), /สแกนใหม่/);
    assert.equal(s.writes.length, 0);
  }
  const s = setup();
  const action = s.preview(coupon);
  s.storage.set(s.COUPON_STORAGE_KEY, JSON.stringify([{ code: coupon, memberCode: "BLU-1001", memberName: action.memberName, title: action.title, type: "BRING_FRIEND", demo: true, status: "UNUSED", expiresAt: "2098-01-01T00:00:00Z" }]));
  await assert.rejects(s.confirmDeskAction(action, now), /สแกนใหม่/);
});

test("missing locks, unavailable storage and quota failures fail closed without notifications", async () => {
  const unsupported = setup({ locks: false });
  for (const code of [reward, coupon]) await assert.rejects(unsupported.confirmDeskAction(unsupported.preview(code), now), /เบราว์เซอร์.*ไม่รองรับ/);
  assert.equal(unsupported.writes.length, 0);
  for (const code of [reward, coupon]) {
    for (const failure of ["read", "write"]) {
      const s = setup();
      const action = s.preview(code);
      s.failures[failure] = true;
      await assert.rejects(s.confirmDeskAction(action, now), /ข้อมูล|บันทึก/);
      assert.equal(s.writes.length, 0);
      assert.equal(s.events.length, 0);
      s.failures[failure] = false;
      assert.equal(s.lookup(code).kind, "ACTION");
    }
  }
});

test("malformed reward storage and duplicate IDs/codes reject before seed fallback", async () => {
  const seed = setup().readDeskRewards()[0];
  const invalid = ["", "invalid", "null", "{}", "[null]", "[{}]",
    ...[
      [{ ...seed, pointsSpent: -1 }], [{ ...seed, pointsSpent: 1.5 }], [{ ...seed, rewardId: 2 }],
      [{ ...seed, redeemedAt: "invalid" }], [{ ...seed, memberCode: "CARD-8899" }],
      [{ ...seed, status: "UNKNOWN" }], [{ ...seed, completedAt: "invalid" }], [{ ...seed, source: 12 }],
      [seed, { ...seed, id: "another" }], [seed, { ...seed, rewardCode: "BLU-RW-3-OTHER" }],
      [{ ...seed, rewardCode: "BLU-1001" }], [{ ...seed, rewardCode: coupon }],
    ].map(JSON.stringify),
  ];
  for (const raw of invalid) {
    const s = setup();
    const action = s.preview(reward);
    s.storage.set(s.REWARD_STORAGE_KEY, raw);
    assert.throws(() => s.readDeskRewards(), /เสียหาย/);
    assert.equal(s.lookup(reward).kind, "ERROR");
    await assert.rejects(s.confirmDeskAction(action, now));
    assert.equal(s.storage.get(s.REWARD_STORAGE_KEY), raw);
    assert.equal(s.writes.length, 0);
  }
});

test("malformed/ambiguous coupons and non-bring-friend data fail closed", async () => {
  const base = { code: coupon, memberCode: "BLU-1001", memberName: "สมาชิก DEMO", title: "DEMO", type: "BRING_FRIEND", demo: true, status: "UNUSED", expiresAt: "2099-12-31T23:59:59Z" };
  for (const raw of ["", "invalid", "null", "{}", "[null]", ...[
    [base, base], [{ ...base, type: "BONUS_DAYS" }], [{ ...base, demo: false }],
    [{ ...base, code: reward }], [{ ...base, code: "BLU-CP-REAL01" }],
    [{ ...base, expiresAt: "invalid" }], [{ ...base, status: "USED" }], [{ ...base, usedAt: now.toISOString() }],
  ].map(JSON.stringify)]) {
    const s = setup();
    const action = s.preview(coupon);
    s.storage.set(s.COUPON_STORAGE_KEY, raw);
    assert.equal(s.lookup(coupon).kind, "ERROR");
    await assert.rejects(s.confirmDeskAction(action, now));
    assert.equal(s.writes.length, 0);
  }
});

test("a swallowed getRedemptions read failure cannot restore a completed record as pending", () => {
  const s = setup();
  const seed = setup().readDeskRewards().find((r) => r.rewardCode === reward);
  s.storage.set(s.REWARD_STORAGE_KEY, JSON.stringify([{ ...seed, status: "COMPLETED" }]));
  s.failures.readAt = 2;
  assert.throws(() => s.readDeskRewards(), /เสียหาย/);
  assert.equal(s.writes.length, 0);
});

test("confirmation reads current state after acquiring the lock, not before waiting", async () => {
  const s = setup();
  const action = s.preview(reward);
  const pending = s.confirmDeskAction(action, now);
  const records = s.readDeskRewards();
  records.find((r) => r.rewardCode === reward).status = "COMPLETED";
  s.storage.set(s.REWARD_STORAGE_KEY, JSON.stringify(records));
  await assert.rejects(pending, /รับรางวัลแล้ว/);
  assert.equal(s.writes.length, 0);
  assert.equal(s.events.length, 0);
});

test("ambiguous known card identities fail closed", () => {
  const s = setup();
  s.admin.mockAdminMembers.push({ memberCode: "BLU-9999", cardNumber: "CARD-8899" });
  assert.equal(s.lookup("CARD-8899").kind, "ERROR");
});
