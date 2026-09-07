import { z } from "zod";
import { mockRewards, type RewardItem } from "./mock-data";
import { mockAdminMembers, type RedemptionRecord } from "./admin-mock";
import { DESK_LOCK_KEY, DESK_UPDATED_EVENT, readDeskRewards, REWARD_STORAGE_KEY } from "./front-desk";

export const CATALOG_KEY = "blu_reward_catalog_mock_v1";
const rewardSchema = z.object({
  id: z.number().int().positive(), title: z.string().trim().min(1).max(120), titleEn: z.string(),
  description: z.string(), descriptionEn: z.string(),
  imageUrl: z.string().url().refine(url => url.startsWith("https://"), "รูปต้องเป็น HTTPS URL"),
  pointCost: z.number().int().min(1).max(1000000), stock: z.number().int().min(0).max(1000000), isActive: z.boolean(),
}).strict();
const catalogSchema = z.object({ version: z.literal(1), nextId: z.number().int().positive(), rewards: z.array(rewardSchema) }).strict();
function readCatalogState() {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (raw === null) return { version: 1 as const, nextId: Math.max(...mockRewards.map(r => r.id)) + 1, rewards: mockRewards.map(r => ({ ...r })) };
    const state = catalogSchema.parse(JSON.parse(raw));
    if (new Set(state.rewards.map(r => r.id)).size !== state.rewards.length || state.rewards.some(r => r.id >= state.nextId)) throw Error();
    return state;
  } catch { throw new Error("อ่านคลังรางวัลไม่ได้หรือข้อมูลเสียหาย กรุณาตรวจสอบ localStorage ก่อนทำรายการ"); }
}
export function readRewardCatalog(): RewardItem[] { return readCatalogState().rewards; }
export function remainingStock(reward: RewardItem, records: RedemptionRecord[]): number {
  return Math.max(0, reward.stock - records.filter(r => r.rewardId === reward.id).length);
}
export function rewardWallet(memberCode: string, records = readDeskRewards()) {
  const member = mockAdminMembers.find(m => m.memberCode === memberCode);
  if (!member) throw new Error("กระเป๋ารางวัล mock รองรับเฉพาะรายชื่อสมาชิกตัวอย่างของ Admin");
  // Seeds predate this wallet's opening balance. All newly requested rewards are persisted debits.
  return Math.max(0, member.points - records.filter(r => r.memberCode === memberCode && !r.id.startsWith("seed-")).reduce((sum, r) => sum + r.pointsSpent, 0));
}
async function locked<T>(action: () => T): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("ต้องใช้ Web Locks ผ่าน HTTPS หรือ localhost");
  return navigator.locks.request(DESK_LOCK_KEY, { mode: "exclusive" }, action);
}
function write(key: string, value: unknown) {
  const event = new CustomEvent(DESK_UPDATED_EVENT);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { throw new Error("บันทึกรางวัลไม่สำเร็จ ยังไม่ยืนยันรายการ กรุณาตรวจสอบพื้นที่จัดเก็บ"); }
  window.dispatchEvent(event);
}
export async function saveReward(value: RewardItem, expected: RewardItem | null): Promise<void> {
  const result = rewardSchema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues.map(i => i.message).join(" • "));
  const draft = result.data;
  const snapshot = expected && JSON.stringify(expected);
  await locked(() => {
    const state = readCatalogState();
    const old = state.rewards.find(r => r.id === draft.id);
    if ((old ? JSON.stringify(old) : null) !== snapshot || (!old && draft.id !== state.nextId)) throw new Error("รายการเปลี่ยนแล้ว กรุณาโหลดและแก้ไขใหม่");
    const reserved = readDeskRewards().filter(r => r.rewardId === draft.id).length;
    if (draft.stock < reserved) throw new Error("สต็อกรวมต้องไม่น้อยกว่าจำนวนที่จอง/รับไปแล้ว");
    state.rewards = [...state.rewards.filter(r => r.id !== draft.id), draft];
    if (!old) state.nextId++;
    write(CATALOG_KEY, state);
  });
}
export function newReward(): RewardItem {
  return { id: readCatalogState().nextId, title: "", titleEn: "", description: "รางวัล mock", descriptionEn: "Mock reward", imageUrl: mockRewards[0].imageUrl, pointCost: 1, stock: 1, isActive: true };
}
export async function removeReward(expected: RewardItem): Promise<"DISABLED" | "DELETED"> {
  const snapshot = JSON.stringify(expected);
  return locked(() => {
    const state = readCatalogState();
    const old = state.rewards.find(r => r.id === expected.id);
    if (!old || JSON.stringify(old) !== snapshot) throw new Error("รายการเปลี่ยนแล้ว กรุณาโหลดใหม่");
    const used = readDeskRewards().some(r => r.rewardId === old.id);
    if (used) old.isActive = false;
    else state.rewards = state.rewards.filter(r => r.id !== old.id);
    write(CATALOG_KEY, state);
    return used ? "DISABLED" : "DELETED";
  });
}
export async function requestMockReward(expected: RewardItem, memberCode: string): Promise<RedemptionRecord> {
  const snapshot = JSON.stringify(expected);
  return locked(() => {
    const reward = readRewardCatalog().find(r => r.id === expected.id);
    const records = readDeskRewards();
    if (!reward || JSON.stringify(reward) !== snapshot || !reward.isActive) throw new Error("รางวัลเปลี่ยนหรือปิดใช้งานแล้ว กรุณาโหลดใหม่");
    if (remainingStock(reward, records) < 1) throw new Error("รางวัลหมดแล้ว");
    if (records.some(r => r.memberCode === memberCode && r.rewardId === reward.id)) throw new Error("สมาชิกนี้แลกรางวัลนี้แล้ว ห้ามส่งซ้ำ");
    if (rewardWallet(memberCode, records) < reward.pointCost) throw new Error("แต้ม mock ไม่เพียงพอ");
    const member = mockAdminMembers.find(m => m.memberCode === memberCode)!;
    const code = `BLU-RW-${reward.id}-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
    const record: RedemptionRecord = { id: code, rewardCode: code, rewardId: reward.id, rewardTitle: reward.title, memberCode, memberName: member.fullName,
      pointsSpent: reward.pointCost, status: "PENDING", redeemedAt: new Date().toISOString() };
    // One journal write reserves stock and debits mock points atomically; collection only changes status.
    write(REWARD_STORAGE_KEY, [record, ...records]);
    return record;
  });
}
