import { z } from "zod";
import { readMemberAccount } from "./member-account";
import { mockPackages } from "./mock-data";

export const ADMIN_MEMBERS_KEY = "blu_admin_members_mock_v1";
export const ADMIN_MEMBERS_EVENT = "blu-admin-members-updated";

const membershipHistorySchema = z.object({
  id: z.string().min(1),
  packageId: z.number().int().positive(),
  packageName: z.string().min(1),
  startedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeSlot: z.enum(["07:00-14:00", "07:00-22:00"]),
  price: z.number().int().nonnegative(),
  kind: z.enum(["NEW", "RENEWAL"]),
}).strict();
export type AdminMembershipHistory = z.infer<typeof membershipHistorySchema>;

const memberCouponSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["ส่วนลด", "ของขวัญ", "แถมฟรี", "แต้มเพิ่ม", "อื่นๆ"]),
  name: z.string().trim().min(1).max(120),
  code: z.string().regex(/^BLU-MC-[A-F0-9]{32}$/),
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  usedAt: z.string().datetime({ offset: true }).optional(),
}).strict().refine((coupon) => Date.parse(coupon.expiresAt) > Date.parse(coupon.issuedAt), "วันหมดอายุคูปองไม่ถูกต้อง");
export type AdminMemberCoupon = z.infer<typeof memberCouponSchema>;

const memberSchema = z.object({
  id: z.number().int().positive(),
  memberCode: z.string().regex(/^BLU-\d+$/),
  cardNumber: z.string().regex(/^CARD-\d+$/),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
    nickname: z.string().trim().max(100).default(""),
  email: z.union([z.literal(""), z.string().email()]),
  phone: z.string().trim().min(9).max(20),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  birthDate: z.string().regex(/^\d{2}-\d{2}$/),
  registeredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  avatarUrl: z.union([z.literal(""), z.string().url()]),
  emergencyName: z.string().trim().max(150),
  emergencyPhone: z.string().trim().max(20),
  emergencyRelation: z.string().trim().max(100),
  // Legacy personnel categories never imply persisted authentication privileges.
  role: z.preprocess((role) => ["TRAINER", "STAFF", "OTHER"].includes(String(role)) ? "MEMBER" : role, z.enum(["MEMBER", "ADMIN", "OWNER"])),
  passwordHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  membershipHistory: z.array(membershipHistorySchema),
  coupons: z.array(memberCouponSchema),
}).strict();
export type AdminMember = z.infer<typeof memberSchema>;
export type AdminMemberProfileInput = Pick<AdminMember, "firstName" | "lastName" | "nickname" | "email" | "phone" | "gender" | "birthDate" | "registeredAt" | "avatarUrl" | "emergencyName" | "emergencyPhone" | "emergencyRelation" | "role">;

const storeSchema = z.object({ version: z.literal(1), members: z.array(memberSchema) }).strict();
type AdminMembersStore = z.infer<typeof storeSchema>;

const history = (
  id: string,
  packageId: number,
  startedAt: string,
  expiresAt: string,
  kind: "NEW" | "RENEWAL",
): AdminMembershipHistory => {
  const pkg = mockPackages.find((item) => item.id === packageId);
  if (!pkg) throw new Error("ไม่พบแพ็กเกจ mock");
  return { id, packageId, packageName: pkg.name, startedAt, expiresAt, timeSlot: pkg.timeSlot, price: pkg.price, kind };
};

const seeds = [
  { id: 1, memberCode: "BLU-1001", cardNumber: "CARD-8899", firstName: "สมชาย", lastName: "ใจดี", email: "somchai@example.com", phone: "081-234-5678", gender: "MALE", birthDate: "08-15", registeredAt: "2026-06-06", avatarUrl: "", emergencyName: "สมศรี ใจดี", emergencyPhone: "089-999-8888", emergencyRelation: "ภรรยา", role: "MEMBER", membershipHistory: [history("m-1001-1", 7, "2026-06-06", "2026-07-06", "NEW"), history("m-1001-2", 7, "2026-07-06", "2026-08-05", "RENEWAL"), history("m-1001-3", 7, "2026-08-05", "2026-10-04", "RENEWAL")], coupons: [] },
  { id: 101, memberCode: "BLU-1012", cardNumber: "CARD-1188", firstName: "วิภาดา", lastName: "รักฟิต", email: "wipada@example.com", phone: "089-111-2200", gender: "FEMALE", birthDate: "02-11", registeredAt: "2026-09-02", avatarUrl: "", emergencyName: "วิมล รักฟิต", emergencyPhone: "089-111-2201", emergencyRelation: "มารดา", role: "MEMBER", membershipHistory: [history("m-1012-1", 7, "2026-09-02", "2026-10-02", "NEW")], coupons: [] },
  { id: 102, memberCode: "BLU-1015", cardNumber: "CARD-2299", firstName: "จักรพงษ์", lastName: "สมบูรณ์", email: "jakrapong@example.com", phone: "086-222-3311", gender: "MALE", birthDate: "11-20", registeredAt: "2026-04-10", avatarUrl: "", emergencyName: "", emergencyPhone: "", emergencyRelation: "", role: "MEMBER", membershipHistory: [history("m-1015-1", 3, "2026-04-10", "2026-07-09", "NEW")], coupons: [] },
  { id: 103, memberCode: "BLU-1020", cardNumber: "CARD-3300", firstName: "ธีรภัทร", lastName: "ใจกล้า", email: "teerapat@example.com", phone: "082-555-7788", gender: "MALE", birthDate: "05-09", registeredAt: "2025-09-20", avatarUrl: "", emergencyName: "ธีรดา ใจกล้า", emergencyPhone: "082-555-7789", emergencyRelation: "พี่สาว", role: "MEMBER", membershipHistory: [history("m-1020-1", 10, "2025-09-20", "2026-09-10", "NEW")], coupons: [] },
  { id: 104, memberCode: "BLU-1025", cardNumber: "CARD-4411", firstName: "กัลยา", lastName: "ศรีสุข", email: "kanlaya@example.com", phone: "090-444-5566", gender: "FEMALE", birthDate: "07-24", registeredAt: "2026-09-05", avatarUrl: "", emergencyName: "กิตติ ศรีสุข", emergencyPhone: "090-444-5567", emergencyRelation: "บิดา", role: "MEMBER", membershipHistory: [history("m-1025-1", 6, "2026-09-05", "2026-09-20", "NEW")], coupons: [] },
  { id: 105, memberCode: "BLU-1019", cardNumber: "CARD-5522", firstName: "ธนวัฒน์", lastName: "พึ่งบุญ", email: "thanawat@example.com", phone: "088-333-4477", gender: "MALE", birthDate: "01-18", registeredAt: "2026-01-15", avatarUrl: "", emergencyName: "", emergencyPhone: "", emergencyRelation: "", role: "TRAINER", membershipHistory: [history("m-1019-1", 9, "2026-01-15", "2026-07-14", "NEW"), history("m-1019-2", 9, "2026-07-14", "2027-01-10", "RENEWAL")], coupons: [] },
];

function seedStore(): AdminMembersStore {
  return validateStore({ version: 1, members: seeds.map((member) => structuredClone(member)) });
}

function validateStore(value: unknown): AdminMembersStore {
  const store = storeSchema.parse(value);
  if (new Set(store.members.map((member) => member.memberCode)).size !== store.members.length || new Set(store.members.map((member) => member.cardNumber)).size !== store.members.length) throw new Error();
  return store;
}

function readStore(): AdminMembersStore {
  const raw = localStorage.getItem(ADMIN_MEMBERS_KEY);
  if (raw === null) return seedStore();
  try { return validateStore(JSON.parse(raw)); }
  catch { throw new Error("ข้อมูลสมาชิก mock เสียหาย กรุณาตรวจสอบ localStorage"); }
}

function writeStore(store: AdminMembersStore) {
  const serialized = JSON.stringify(validateStore(store));
  localStorage.setItem(ADMIN_MEMBERS_KEY, serialized);
  window.dispatchEvent(new CustomEvent(ADMIN_MEMBERS_EVENT));
}

export function readAdminMembers(): AdminMember[] {
  return readStore().members.map((member) => structuredClone(member));
}

export function readAdminMember(memberCode: string): AdminMember | null {
  return readAdminMembers().find((member) => member.memberCode === memberCode.trim().toUpperCase()) ?? null;
}

export function saveAdminMemberProfile(memberCode: string, input: AdminMemberProfileInput): AdminMember {
  const store = readStore();
  const index = store.members.findIndex((member) => member.memberCode === memberCode);
  if (index < 0) throw new Error("ไม่พบสมาชิก");
  if (input.role !== store.members[index].role) throw new Error("เปลี่ยนสิทธิ์จริงผ่าน API เจ้าของเท่านั้น ไม่ใช่ข้อมูล mock");
    store.members[index] = memberSchema.parse({ ...store.members[index], ...input });
  writeStore(store);
  return structuredClone(store.members[index]);
}

export async function setAdminMemberPassword(memberCode: string, password: string) {
  if (password.length < 8 || password.length > 100) throw new Error("รหัสผ่านต้องมี 8–100 ตัวอักษร");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  const store = readStore();
  const member = store.members.find((item) => item.memberCode === memberCode);
  if (!member) throw new Error("ไม่พบสมาชิก");
  member.passwordHash = hash;
  writeStore(store);
}

export function addAdminMemberCoupon(memberCode: string, type: AdminMemberCoupon["type"], name: string, validDays: number): AdminMemberCoupon {
  if (!name.trim() || !Number.isInteger(validDays) || validDays < 0 || validDays > 3650) throw new Error("กรุณาระบุชื่อและอายุคูปอง 0–3650 วัน");
  const store = readStore();
  const member = store.members.find((item) => item.memberCode === memberCode);
  if (!member) throw new Error("ไม่พบสมาชิก");
  const now = new Date();
  const id = crypto.randomUUID();
  const coupon = memberCouponSchema.parse({ id, type, name: name.trim(), code: `BLU-MC-${id.replaceAll("-", "").toUpperCase()}`, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + (validDays === 0 ? 10 / 1440 : validDays) * 86_400_000).toISOString() });
  member.coupons.unshift(coupon);
  writeStore(store);
  return structuredClone(coupon);
}

export function combinedMembershipHistory(member: AdminMember): AdminMembershipHistory[] {
  let purchases: AdminMembershipHistory[] = [];
  try {
    const account = readMemberAccount(member.memberCode);
    purchases = account.purchases.map((purchase, index) => {
      const pkg = mockPackages.find((item) => item.id === purchase.packageId);
      const start = purchase.purchasedAt.slice(0, 10);
      const duration = (pkg?.durationDays ?? 1) + (pkg?.bonusDays ?? 0);
      const end = new Date(`${start}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + duration);
      return membershipHistorySchema.parse({ id: `purchase-${purchase.id}`, packageId: purchase.packageId, packageName: purchase.packageName, startedAt: start, expiresAt: end.toISOString().slice(0, 10), timeSlot: pkg?.timeSlot ?? "07:00-22:00", price: purchase.paidAmount, kind: member.membershipHistory.length + index === 0 ? "NEW" : "RENEWAL" });
    });
  } catch {
    purchases = [];
  }
  return [...member.membershipHistory, ...purchases].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function membershipStatus(member: AdminMember, at: string) {
  const latestExpiry = combinedMembershipHistory(member).reduce((latest, item) => item.expiresAt > latest ? item.expiresAt : latest, "");
  if (!latestExpiry) return "PENDING" as const;
  return latestExpiry >= at ? "ACTIVE" as const : "EXPIRED" as const;
}
