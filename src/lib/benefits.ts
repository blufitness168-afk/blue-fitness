import { z } from "zod";
import { mockAdminMembers } from "./admin-mock";
import { mockPackages, type MockPackage } from "./mock-data";
import {
  MEMBER_ACCOUNT_KEY, MEMBER_ACCOUNT_LOCK_KEY, commitLocalStorageTransaction, creditAdminCouponPointsInStore, dispatchMemberAccountUpdated,
  readMemberAccountStore, recordPurchaseInStore, serializeMemberAccountStore, type MemberAccountStore,
} from "./member-account";

const DAY_MS = 86400000;

export const BENEFITS_KEY = "blu_benefits_mock_v1";
export const BENEFITS_EVENT = "blu-benefits-updated";
const date = z.string().datetime({ offset: true });
const money = z.number().int().min(0).max(10000000); // Integer baht in this prototype.
const definitionSchema = z.object({
  id: z.string().uuid(), kind: z.enum(["PROMO", "COUPON"]),
  name: z.string().trim().min(1).max(120), code: z.string().regex(/^[A-Z0-9-]{3,40}$/),
  active: z.boolean(), expiresAt: date, quota: z.number().int().min(1).max(100000),
  maxUses: z.number().int().min(1).max(100000).default(100),
  discountType: z.enum(["FIXED", "PERCENT"]), amount: money, minSpend: money,
  couponType: z.enum(["DISCOUNT", "GIFT", "FREE", "BONUS_POINTS", "OTHER"]).default("FREE"),
  unit: z.enum(["BAHT", "PERCENT", "POINTS"]).default("BAHT"),
  maxCondition: money.default(0), conditionUnit: z.enum(["BAHT", "POINTS"]).default("BAHT"),
  perPerson: z.number().int().min(1).max(100).default(1), validDays: z.number().int().min(0).max(3650).default(30),
  noFixedExpiry: z.boolean().default(false),
  benefit: z.enum(["BRING_FRIEND", "EXTRA_DAYS"]), detail: z.string().trim().min(1).max(300),
}).strict().superRefine((d, ctx) => {
  if (d.amount < 1 || (d.kind === "PROMO" && d.discountType === "PERCENT" && d.amount > 100) || (d.kind === "COUPON" && d.unit === "PERCENT" && d.amount > 100)) {
    ctx.addIssue({ code: "custom", message: "จำนวนสิทธิ์/ส่วนลดไม่ถูกต้อง (เปอร์เซ็นต์ไม่เกิน 100)" });
  }
  // Old v1 values above this limit fail closed, including immutable issued terms.
  if (d.kind === "COUPON" && d.benefit === "EXTRA_DAYS" && d.amount > 3650) {
    ctx.addIssue({ code: "custom", message: "วันแถมต้องไม่เกิน 3650 วัน" });
  }
  if (d.kind === "COUPON" && d.couponType === "BONUS_POINTS" && (d.unit !== "POINTS" || d.benefit === "EXTRA_DAYS")) {
    ctx.addIssue({ code: "custom", message: "คูปองแต้มเพิ่มต้องใช้หน่วยแต้มและรูปแบบสิทธิ์ทั่วไป" });
  }
});
export type BenefitDefinition = z.infer<typeof definitionSchema>;
export type BenefitKind = BenefitDefinition["kind"];
const grantSchema = z.object({
  id: z.string().uuid(), code: z.string().regex(/^BLU-(CP|PC)-[A-F0-9-]{36}$/),
  definition: definitionSchema, memberCode: z.string().regex(/^BLU-\d+$/), memberName: z.string().min(1),
  batchId: z.string().uuid(), issuedAt: date, status: z.enum(["UNUSED", "USED"]),
  usedAt: date.optional(), paymentId: z.string().uuid().optional(), paidAmount: money.optional(),
}).strict();
export type BenefitGrant = z.infer<typeof grantSchema>;
const membershipSchema = z.object({
  memberCode: z.string().regex(/^BLU-\d+$/), expiresAt: date, startedAt: date,
  name: z.string().trim().min(1).max(120), timeSlot: z.enum(["07:00-14:00", "07:00-22:00"]),
  totalDays: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  friendCouponsLeft: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict().refine(m => Date.parse(m.expiresAt) > Date.parse(m.startedAt), "ช่วงอายุสมาชิกไม่ถูกต้อง");
export type MockMembership = z.infer<typeof membershipSchema>;
const stateSchema = z.object({
  memberships: z.array(membershipSchema).default([]),
  version: z.literal(1), revision: z.number().int().nonnegative(), definitions: z.array(definitionSchema), grants: z.array(grantSchema),
  batches: z.array(z.object({ id: z.string().uuid(), definitionId: z.string().uuid(), mode: z.enum(["SELECTED", "ALL"]), memberCodes: z.array(z.string()), createdAt: date }).strict()),
}).strict();
export type BenefitsState = z.infer<typeof stateSchema>;
export type GrantPlan = { revision: number; batchId: string; definitionId: string; mode: "SELECTED" | "ALL"; memberCodes: string[]; newCodes: string[]; skipped: number };

// Demo campaigns make the admin screens useful on a fresh browser while keeping production wiring unchanged.
const PROMO_DEMO_A: BenefitDefinition = {
  id: "00000000-0000-4000-8000-000000000001", kind: "PROMO", name: "สมาชิกใหม่ ลด 100 บาท", code: "WELCOME100", active: true,
  expiresAt: "2026-12-31T23:59:59+07:00", quota: 100, maxUses: 100, discountType: "FIXED", amount: 100, minSpend: 500,
  couponType: "FREE", unit: "BAHT", maxCondition: 0, conditionUnit: "BAHT", perPerson: 1, validDays: 30, noFixedExpiry: false,
  benefit: "BRING_FRIEND", detail: "ส่วนลดสำหรับสมาชิกใหม่ เมื่อซื้อแพ็กเกจตั้งแต่ 500 บาทขึ้นไป",
};
const PROMO_DEMO_B: BenefitDefinition = {
  id: "00000000-0000-4000-8000-000000000002", kind: "PROMO", name: "ต่ออายุสมาชิก ลด 10%", code: "RENEW10", active: true,
  expiresAt: "2026-11-30T23:59:59+07:00", quota: 50, maxUses: 50, discountType: "PERCENT", amount: 10, minSpend: 900,
  couponType: "FREE", unit: "BAHT", maxCondition: 0, conditionUnit: "BAHT", perPerson: 1, validDays: 30, noFixedExpiry: false,
  benefit: "BRING_FRIEND", detail: "ส่วนลดต่ออายุแพ็กเกจ สูงสุด 10% เมื่อซื้อแพ็กเกจตั้งแต่ 900 บาท",
};
const PROMO_DEMO_GRANTS: BenefitGrant[] = [
  { id: "00000000-0000-4000-8000-000000000011", code: "BLU-PC-00000000-0000-4000-8000-000000000011", definition: { ...PROMO_DEMO_A }, memberCode: "BLU-1001", memberName: "สมชาย ใจดี", batchId: "00000000-0000-4000-8000-000000000101", issuedAt: "2026-09-15T02:00:00.000Z", status: "UNUSED" },
  { id: "00000000-0000-4000-8000-000000000012", code: "BLU-PC-00000000-0000-4000-8000-000000000012", definition: { ...PROMO_DEMO_A }, memberCode: "BLU-1012", memberName: "วิภาดา รักฟิต", batchId: "00000000-0000-4000-8000-000000000101", issuedAt: "2026-09-15T02:00:00.000Z", status: "USED", usedAt: "2026-09-16T03:30:00.000Z", paymentId: "00000000-0000-4000-8000-000000000201", paidAmount: 900 },
  { id: "00000000-0000-4000-8000-000000000013", code: "BLU-PC-00000000-0000-4000-8000-000000000013", definition: { ...PROMO_DEMO_B }, memberCode: "BLU-1020", memberName: "ธีรภัทร ใจกล้า", batchId: "00000000-0000-4000-8000-000000000102", issuedAt: "2026-09-17T02:00:00.000Z", status: "UNUSED" },
  { id: "00000000-0000-4000-8000-000000000014", code: "BLU-PC-00000000-0000-4000-8000-000000000014", definition: { ...PROMO_DEMO_B }, memberCode: "BLU-1025", memberName: "กัลยา ศรีสุข", batchId: "00000000-0000-4000-8000-000000000102", issuedAt: "2026-09-17T02:00:00.000Z", status: "USED", usedAt: "2026-09-18T04:15:00.000Z", paymentId: "00000000-0000-4000-8000-000000000202", paidAmount: 2430 },
];
const PROMO_DEMO_STATE: BenefitsState = {
  version: 1, revision: 0, memberships: [], definitions: [PROMO_DEMO_A, PROMO_DEMO_B], grants: PROMO_DEMO_GRANTS,
  batches: [
    { id: "00000000-0000-4000-8000-000000000101", definitionId: PROMO_DEMO_A.id, mode: "SELECTED", memberCodes: ["BLU-1001", "BLU-1012"], createdAt: "2026-09-15T02:00:00.000Z" },
    { id: "00000000-0000-4000-8000-000000000102", definitionId: PROMO_DEMO_B.id, mode: "SELECTED", memberCodes: ["BLU-1020", "BLU-1025"], createdAt: "2026-09-17T02:00:00.000Z" },
  ],
};
function initialBenefitsState(): BenefitsState { return structuredClone(PROMO_DEMO_STATE); }
function addPromoDemoIfMissing(state: BenefitsState): BenefitsState {
  if (state.grants.some(grant => grant.definition.kind === "PROMO")) return state;
  const demo = initialBenefitsState();
  return {
    ...state,
    definitions: [...state.definitions, ...demo.definitions.filter(definition => !state.definitions.some(current => current.id === definition.id || (current.kind === "PROMO" && current.code === definition.code)))],
    grants: [...state.grants, ...demo.grants],
    batches: [...state.batches, ...demo.batches.filter(batch => !state.batches.some(current => current.id === batch.id))],
  };
}
const fail = (message: string): never => { throw new Error(message); };
function unique(values: string[]) { return new Set(values).size === values.length; }
export function parseBenefits(raw: string | null): BenefitsState {
  if (raw === null) return initialBenefitsState();
  try {
    const s = stateSchema.parse(JSON.parse(raw));
    if (!unique(s.memberships.map(m => m.memberCode)) || !unique(s.definitions.map(d => d.id)) || !unique(s.definitions.map(d => `${d.kind}:${d.code}`)) ||
      !unique(s.grants.map(g => g.id)) || !unique(s.grants.map(g => g.code)) ||
      !unique(s.batches.map(b => b.id)) || !unique(s.grants.flatMap(g => g.paymentId ? [g.paymentId] : []))) throw Error();
    for (const d of s.definitions) {
      if (s.grants.filter(g => g.definition.id === d.id).length > d.quota) throw Error();
    }
    for (const g of s.grants) {
      const b = s.batches.find(b => b.id === g.batchId);
      if (!s.definitions.some(d => d.id === g.definition.id && d.kind === g.definition.kind) || !b || b.definitionId !== g.definition.id ||
        !b.memberCodes.includes(g.memberCode) || g.issuedAt !== b.createdAt || !g.definition.active ||
        Date.parse(g.issuedAt) >= Date.parse(g.definition.expiresAt) ||
        g.code !== `BLU-${g.definition.kind === "COUPON" ? "CP" : "PC"}-${g.id.toUpperCase()}` ||
        (g.status === "USED") !== !!g.usedAt || (g.usedAt && (Date.parse(g.usedAt) < Date.parse(g.issuedAt) || Date.parse(g.usedAt) >= Date.parse(g.definition.expiresAt))) ||
        (g.status === "USED" && g.definition.kind === "PROMO" ? !g.paymentId || g.paidAmount === undefined : g.paymentId !== undefined || g.paidAmount !== undefined)) throw Error();
    }
    for (const b of s.batches) {
      if (!b.memberCodes.length || !s.definitions.some(d => d.id === b.definitionId) ||
        b.memberCodes.some(code => !s.grants.some(g => g.batchId === b.id && g.memberCode === code)) ||
        s.grants.filter(g => g.batchId === b.id).length !== b.memberCodes.length) throw Error();
    }
    return addPromoDemoIfMissing(s);
  } catch { return fail("ข้อมูลสิทธิ์ mock เสียหาย ระบบหยุดทำรายการ กรุณาตรวจสอบ localStorage (ไม่รีเซ็ตสิทธิ์อัตโนมัติ)"); }
}
export function readBenefits(): BenefitsState {
  let raw: string | null;
  try { raw = localStorage.getItem(BENEFITS_KEY); } catch { return fail("อ่านข้อมูลสิทธิ์ไม่ได้ กรุณาอนุญาตพื้นที่จัดเก็บเบราว์เซอร์"); }
  return parseBenefits(raw);
}
async function writeBenefits<T>(operation: (state: BenefitsState, now: Date, accounts: MemberAccountStore | null) => T, withAccounts = false): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) return fail("ต้องใช้ Web Locks ผ่าน HTTPS หรือ localhost จึงจะบันทึกได้");
  const execute = () => {
    const state = readBenefits();
    const accounts = withAccounts ? readMemberAccountStore() : null;
    const result = operation(state, new Date(), accounts);
    state.revision++;
    const serialized = JSON.stringify(state);
    parseBenefits(serialized);
    const writes = [{ key: BENEFITS_KEY, value: serialized, errorMessage: "บันทึกไม่สำเร็จ ยังไม่ได้แจก/ใช้สิทธิ์ กรุณาตรวจสอบพื้นที่จัดเก็บ" }];
    if (accounts) writes.push({ key: MEMBER_ACCOUNT_KEY, value: serializeMemberAccountStore(accounts), errorMessage: "บันทึกบัญชีสมาชิกไม่สำเร็จ ยังไม่ยืนยันการซื้อ" });
    commitLocalStorageTransaction(writes);
    window.dispatchEvent(new CustomEvent(BENEFITS_EVENT));
    if (accounts) dispatchMemberAccountUpdated();
    return result;
  };
  if (!withAccounts) return navigator.locks.request(BENEFITS_KEY, { mode: "exclusive" }, execute);
  // Global account lock is always acquired before the narrower benefits lock to avoid deadlocks.
  return navigator.locks.request(MEMBER_ACCOUNT_LOCK_KEY, { mode: "exclusive" }, () =>
    navigator.locks.request(BENEFITS_KEY, { mode: "exclusive" }, execute));
}
export function newDefinition(kind: BenefitKind): BenefitDefinition {
  const bangkokDay = new Date(Date.now() + 30 * DAY_MS + 7 * 3600000).toISOString().slice(0, 10);
  return { id: crypto.randomUUID(), kind, name: "", code: "", active: true, expiresAt: kind === "COUPON" ? "9999-12-31T23:59:59+07:00" : `${bangkokDay}T23:59:59+07:00`, quota: 100, maxUses: 100,
    discountType: "FIXED", amount: 1, minSpend: 0, couponType: "FREE", unit: "BAHT", maxCondition: 0, conditionUnit: "BAHT", perPerson: 1, validDays: 30,
    noFixedExpiry: kind === "COUPON", benefit: "BRING_FRIEND", detail: kind === "PROMO" ? "ส่วนลดแพ็กเกจ (mock)" : "พาเพื่อนมาออกกำลังกาย (mock)" };
}
export async function saveDefinition(value: BenefitDefinition, expected: BenefitDefinition | null): Promise<void> {
  const parsed = definitionSchema.safeParse(value);
  if (!parsed.success) return fail(parsed.error.issues.map(i => i.message).join(" • "));
  const draft = parsed.data;
  const snapshot = expected && JSON.stringify(expected);
  await writeBenefits(s => {
    const old = s.definitions.find(d => d.id === draft.id);
    if ((old ? JSON.stringify(old) : null) !== snapshot || (old && old.kind !== draft.kind)) return fail("รายการเปลี่ยนแล้ว กรุณาโหลดและแก้ไขใหม่");
    if (s.definitions.some(d => d.id !== draft.id && d.kind === draft.kind && d.code === draft.code)) return fail("รหัสนิยามซ้ำ");
    if (draft.quota < s.grants.filter(g => g.definition.id === draft.id).length) return fail("โควต้าต้องไม่น้อยกว่าจำนวนที่แจกแล้ว");
    if (draft.maxUses < s.grants.filter(g => g.definition.id === draft.id && g.status === "USED").length) return fail("จำนวนครั้งสูงสุดต้องไม่น้อยกว่าจำนวนที่ใช้แล้ว");
    s.definitions = [...s.definitions.filter(d => d.id !== draft.id), draft];
  });
}
export async function removeDefinition(expected: BenefitDefinition): Promise<"DISABLED" | "DELETED"> {
  const snapshot = JSON.stringify(expected);
  return writeBenefits(s => {
    const old = s.definitions.find(d => d.id === expected.id);
    if (!old || JSON.stringify(old) !== snapshot) return fail("รายการเปลี่ยนแล้ว กรุณาโหลดใหม่");
    if (s.grants.some(g => g.definition.id === old.id)) { old.active = false; return "DISABLED"; }
    s.definitions = s.definitions.filter(d => d.id !== old.id);
    return "DELETED";
  });
}
export function resolveBenefitMember(code: string) {
  const normalized = code.trim().toUpperCase();
  const matches = mockAdminMembers.filter(m => m.memberCode === normalized || m.cardNumber === normalized);
  if (matches.length !== 1) return fail("ไม่พบสมาชิกหรือรหัสซ้ำกำกวม: ใช้รหัส BLU-… หรือเลขบัตร CARD-… เท่านั้น");
  return matches[0];
}
function usableDefinition(s: BenefitsState, id: string, now: Date) {
  const d = s.definitions.find(d => d.id === id);
  if (!d || !d.active || !Number.isFinite(now.getTime()) || Date.parse(d.expiresAt) <= now.getTime()) return fail("สิทธิ์ปิดใช้งานหรือหมดอายุแล้ว");
  return d;
}
function planFor(s: BenefitsState, id: string, codes: string[], mode: GrantPlan["mode"], batchId: string, now: Date): GrantPlan {
  const d = usableDefinition(s, id, now);
  if (!codes.length || !unique(codes) || codes.some(c => !mockAdminMembers.some(m => m.memberCode === c))) return fail("กรุณาเลือกสมาชิกที่ถูกต้องอย่างน้อย 1 คน โดยไม่ซ้ำกัน");
  const prior = s.grants.filter(g => g.definition.id === id);
  const newCodes = codes.flatMap(code => Array.from({ length: Math.max(0, d.perPerson - prior.filter(g => g.memberCode === code).length) }, () => code));
  if (!newCodes.length) return fail("สมาชิกที่เลือกได้รับสิทธิ์ครบจำนวนต่อคนแล้วทั้งหมด");
  if (prior.length + newCodes.length > d.quota) return fail("โควต้าแจกไม่พอ กรุณาลดผู้รับหรือแก้ไขโควต้า");
  return { revision: s.revision, batchId, definitionId: id, mode, memberCodes: [...codes], newCodes, skipped: codes.filter(code => prior.filter(g => g.memberCode === code).length >= d.perPerson).length };
}
export function previewGrant(id: string, selected: string[], mode: GrantPlan["mode"], now = new Date(), allRecipients?: string[]): GrantPlan {
  return planFor(readBenefits(), id, mode === "ALL" ? [...new Set(allRecipients ?? mockAdminMembers.map(m => m.memberCode))] : [...new Set(selected)], mode, crypto.randomUUID(), now);
}
function issuedDefinition(definition: BenefitDefinition, now: Date): BenefitDefinition {
  if (definition.kind !== "COUPON") return { ...definition };
  const normalExpiry = now.getTime() + (definition.validDays === 0 ? 10 * 60_000 : definition.validDays * DAY_MS);
  const fixedExpiry = definition.noFixedExpiry ? Number.POSITIVE_INFINITY : Date.parse(definition.expiresAt);
  return { ...definition, expiresAt: new Date(Math.min(normalExpiry, fixedExpiry)).toISOString() };
}

export async function commitGrant(plan: GrantPlan): Promise<number> {
  const snapshot: GrantPlan = JSON.parse(JSON.stringify(plan));
  return writeBenefits((s, now) => {
    if (s.batches.some(b => b.id === snapshot.batchId)) return fail("รายการแจกนี้บันทึกแล้ว ห้ามส่งซ้ำ");
    const current = planFor(s, snapshot.definitionId, snapshot.memberCodes, snapshot.mode, snapshot.batchId, now);
    if (JSON.stringify(current) !== JSON.stringify(snapshot)) return fail("ข้อมูลเปลี่ยนหลังแสดงจำนวน กรุณาตรวจสอบผู้รับและยืนยันใหม่");
    const definition = usableDefinition(s, snapshot.definitionId, now);
    s.batches.push({ id: snapshot.batchId, definitionId: definition.id, mode: snapshot.mode, memberCodes: [...snapshot.newCodes], createdAt: now.toISOString() });
    for (const code of snapshot.newCodes) {
      const member = resolveBenefitMember(code);
      const id = crypto.randomUUID();
      s.grants.push({ id, code: `BLU-${definition.kind === "COUPON" ? "CP" : "PC"}-${id.toUpperCase()}`, definition: issuedDefinition(definition, now), memberCode: member.memberCode,
        memberName: member.fullName, batchId: snapshot.batchId, issuedAt: now.toISOString(), status: "UNUSED" });
    }
    return snapshot.newCodes.length;
  });
}
function unusedGrant(s: BenefitsState, code: string, kind: BenefitKind, now: Date) {
  const g = s.grants.find(g => g.code === code.trim().toUpperCase() && g.definition.kind === kind);
  if (!g) return fail("ไม่พบรหัสสิทธิ์ที่แจกในกระเป๋า mock นี้ (ไม่รับรหัส DEMO รุ่นเก่า)");
  if (g.status !== "UNUSED") return fail("สิทธิ์นี้ใช้แล้ว ห้ามใช้ซ้ำ");
  // Disabling a definition also suspends outstanding grants. Issued terms otherwise remain immutable.
  const current = s.definitions.find(d => d.id === g.definition.id);
  if (!current?.active || !Number.isFinite(now.getTime()) || Date.parse(g.definition.expiresAt) <= now.getTime()) return fail("สิทธิ์หมดอายุหรือถูกระงับ");
  if (s.grants.filter(item => item.definition.id === g.definition.id && item.status === "USED").length >= current.maxUses) return fail("โค้ดส่วนลดหรือคูปองครบจำนวนครั้งสูงสุดแล้ว");
  return g;
}
export function previewCoupon(code: string, now = new Date()): BenefitGrant { return unusedGrant(readBenefits(), code, "COUPON", now); }
/** EXTRA_DAYS extends an existing membership atomically. BRING_FRIEND only records use; it does not operate a physical gate. */
export async function redeemCoupon(expected: BenefitGrant): Promise<void> {
  const snapshot = JSON.stringify(expected);
  const code = expected.code;
  await writeBenefits((s, now, accounts) => {
    const g = unusedGrant(s, code, "COUPON", now);
    if (JSON.stringify(g) !== snapshot) return fail("สิทธิ์เปลี่ยนแล้ว กรุณาสแกนใหม่");
    if (g.definition.benefit === "EXTRA_DAYS") {
      const membership = s.memberships.find(m => m.memberCode === g.memberCode);
      if (!membership) return fail("ไม่พบข้อมูลสมาชิกแพ็กเกจสำหรับเพิ่มวัน กรุณาซื้อแพ็กเกจก่อน");
      extendMembership(membership, g.definition.amount, now);
    }
    if (g.definition.couponType === "BONUS_POINTS") {
      if (!accounts) return fail("ไม่พบบัญชีสมาชิกสำหรับเพิ่มแต้ม");
      creditAdminCouponPointsInStore(accounts, g.memberCode, g.definition.amount, g.id, `ใช้คูปอง ${g.definition.name}`, now.toISOString());
    }
    g.status = "USED"; g.usedAt = now.toISOString();
  }, true);
}
/** Reads only the shared benefits state; never seeds membership from legacy/demo UI data. Unknown members return null; corrupt storage throws. */
export function readMembership(memberCode: string): MockMembership | null {
  return readBenefits().memberships.find(m => m.memberCode === memberCode) ?? null;
}
function extendMembership(membership: MockMembership, days: number, now: Date) {
  membership.expiresAt = new Date(Math.max(now.getTime(), Date.parse(membership.expiresAt)) + days * DAY_MS).toISOString();
  membership.totalDays += days;
}
export type MockPackagePurchase = Pick<MockPackage, "id" | "name" | "timeSlot" | "price" | "durationDays" | "bonusDays" | "friendCoupons">;

/**
 * Mock checkout: canonical active packages only; null means no promo (no public/legacy codes).
 * Captures inputs before locking, re-quotes assigned promos under the benefits lock, then writes
 * membership and promo consumption in one localStorage operation. Failure consumes neither.
 * Days/coupons accumulate; original startedAt is retained and the latest package supplies name/slot.
 * No-promo purchases are intentional renewals: callers must guard duplicate UI submissions.
 */
export async function purchaseMockPackage(memberCode: string, pkg: MockPackagePurchase, expected: MockPayment | null): Promise<void> {
  const draft = { ...pkg };
  const snapshot = expected === null ? null : { ...expected };
  const purchaseId = snapshot?.paymentId ?? crypto.randomUUID();
  await writeBenefits((s, now, accounts) => {
    if (resolveBenefitMember(memberCode).memberCode !== memberCode) return fail("กรุณาใช้รหัสสมาชิก BLU ที่ถูกต้อง");
    const canonical = mockPackages.find(p => p.id === draft.id && p.isActive);
    const keys = ["id", "name", "timeSlot", "price", "durationDays", "bonusDays", "friendCoupons"] as const;
    if (!canonical || keys.some(key => draft[key] !== canonical[key])) return fail("แพ็กเกจเปลี่ยนหรือไม่ถูกต้อง กรุณาเลือกใหม่");
    if (snapshot !== null) {
      if (snapshot.memberCode !== memberCode || snapshot.subtotal !== canonical.price) return fail("ยอดชำระหรือสมาชิกไม่ตรงกับแพ็กเกจ");
      const current = quote(s, snapshot.grantCode, memberCode, canonical.price, snapshot.paymentId, now);
      if (JSON.stringify(current) !== JSON.stringify(snapshot) || s.grants.some(g => g.paymentId === snapshot.paymentId)) return fail("รายการชำระเปลี่ยนหรือบันทึกแล้ว กรุณาตรวจสอบใหม่");
      const g = unusedGrant(s, snapshot.grantCode, "PROMO", now);
      g.status = "USED"; g.usedAt = now.toISOString(); g.paymentId = snapshot.paymentId; g.paidAmount = current.total;
    }
    const days = canonical.durationDays + canonical.bonusDays;
    const prior = s.memberships.find(m => m.memberCode === memberCode);
    if (prior) {
      extendMembership(prior, days, now);
      prior.name = canonical.name; prior.timeSlot = canonical.timeSlot;
      prior.friendCouponsLeft += canonical.friendCoupons;
    } else {
      s.memberships.push({ memberCode, startedAt: now.toISOString(), expiresAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
        name: canonical.name, timeSlot: canonical.timeSlot, totalDays: days, friendCouponsLeft: canonical.friendCoupons });
    }
    if (!accounts) return fail("ไม่พบบัญชีสมาชิกสำหรับบันทึกการซื้อ");
    const paidAmount = snapshot?.total ?? canonical.price;
    recordPurchaseInStore(accounts, { id: purchaseId, memberCode, packageId: canonical.id, packageName: canonical.name,
      subtotal: canonical.price, discount: canonical.price - paidAmount, paidAmount, purchasedAt: now.toISOString(), promoCode: snapshot?.grantCode });
  }, true);
}
export type MockPayment = { revision: number; grantCode: string; memberCode: string; subtotal: number; discount: number; total: number; paymentId: string };
function quote(s: BenefitsState, code: string, memberCode: string, subtotal: number, paymentId: string, now: Date): MockPayment {
  const g = unusedGrant(s, code, "PROMO", now);
  if (g.memberCode !== memberCode) return fail("โค้ดนี้ไม่ได้แจกให้สมาชิกที่เลือก");
  if (!money.safeParse(subtotal).success || subtotal < 1 || subtotal < g.definition.minSpend) return fail("ยอดชำระไม่ถูกต้องหรือต่ำกว่ายอดขั้นต่ำ");
  const discount = Math.min(subtotal, g.definition.discountType === "PERCENT" ? Math.floor(subtotal * g.definition.amount / 100) : g.definition.amount);
  return { revision: s.revision, grantCode: g.code, memberCode, subtotal, discount, total: subtotal - discount, paymentId };
}
export function previewMockPayment(code: string, memberCode: string, subtotal: number): MockPayment {
  return quote(readBenefits(), code, memberCode, subtotal, crypto.randomUUID(), new Date());
}
/** Legacy assigned-promo-only recording API. Package checkout must use purchaseMockPackage instead. */
export async function completeMockPayment(expected: MockPayment): Promise<void> {
  const snapshot: MockPayment = { ...expected };
  await writeBenefits((s, now) => {
    const current = quote(s, snapshot.grantCode, snapshot.memberCode, snapshot.subtotal, snapshot.paymentId, now);
    if (JSON.stringify(current) !== JSON.stringify(snapshot) || s.grants.some(g => g.paymentId === snapshot.paymentId)) return fail("รายการชำระเปลี่ยนหรือบันทึกแล้ว กรุณาตรวจสอบใหม่");
    const g = unusedGrant(s, snapshot.grantCode, "PROMO", now);
    g.status = "USED"; g.usedAt = now.toISOString(); g.paymentId = snapshot.paymentId; g.paidAmount = snapshot.total;
  });
}
