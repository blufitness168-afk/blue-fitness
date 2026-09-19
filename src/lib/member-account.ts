import { z } from "zod";
import { mockAdminMembers } from "./admin-mock";

export const MEMBER_ACCOUNT_KEY = "blu_member_accounts_mock_v1";
export const MEMBER_ACCOUNT_LOCK_KEY = "blu_member_account_transactions_v1";
export const MEMBER_ACCOUNT_EVENT = "blu-member-account-updated";

const timestamp = z.string().datetime({ offset: true });
const memberCodeSchema = z.string().regex(/^BLU-\d+$/);
const baht = z.number().int().min(0).max(10_000_000);
const points = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const purchaseSchema = z.object({
  id: z.string().uuid(), memberCode: memberCodeSchema, packageId: z.number().int().positive(), packageName: z.string().trim().min(1).max(200),
  subtotal: baht, discount: baht, paidAmount: baht, pointsEarned: points, purchasedAt: timestamp, promoCode: z.string().min(1).max(100).optional(),
}).strict().refine(p => p.discount <= p.subtotal && p.paidAmount === p.subtotal - p.discount && p.pointsEarned === Math.floor(p.paidAmount / 20), "ยอดซื้อหรือคะแนนไม่สัมพันธ์กัน");
export type MemberPurchase = z.infer<typeof purchaseSchema>;

const ledgerSchema = z.object({
  id: z.string().min(1).max(100), memberCode: memberCodeSchema, delta: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  balanceAfter: points, type: z.enum(["OPENING_BALANCE", "PURCHASE", "REWARD", "POINT_COUPON"]), referenceId: z.string().min(1).max(150),
  description: z.string().trim().min(1).max(300), createdAt: timestamp,
}).strict();
export type PointLedgerEntry = z.infer<typeof ledgerSchema>;

const couponSchema = z.object({
  id: z.string().uuid(), code: z.string().regex(/^BLU-PTC-[A-F0-9]{32}$/), offerId: z.string().regex(/^[A-Z0-9_-]{2,40}$/), memberCode: memberCodeSchema,
  title: z.string().trim().min(1).max(120), detail: z.string().trim().min(1).max(300), pointsSpent: z.number().int().positive().max(1_000_000),
  status: z.enum(["UNUSED", "USED"]), redeemedAt: timestamp, expiresAt: timestamp, usedAt: timestamp.optional(),
}).strict().refine(c => (c.status === "USED") === !!c.usedAt && Date.parse(c.expiresAt) > Date.parse(c.redeemedAt), "สถานะหรือวันหมดอายุคูปองไม่ถูกต้อง");
export type PointCoupon = z.infer<typeof couponSchema>;

const accountSchema = z.object({
  memberCode: memberCodeSchema, points, purchases: z.array(purchaseSchema), pointLedger: z.array(ledgerSchema), pointCoupons: z.array(couponSchema),
}).strict();
export type MemberAccount = z.infer<typeof accountSchema>;

const storeSchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(), accounts: z.array(accountSchema) }).strict();
const legacyRewardSchema = z.object({
  id: z.string().min(1), memberCode: memberCodeSchema, rewardTitle: z.string().trim().min(1), pointsSpent: z.number().int().positive(), redeemedAt: timestamp,
}).passthrough();
export type MemberAccountStore = z.infer<typeof storeSchema>;

export interface PointCouponOffer {
  id: string;
  title: string;
  detail: string;
  pointCost: number;
  validDays: number;
}

export const POINT_COUPON_CATALOG: readonly PointCouponOffer[] = Object.freeze([
  Object.freeze({ id: "DRINK", title: "คูปองเครื่องดื่ม 1 ขวด", detail: "รับเครื่องดื่มที่เคาน์เตอร์ 1 ขวด", pointCost: 10, validDays: 30 }),
  Object.freeze({ id: "FRIEND_PASS", title: "คูปองพาเพื่อน 1 ครั้ง", detail: "พาเพื่อนเข้าใช้บริการพร้อมสมาชิก 1 คน", pointCost: 20, validDays: 30 }),
]);

const fail = (message: string): never => { throw new Error(message); };
const unique = (values: string[]) => new Set(values).size === values.length;
const seedDate = "2026-08-28T00:00:00.000Z";

function createSeedAccount(memberCode: string): MemberAccount {
  const member = mockAdminMembers.find(m => m.memberCode === memberCode);
  if (!member) return fail("ไม่พบสมาชิกในรายชื่อ mock");
  const entry: PointLedgerEntry = {
    id: `opening-${member.memberCode}`, memberCode: member.memberCode, delta: member.points, balanceAfter: member.points,
    type: "OPENING_BALANCE", referenceId: `opening-${member.memberCode}`, description: "ยอดคะแนนตั้งต้น mock", createdAt: seedDate,
  };
  return { memberCode: member.memberCode, points: member.points, purchases: [], pointLedger: [entry], pointCoupons: [] };
}

function seedStore(): MemberAccountStore {
  return { version: 1, revision: 0, accounts: mockAdminMembers.map(member => createSeedAccount(member.memberCode)) };
}

export function parseMemberAccountStore(raw: string | null): MemberAccountStore {
  if (raw === null) return seedStore();
  try {
    const state = storeSchema.parse(JSON.parse(raw));
    if (!unique(state.accounts.map(a => a.memberCode))) throw Error();
    const ledgerIds = new Set<string>();
    const purchaseIds = new Set<string>();
    const couponIds = new Set<string>();
    const couponCodes = new Set<string>();
    for (const account of state.accounts) {
      if (!mockAdminMembers.some(m => m.memberCode === account.memberCode)) throw Error();
      let balance = 0;
      const ledgerReferences = new Set<string>();
      for (const entry of account.pointLedger) {
        const reference = `${entry.type}:${entry.referenceId}`;
        if (entry.memberCode !== account.memberCode || ledgerIds.has(entry.id) || ledgerReferences.has(reference) ||
          (entry.type === "OPENING_BALANCE" && entry.delta < 0) || (entry.type === "PURCHASE" && entry.delta < 0) ||
          ((entry.type === "REWARD" || entry.type === "POINT_COUPON") && entry.delta >= 0)) throw Error();
        balance += entry.delta;
        if (balance < 0 || entry.balanceAfter !== balance) throw Error();
        ledgerIds.add(entry.id);
        ledgerReferences.add(reference);
      }
      if (balance !== account.points) throw Error();
      for (const purchase of account.purchases) {
        if (purchase.memberCode !== account.memberCode || purchaseIds.has(purchase.id) ||
          !account.pointLedger.some(e => e.type === "PURCHASE" && e.referenceId === purchase.id && e.delta === purchase.pointsEarned)) throw Error();
        purchaseIds.add(purchase.id);
      }
      for (const coupon of account.pointCoupons) {
        if (coupon.memberCode !== account.memberCode || couponIds.has(coupon.id) || couponCodes.has(coupon.code) ||
          !account.pointLedger.some(e => e.type === "POINT_COUPON" && e.referenceId === coupon.id && e.delta === -coupon.pointsSpent)) throw Error();
        couponIds.add(coupon.id); couponCodes.add(coupon.code);
      }
      for (const entry of account.pointLedger) {
        if (entry.type === "PURCHASE" && !account.purchases.some(p => p.id === entry.referenceId)) throw Error();
        if (entry.type === "POINT_COUPON" && !account.pointCoupons.some(c => c.id === entry.referenceId)) throw Error();
      }
    }
    return state;
  } catch {
    return fail("ข้อมูลบัญชีสมาชิก mock เสียหาย ระบบหยุดทำรายการ กรุณาตรวจสอบ localStorage (ไม่รีเซ็ตคะแนนอัตโนมัติ)");
  }
}

function migrateLegacyRewardDebits(state: MemberAccountStore): MemberAccountStore {
  const raw = localStorage.getItem("blu_redemptions");
  if (raw === null) return state;
  let rewards: z.infer<typeof legacyRewardSchema>[];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw Error();
    rewards = value.map(item => legacyRewardSchema.parse(item));
    if (!unique(rewards.map(reward => reward.id))) throw Error();
  } catch { return fail("ข้อมูลรางวัลเดิมเสียหาย จึงย้ายยอดใช้แต้มเข้าบัญชีสมาชิกไม่ได้"); }
  rewards.sort((a, b) => Date.parse(a.redeemedAt) - Date.parse(b.redeemedAt));
  for (const reward of rewards) {
    if (reward.id.startsWith("seed-")) continue;
    spendPointsInStore(state, reward.memberCode, reward.pointsSpent, "REWARD", reward.id, `ย้ายรายการแลกรางวัลเดิม ${reward.rewardTitle}`, reward.redeemedAt);
  }
  return state;
}

export function readMemberAccountStore(): MemberAccountStore {
  try {
    const raw = localStorage.getItem(MEMBER_ACCOUNT_KEY);
    return raw === null ? migrateLegacyRewardDebits(parseMemberAccountStore(null)) : parseMemberAccountStore(raw);
  } catch (cause) {
    if (cause instanceof Error && (cause.message.includes("เสียหาย") || cause.message.includes("ไม่เพียงพอ"))) throw cause;
    return fail("อ่านบัญชีสมาชิกไม่ได้ กรุณาอนุญาตพื้นที่จัดเก็บเบราว์เซอร์");
  }
}

export function accountFromStore(state: MemberAccountStore, memberCode: string): MemberAccount {
  const normalized = memberCode.trim().toUpperCase();
  const account = state.accounts.find(a => a.memberCode === normalized);
  if (!account) return fail("ไม่พบบัญชีสมาชิกในรายชื่อ mock");
  return account;
}

export function readMemberAccount(memberCode: string): MemberAccount {
  return JSON.parse(JSON.stringify(accountFromStore(readMemberAccountStore(), memberCode))) as MemberAccount;
}

export function readPointCouponCatalog(): PointCouponOffer[] {
  return POINT_COUPON_CATALOG.map(offer => ({ ...offer }));
}

function addLedger(account: MemberAccount, entry: Omit<PointLedgerEntry, "balanceAfter">): PointLedgerEntry {
  if (account.pointLedger.some(item => item.id === entry.id || (item.type === entry.type && item.referenceId === entry.referenceId))) {
    return fail("รายการคะแนนนี้ถูกบันทึกแล้ว ห้ามส่งซ้ำ");
  }
  const balanceAfter = account.points + entry.delta;
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) return fail("แต้ม mock ไม่เพียงพอ");
  const complete = ledgerSchema.parse({ ...entry, balanceAfter });
  account.points = balanceAfter;
  account.pointLedger.push(complete);
  return complete;
}

export type PurchaseInput = Omit<MemberPurchase, "pointsEarned">;
export function recordPurchaseInStore(state: MemberAccountStore, input: PurchaseInput): MemberPurchase {
  const account = accountFromStore(state, input.memberCode);
  if (account.purchases.some(p => p.id === input.id)) return fail("รายการชำระนี้บันทึกแล้ว ห้ามส่งซ้ำ");
  const purchase = purchaseSchema.parse({ ...input, pointsEarned: Math.floor(input.paidAmount / 20) });
  account.purchases.push(purchase);
  addLedger(account, { id: `purchase-${purchase.id}`, memberCode: account.memberCode, delta: purchase.pointsEarned, type: "PURCHASE",
    referenceId: purchase.id, description: `ชำระแพ็กเกจ ${purchase.packageName} ${purchase.paidAmount} บาท`, createdAt: purchase.purchasedAt });
  return purchase;
}

export function spendPointsInStore(state: MemberAccountStore, memberCode: string, amount: number, type: "REWARD" | "POINT_COUPON", referenceId: string, description: string, createdAt: string): PointLedgerEntry {
  if (!Number.isSafeInteger(amount) || amount <= 0) return fail("จำนวนแต้มที่ใช้ไม่ถูกต้อง");
  const account = accountFromStore(state, memberCode);
  return addLedger(account, { id: `${type.toLowerCase()}-${referenceId}`, memberCode: account.memberCode, delta: -amount, type, referenceId, description, createdAt });
}

export function serializeMemberAccountStore(state: MemberAccountStore): string {
  state.revision++;
  const serialized = JSON.stringify(state);
  parseMemberAccountStore(serialized);
  return serialized;
}

export async function withMemberAccountLock<T>(action: () => T | Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) return fail("ต้องใช้ Web Locks ผ่าน HTTPS หรือ localhost จึงจะบันทึกได้");
  return navigator.locks.request(MEMBER_ACCOUNT_LOCK_KEY, { mode: "exclusive" }, action);
}

export interface StorageWrite { key: string; value: string; errorMessage: string }
export function commitLocalStorageTransaction(writes: StorageWrite[]): void {
  const prior = writes.map(write => ({ key: write.key, value: localStorage.getItem(write.key) }));
  let completed = 0;
  try {
    for (const write of writes) { localStorage.setItem(write.key, write.value); completed++; }
  } catch {
    try {
      for (let index = completed - 1; index >= 0; index--) {
        const old = prior[index];
        if (old.value === null) localStorage.removeItem(old.key); else localStorage.setItem(old.key, old.value);
      }
    } catch { return fail("บันทึกบางส่วนล้มเหลวและย้อนข้อมูลไม่ได้ กรุณาหยุดทำรายการและตรวจสอบ localStorage"); }
    return fail(writes[Math.min(completed, writes.length - 1)]?.errorMessage ?? "บันทึกไม่สำเร็จ ยังไม่ยืนยันรายการ");
  }
}

export function dispatchMemberAccountUpdated(): void {
  window.dispatchEvent(new CustomEvent(MEMBER_ACCOUNT_EVENT));
}

export function previewPointCoupon(code: string, now = new Date()): PointCoupon {
  const normalized = code.trim().toUpperCase();
  const matches = readMemberAccountStore().accounts.flatMap(account => account.pointCoupons).filter(coupon => coupon.code === normalized);
  if (matches.length !== 1) return fail("ไม่พบคูปองที่แลกจากคะแนน ใช้รหัส BLU-PTC-… เท่านั้น");
  const coupon = matches[0];
  if (coupon.status !== "UNUSED") return fail("คูปองนี้ใช้แล้ว ห้ามใช้ซ้ำ");
  if (!Number.isFinite(now.getTime()) || Date.parse(coupon.expiresAt) <= now.getTime()) return fail("คูปองนี้หมดอายุแล้ว");
  return JSON.parse(JSON.stringify(coupon)) as PointCoupon;
}

export async function consumePointCoupon(expected: PointCoupon): Promise<void> {
  const snapshot = JSON.stringify(expected);
  await withMemberAccountLock(() => {
    const state = readMemberAccountStore();
    const account = accountFromStore(state, expected.memberCode);
    const coupon = account.pointCoupons.find(item => item.code === expected.code);
    if (!coupon || JSON.stringify(coupon) !== snapshot) return fail("ข้อมูลคูปองเปลี่ยนแล้ว กรุณาสแกนใหม่");
    previewPointCoupon(coupon.code);
    coupon.status = "USED";
    coupon.usedAt = new Date().toISOString();
    commitLocalStorageTransaction([{ key: MEMBER_ACCOUNT_KEY, value: serializeMemberAccountStore(state), errorMessage: "บันทึกใช้คูปองไม่สำเร็จ กรุณายังไม่ส่งมอบสิทธิ์" }]);
    dispatchMemberAccountUpdated();
  });
}

export async function redeemPointCoupon(memberCode: string, expected: PointCouponOffer | string): Promise<PointCoupon> {
  const snapshot = typeof expected === "string" ? null : JSON.stringify(expected);
  const offerId = typeof expected === "string" ? expected : expected.id;
  return withMemberAccountLock(() => {
    const offer = POINT_COUPON_CATALOG.find(item => item.id === offerId);
    if (!offer || (snapshot !== null && JSON.stringify(offer) !== snapshot)) return fail("คูปองแต้มเปลี่ยนหรือไม่พร้อมแลก กรุณาโหลดใหม่");
    const state = readMemberAccountStore();
    const account = accountFromStore(state, memberCode);
    if (account.pointCoupons.some(c => c.offerId === offer.id && c.status === "UNUSED" && Date.parse(c.expiresAt) > Date.now())) return fail("มีคูปองชนิดนี้ที่ยังไม่ได้ใช้แล้ว ห้ามแลกซ้ำ");
    const now = new Date();
    const id = crypto.randomUUID();
    const coupon: PointCoupon = couponSchema.parse({ id, code: `BLU-PTC-${id.replaceAll("-", "").toUpperCase()}`, offerId: offer.id,
      memberCode: account.memberCode, title: offer.title, detail: offer.detail, pointsSpent: offer.pointCost, status: "UNUSED",
      redeemedAt: now.toISOString(), expiresAt: new Date(now.getTime() + offer.validDays * 86_400_000).toISOString() });
    spendPointsInStore(state, account.memberCode, offer.pointCost, "POINT_COUPON", coupon.id, `แลก${offer.title}`, coupon.redeemedAt);
    account.pointCoupons.push(coupon);
    commitLocalStorageTransaction([{ key: MEMBER_ACCOUNT_KEY, value: serializeMemberAccountStore(state), errorMessage: "บันทึกคูปองแต้มไม่สำเร็จ ยังไม่หักแต้ม" }]);
    dispatchMemberAccountUpdated();
    return JSON.parse(JSON.stringify(coupon)) as PointCoupon;
  });
}
