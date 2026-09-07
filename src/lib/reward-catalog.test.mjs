import { test } from "node:test";
import assert from "node:assert/strict";
import { setupMock } from "./mock-test-harness.mjs";
function fixture(options) {
  const s = setupMock(options);
  return { ...s, ...s.load("reward-catalog"), desk: s.load("front-desk") };
}

test("reward CRUD validates image, points, stock, stale edits and never reuses deleted IDs", async () => {
  const s = fixture();
  const draft = { ...s.newReward(), title: "ใหม่", titleEn: "New" };
  await s.saveReward(draft, null);
  const edited = { ...draft, pointCost: 2, stock: 3, isActive: false };
  await s.saveReward(edited, draft);
  await assert.rejects(s.saveReward(draft, draft), /เปลี่ยน/);
  assert.equal(s.readRewardCatalog().find(r => r.id === draft.id).pointCost, 2);
  assert.equal(await s.removeReward(edited), "DELETED");
  assert.ok(s.newReward().id > draft.id);
  for (const changes of [{ pointCost: 0 }, { pointCost: 1.5 }, { stock: -1 }, { imageUrl: "javascript:alert(1)" }, { title: " " }]) {
    await assert.rejects(s.saveReward({ ...s.newReward(), title: "ทดสอบ", ...changes }, null));
  }
});
test("used rewards soft-disable, pending collection stays valid, records and spent points unchanged", async () => {
  const s = fixture();
  const reward = s.readRewardCatalog().find(r => r.id === 2);
  const before = JSON.stringify(s.desk.readDeskRewards());
  assert.equal(await s.removeReward(reward), "DISABLED");
  assert.equal(s.readRewardCatalog().find(r => r.id === 2).isActive, false);
  assert.equal(JSON.stringify(s.desk.readDeskRewards()), before);
  const action = s.desk.lookupRewardCode("BLU-RW-2-DEMO01");
  await s.desk.confirmDeskAction(action, new Date(s.clock.now));
  assert.equal(s.desk.readDeskRewards().find(r => r.rewardId === 2).status, "COMPLETED");
  await assert.rejects(s.desk.confirmDeskAction(action, new Date(s.clock.now)), /รับรางวัลแล้ว/);
});
test("member request atomically journals point debit and stock reservation; collect never debits twice", async () => {
  const s = fixture();
  const reward = s.readRewardCatalog()[0];
  const before = s.rewardWallet("BLU-1001");
  const stock = s.remainingStock(reward, s.desk.readDeskRewards());
  const record = await s.requestMockReward(reward, "BLU-1001");
  assert.equal(record.status, "PENDING");
  assert.equal(s.rewardWallet("BLU-1001"), before - reward.pointCost);
  assert.equal(s.remainingStock(reward, s.desk.readDeskRewards()), stock - 1);
  assert.deepEqual(s.writes, [s.desk.REWARD_STORAGE_KEY]);
  assert.ok(s.requests.every(r => r.key === s.desk.DESK_LOCK_KEY));
  const reload = fixture({ storage: s.storage });
  assert.equal(reload.rewardWallet("BLU-1001"), before - reward.pointCost);
  await reload.desk.confirmDeskAction(reload.desk.lookupRewardCode(record.rewardCode), new Date(s.clock.now));
  assert.equal(reload.rewardWallet("BLU-1001"), before - reward.pointCost);
  assert.equal(reload.remainingStock(reward, reload.desk.readDeskRewards()), stock - 1);
  await assert.rejects(reload.requestMockReward(reward, "BLU-1001"), /แลกรางวัลนี้แล้ว/);
});
test("concurrent member requests cannot oversell or award duplicate redemption", async () => {
  const s = fixture();
  const reward = s.readRewardCatalog()[0];
  const limited = { ...reward, stock: 1 };
  await s.saveReward(limited, reward);
  const result = await Promise.allSettled([s.requestMockReward(limited, "BLU-1001"), s.requestMockReward(limited, "BLU-1012")]);
  assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(s.remainingStock(limited, s.desk.readDeskRewards()), 0);
  await assert.rejects(s.saveReward({ ...limited, stock: 0 }, limited), /ไม่น้อย/);
  const duplicate = fixture();
  const item = duplicate.readRewardCatalog()[0];
  const duplicateResults = await Promise.allSettled([duplicate.requestMockReward(item, "BLU-1001"), duplicate.requestMockReward(item, "BLU-1001")]);
  assert.equal(duplicateResults.filter(r => r.status === "fulfilled").length, 1);
});
test("insufficient points, unknown member, disabled or stale reward cannot be requested", async () => {
  const s = fixture();
  const costly = s.readRewardCatalog().find(r => r.id === 3);
  await assert.rejects(s.requestMockReward(costly, "BLU-1001"), /ไม่เพียงพอ/);
  await assert.rejects(s.requestMockReward(costly, "BLU-9999"), /รายชื่อ/);
  const r = s.readRewardCatalog()[0];
  await s.saveReward({ ...r, isActive: false }, r);
  await assert.rejects(s.requestMockReward(r, "BLU-1001"), /เปลี่ยน|ปิด/);
  assert.equal(s.storage.has(s.desk.REWARD_STORAGE_KEY), false);
});
test("CRUD and requests reread after lock and fail closed on malformed storage or write failure", async () => {
  const unsupported = fixture({ locks: false });
  await assert.rejects(unsupported.saveReward({ ...unsupported.newReward(), title: "ใหม่" }, null), /Web Locks/);
  for (const key of ["blu_reward_catalog_mock_v1", "blu_redemptions"]) {
    for (const raw of ["", "{", "null", "{}", "[null]"]) {
      const s = fixture();
      const reward = s.readRewardCatalog()[0];
      s.storage.set(key, raw);
      await assert.rejects(s.requestMockReward(reward, "BLU-1001"));
      await assert.rejects(s.removeReward(reward));
      assert.equal(s.storage.get(key), raw);
      assert.equal(s.writes.length, 0);
    }
  }
  const s = fixture();
  const reward = s.readRewardCatalog()[0];
  const release = s.holdLock(s.desk.DESK_LOCK_KEY);
  const request = s.requestMockReward(reward, "BLU-1001");
  s.failures.write = true; release();
  await assert.rejects(request, /บันทึก/);
  assert.equal(s.rewardWallet("BLU-1001"), 25);
  assert.equal(s.writes.length, 0); assert.equal(s.events.length, 0);
});
test("dedicated reward scanner is independent of superseded DEMO coupon storage", async () => {
  const s = fixture();
  s.storage.set(s.desk.COUPON_STORAGE_KEY, "corrupt legacy data");
  const action = s.desk.lookupRewardCode(" blu-rw-2-demo01 \r\n");
  assert.equal(action.kind, "REWARD");
  await s.desk.confirmDeskAction(action, new Date(s.clock.now));
  assert.equal(s.desk.readDeskRewards().find(r => r.rewardId === 2).status, "COMPLETED");
  for (const code of ["BLU-1001", "CARD-8899", "BLU-CP-DEMO01", "", "https://example.com"]) assert.throws(() => s.desk.lookupRewardCode(code));
});
