import { getRedemptions, mockAdminMembers, type RedemptionRecord } from "./admin-mock";
import { createDemoMembers } from "./checkin";

// Legacy AUTO/DEMO coupon helpers are retained for regression tests only.
// New pages use member checkin, lookupRewardCode, and the persistent benefits wallet separately.
export type DeskMode = "AUTO" | "CHECKIN" | "REWARD" | "COUPON";
export type DeskAction = {
  kind: "REWARD" | "COUPON";
  code: string;
  memberCode: string;
  memberName: string;
  title: string;
  detail: string;
};
export type DeskLookup =
  | { kind: "CHECKIN"; code: string }
  | { kind: "ACTION"; action: DeskAction }
  | { kind: "ERROR"; message: string };

export const REWARD_STORAGE_KEY = "blu_redemptions";
export const COUPON_STORAGE_KEY = "blu_front_desk_demo_coupons_v1";
export const DESK_LOCK_KEY = "blu_front_desk";
export const DESK_UPDATED_EVENT = "blu-front-desk-updated";
export const DEMO_COUPON_CODES = { valid: "BLU-CP-DEMO01", expired: "BLU-CP-DEMO02", used: "BLU-CP-DEMO03" } as const;

interface DemoCoupon {
  code: string;
  memberCode: string;
  memberName: string;
  title: string;
  type: "BRING_FRIEND";
  demo: true;
  status: "UNUSED" | "USED";
  expiresAt: string;
  usedAt?: string;
}

// Deliberately separate fixtures, not member coupons or membership extensions.
const DEMO_COUPONS: DemoCoupon[] = [
  { code: DEMO_COUPON_CODES.valid, memberCode: "BLU-1001", memberName: "สมชาย ใจดี", title: "DEMO: พาเพื่อนมาออกกำลังกาย 1 คน", type: "BRING_FRIEND", demo: true, status: "UNUSED", expiresAt: "2099-12-31T23:59:59Z" },
  { code: DEMO_COUPON_CODES.expired, memberCode: "BLU-1012", memberName: "วิภาดา รักฟิต", title: "DEMO: พาเพื่อนมาออกกำลังกาย 1 คน", type: "BRING_FRIEND", demo: true, status: "UNUSED", expiresAt: "2020-01-01T00:00:00Z" },
  { code: DEMO_COUPON_CODES.used, memberCode: "BLU-1020", memberName: "ธีรภัทร ใจกล้า", title: "DEMO: พาเพื่อนมาออกกำลังกาย 1 คน", type: "BRING_FRIEND", demo: true, status: "USED", expiresAt: "2099-12-31T23:59:59Z", usedAt: "2026-09-01T09:00:00Z" },
];

const corrupt = () => new Error("ข้อมูลหน้าร้านเสียหายหรือรหัสซ้ำ กรุณาให้ผู้ดูแลตรวจสอบข้อมูลที่บันทึกไว้ก่อนลองใหม่");
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const timestamp = (value: unknown): value is string => text(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const memberCode = (value: unknown): value is string => typeof value === "string" && /^BLU-\d+$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    throw new Error("อ่านข้อมูลหน้าร้านไม่ได้ กรุณาอนุญาตการจัดเก็บข้อมูลในเบราว์เซอร์แล้วลองใหม่");
  }
}

function parseArray(raw: string | null): unknown[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return value;
  } catch { /* Report corruption rather than silently restoring unused fixtures. */ }
  throw corrupt();
}

function validateRewards(value: unknown[]): RedemptionRecord[] {
  if (!Array.isArray(value)) throw corrupt();
  const ids = new Set<string>();
  const codes = new Set<string>();
  for (const r of value) {
    if (!object(r) || !text(r.id) || !text(r.rewardCode) ||
      !/^BLU-RW-[1-9]\d*-[A-Z0-9]+$/.test(r.rewardCode) ||
      !Number.isSafeInteger(r.rewardId) || Number(r.rewardId) <= 0 ||
      Number(r.rewardCode.split("-")[2]) !== r.rewardId ||
      !text(r.rewardTitle) || !memberCode(r.memberCode) || !text(r.memberName) ||
      !Number.isSafeInteger(r.pointsSpent) || Number(r.pointsSpent) < 0 ||
      (r.status !== "PENDING" && r.status !== "COMPLETED") || !timestamp(r.redeemedAt) ||
      ("completedAt" in r && (!timestamp(r.completedAt) || r.status !== "COMPLETED")) ||
      ("source" in r && !text(r.source)) || ids.has(r.id) || codes.has(r.rewardCode)) throw corrupt();
    ids.add(r.id);
    codes.add(r.rewardCode);
  }
  return value as RedemptionRecord[];
}

export function readDeskRewards(): RedemptionRecord[] {
  // getRedemptions hides read/parse failures, so validate storage before invoking it.
  const raw = readRaw(REWARD_STORAGE_KEY);
  const stored = validateRewards(parseArray(raw));
  let merged: RedemptionRecord[];
  try {
    merged = validateRewards(getRedemptions());
  } catch {
    throw corrupt();
  }
  if (readRaw(REWARD_STORAGE_KEY) !== raw || stored.some((r) =>
    !merged.some((m) => JSON.stringify(m) === JSON.stringify(r)))) throw corrupt();
  return merged.map((r) => ({ ...r }));
}

function readCoupons(): DemoCoupon[] {
  const stored = parseArray(readRaw(COUPON_STORAGE_KEY));
  const codes = new Set<string>();
  for (const c of stored) {
    if (!object(c) || !text(c.code) || !DEMO_COUPONS.some((seed) => seed.code === c.code) ||
      !memberCode(c.memberCode) || !text(c.memberName) || !text(c.title) ||
      c.type !== "BRING_FRIEND" || c.demo !== true ||
      (c.status !== "UNUSED" && c.status !== "USED") || !timestamp(c.expiresAt) ||
      (c.status === "USED" ? !timestamp(c.usedAt) : "usedAt" in c) || codes.has(c.code)) throw corrupt();
    codes.add(c.code);
  }
  return [...stored as DemoCoupon[], ...DEMO_COUPONS.filter((c) => !codes.has(c.code))].map((c) => ({ ...c }));
}

function rewardAction(r: RedemptionRecord): DeskAction {
  if (r.status !== "PENDING") throw new Error("รายการนี้รับรางวัลแล้ว กรุณาตรวจสอบประวัติ ห้ามส่งมอบซ้ำ");
  return { kind: "REWARD", code: r.rewardCode, memberCode: r.memberCode, memberName: r.memberName, title: r.rewardTitle,
    detail: `ใช้ไปแล้ว ${r.pointsSpent} แต้ม • แลกเมื่อ ${r.redeemedAt} • รายการ ${r.id} • ยืนยันรับของเท่านั้น ไม่หักแต้มซ้ำ` };
}

function couponAction(c: DemoCoupon, now: Date): DeskAction {
  if (c.status !== "UNUSED") throw new Error("คูปอง DEMO นี้ใช้แล้ว กรุณาตรวจสอบประวัติ ห้ามใช้ซ้ำ");
  if (Date.parse(c.expiresAt) <= now.getTime()) throw new Error("คูปอง DEMO หมดอายุแล้ว กรุณาใช้รหัสที่ยังไม่หมดอายุ");
  return { kind: "COUPON", code: c.code, memberCode: c.memberCode, memberName: c.memberName, title: c.title,
    detail: `ข้อมูล DEMO แยกจากคูปองสมาชิกจริง • พาเพื่อน 1 คน • หมดอายุ ${c.expiresAt} • ไม่ต่ออายุสมาชิกและไม่หักแต้ม` };
}

function resolve(code: string, mode: DeskMode, now: Date): DeskLookup {
  if (!Number.isFinite(now.getTime())) throw new Error("วันเวลาไม่ถูกต้อง กรุณาตรวจสอบวันเวลาของเครื่องแล้วลองใหม่");
  if (!["AUTO", "CHECKIN", "REWARD", "COUPON"].includes(mode)) throw new Error("โหมดไม่ถูกต้อง กรุณาเลือกโหมดหน้าร้านใหม่");
  const normalized = code.trim().toUpperCase();
  if (!normalized || normalized.length > 100 || !/^[A-Z0-9-]+$/.test(normalized)) {
    throw new Error("รูปแบบรหัสไม่ถูกต้อง กรุณาสแกนเฉพาะรหัสสมาชิก บัตร รางวัล หรือคูปอง DEMO");
  }
  const rewards = readDeskRewards().filter((r) => r.rewardCode === normalized);
  const coupons = readCoupons().filter((c) => c.code === normalized);
  const members = [...createDemoMembers(now), ...mockAdminMembers].filter((m) => m.memberCode === normalized || m.cardNumber === normalized);
  const identities = new Set(members.map((m) => m.memberCode));
  // Only explicit member grammar is routed onward; checkin owns membership eligibility/unknown IDs.
  const checkin = identities.size > 0 || /^BLU-\d+$/.test(normalized);
  if (identities.size > 1 || rewards.length + coupons.length + Number(checkin) > 1) throw corrupt();
  const kind = rewards.length ? "REWARD" : coupons.length ? "COUPON" : checkin ? "CHECKIN" : null;
  if (!kind) throw new Error("ไม่พบรหัสนี้ กรุณาตรวจสอบรหัส หรือใช้คูปอง DEMO ของหน้าร้านเท่านั้น");
  if (mode !== "AUTO" && mode !== kind) throw new Error("รหัสไม่ตรงกับโหมดที่เลือก กรุณาเปลี่ยนเป็นโหมดอัตโนมัติหรือเลือกโหมดให้ตรงกับรหัส");
  if (kind === "CHECKIN") return { kind, code: normalized };
  return { kind: "ACTION", action: kind === "REWARD" ? rewardAction(rewards[0]) : couponAction(coupons[0], now) };
}

export function lookupRewardCode(code: string): DeskAction {
  const normalized = code.trim().toUpperCase();
  const record = readDeskRewards().find(r => r.rewardCode === normalized);
  if (!record) throw new Error("ไม่พบรหัสรับรางวัล ใช้รหัส BLU-RW-… เท่านั้น");
  return rewardAction(record);
}

export function lookupDeskCode(code: string, mode: DeskMode, now: Date): DeskLookup {
  try {
    return resolve(code, mode, now);
  } catch (error) {
    return { kind: "ERROR", message: error instanceof Error ? error.message : "ตรวจสอบรหัสไม่ได้ กรุณาลองใหม่หรือติดต่อผู้ดูแล" };
  }
}

function write(key: string, records: unknown[]): void {
  // Construct notification before committing so unsupported APIs cannot cause a partial operation.
  const event = new CustomEvent(DESK_UPDATED_EVENT);
  try {
    localStorage.setItem(key, JSON.stringify(records));
  } catch {
    throw new Error("บันทึกไม่สำเร็จ ยังไม่ควรส่งมอบสิทธิ์ กรุณาตรวจสอบพื้นที่จัดเก็บและสิทธิ์เบราว์เซอร์แล้วสแกนใหม่");
  }
  window.dispatchEvent(event);
}

export async function confirmDeskAction(action: DeskAction, now: Date): Promise<void> {
  if (typeof navigator === "undefined" || typeof navigator.locks?.request !== "function") {
    throw new Error("เบราว์เซอร์นี้ไม่รองรับการยืนยันสิทธิ์อย่างปลอดภัย กรุณาใช้เบราว์เซอร์ที่รองรับ Web Locks ผ่าน HTTPS");
  }
  const snapshot = { ...action };
  const requestedAt = now.getTime();
  const waitStartedAt = performance.now();
  await navigator.locks.request(DESK_LOCK_KEY, { mode: "exclusive" }, () => {
    // Keep the caller's injectable time origin, but do not freeze expiry while queued.
    const elapsed = performance.now() - waitStartedAt;
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error("ตรวจสอบเวลารอไม่ได้ กรุณาสแกนและยืนยันรายการใหม่");
    const confirmedAt = new Date(requestedAt + elapsed);
    if (snapshot.kind !== "REWARD" && snapshot.kind !== "COUPON") throw new Error("ประเภทสิทธิ์ไม่ถูกต้อง กรุณาสแกนใหม่");
    if (!Number.isFinite(confirmedAt.getTime())) throw new Error("วันเวลาไม่ถูกต้อง กรุณาสแกนใหม่");
        const current: DeskLookup = snapshot.kind === "REWARD"
          ? { kind: "ACTION", action: lookupRewardCode(snapshot.code) }
          : resolve(snapshot.code, snapshot.kind, confirmedAt);
    const fields: (keyof DeskAction)[] = ["kind", "code", "memberCode", "memberName", "title", "detail"];
    if (current.kind !== "ACTION" || fields.some((field) => current.action[field] !== snapshot[field])) {
      throw new Error("ข้อมูลสิทธิ์เปลี่ยนจากที่แสดง กรุณาสแกนใหม่และตรวจสอบก่อนยืนยัน");
    }
    if (snapshot.kind === "REWARD") {
      const records = readDeskRewards();
      const record = records.find((r) => r.rewardCode === snapshot.code);
      if (!record || fields.some((field) => rewardAction(record)[field] !== snapshot[field])) throw corrupt();
      write(REWARD_STORAGE_KEY, records.map((r) => r === record
        ? { ...r, status: "COMPLETED", completedAt: confirmedAt.toISOString() }
        : r));
    } else {
      const records = readCoupons();
      const record = records.find((c) => c.code === snapshot.code);
      if (!record || fields.some((field) => couponAction(record, confirmedAt)[field] !== snapshot[field])) throw corrupt();
      record.status = "USED";
      record.usedAt = confirmedAt.toISOString();
      write(COUPON_STORAGE_KEY, records);
    }
  });
}
