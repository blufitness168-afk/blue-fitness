import { test } from "node:test";
import assert from "node:assert/strict";
import { setupMock } from "./mock-test-harness.mjs";

function fixture(options) {
  const s = setupMock(options);
  return { ...s, ...s.load("member-account") };
}

test("point coupon redemption debits the shared ledger once and creates a wallet coupon", async () => {
  const s = fixture();
  const opening = s.readMemberAccount("BLU-1001").points;
  const offer = s.readPointCouponCatalog()[0];
  const coupon = await s.redeemPointCoupon("BLU-1001", offer);
  const account = s.readMemberAccount("BLU-1001");
  assert.equal(account.points, opening - offer.pointCost);
  assert.equal(account.pointCoupons.length, 1);
  assert.equal(account.pointCoupons[0].code, coupon.code);
  assert.equal(account.pointLedger.at(-1).delta, -offer.pointCost);
  assert.equal(s.previewPointCoupon(coupon.code).status, "UNUSED");
  await assert.rejects(s.redeemPointCoupon("BLU-1001", offer), /ยังไม่ได้ใช้/);
  s.clock.now += 31 * 86_400_000;
  const replacement = await s.redeemPointCoupon("BLU-1001", offer);
  assert.notEqual(replacement.code, coupon.code);
});

test("admin consumption changes only coupon status and never debits points twice", async () => {
  const s = fixture();
  const coupon = await s.redeemPointCoupon("BLU-1001", s.readPointCouponCatalog()[0]);
  const balance = s.readMemberAccount("BLU-1001").points;
  await s.consumePointCoupon(coupon);
  const account = s.readMemberAccount("BLU-1001");
  assert.equal(account.points, balance);
  assert.equal(account.pointCoupons[0].status, "USED");
  assert.ok(account.pointCoupons[0].usedAt);
  await assert.rejects(s.consumePointCoupon(coupon), /เปลี่ยนแล้ว|ใช้แล้ว/);
  assert.throws(() => s.previewPointCoupon(coupon.code), /ใช้แล้ว/);
});

test("point coupon validation rejects unknown members, insufficient balance and malformed storage", async () => {
  const s = fixture();
  await assert.rejects(s.redeemPointCoupon("BLU-9999", s.readPointCouponCatalog()[0]), /ไม่พบ/);
  await s.redeemPointCoupon("BLU-1001", s.readPointCouponCatalog()[0]);
  await assert.rejects(s.redeemPointCoupon("BLU-1001", s.readPointCouponCatalog()[1]), /ไม่เพียงพอ/);
  assert.throws(() => s.previewPointCoupon("BLU-PTC-UNKNOWN"), /ไม่พบ/);
  s.storage.set(s.MEMBER_ACCOUNT_KEY, "invalid");
  assert.throws(() => s.readMemberAccount("BLU-1001"), /เสียหาย/);
});

test("ledger parser rejects duplicate references and positive spending entries", async () => {
  const duplicate = fixture();
  await duplicate.redeemPointCoupon("BLU-1001", duplicate.readPointCouponCatalog()[0]);
  const duplicatedState = JSON.parse(duplicate.storage.get(duplicate.MEMBER_ACCOUNT_KEY));
  const duplicatedAccount = duplicatedState.accounts.find(account => account.memberCode === "BLU-1001");
  const original = duplicatedAccount.pointLedger.at(-1);
  duplicatedAccount.pointLedger.push({ ...original, id: "duplicate-ledger", delta: 1, balanceAfter: duplicatedAccount.points + 1 });
  duplicatedAccount.points += 1;
  assert.throws(() => duplicate.parseMemberAccountStore(JSON.stringify(duplicatedState)), /เสียหาย/);

  const direction = fixture();
  const directionState = direction.readMemberAccountStore();
  const account = directionState.accounts.find(item => item.memberCode === "BLU-1001");
  account.pointLedger.push({ id: "invalid-reward", memberCode: "BLU-1001", delta: 1, balanceAfter: account.points + 1,
    type: "REWARD", referenceId: "invalid-reward", description: "invalid positive spend", createdAt: new Date(direction.clock.now).toISOString() });
  account.points += 1;
  assert.throws(() => direction.parseMemberAccountStore(JSON.stringify(directionState)), /เสียหาย/);
});
