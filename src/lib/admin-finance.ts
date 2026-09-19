import { z } from "zod";
import { dashboardDays, dashboardMonths } from "./admin-dashboard-mock";
import { readAdminMember } from "./admin-members";
import { mockAdminMembers } from "./admin-mock";
import { readMemberAccountStore } from "./member-account";

export const FINANCE_STORAGE_KEY = "blu_admin_finance_mock_v1";
export const FINANCE_EVENT = "blu-admin-finance-updated";

export const financeCategories = [
  "รายจ่ายประจำเดือน",
  "เงินเดือนพนักงาน",
  "ค่าคอมมิชชัน",
  "ค่าอุปกรณ์",
  "ค่าเสื่อม",
  "ต่อสมาชิก",
  "สมัครสมาชิกใหม่",
  "ยกเลิกการสมัคร",
  "อื่นๆ",
] as const;

export type FinanceCategory = (typeof financeCategories)[number];
export type FinanceType = "INCOME" | "EXPENSE";
export type FinanceSource = "SEED" | "MANUAL" | "MEMBERSHIP";

const financeRecordSchema = z.object({
  id: z.string().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["INCOME", "EXPENSE"]),
  category: z.enum(financeCategories),
  amount: z.number().int().positive().max(100_000_000),
  note: z.string().trim().max(500),
  memberCode: z.string().regex(/^BLU-\d+$/).optional(),
  memberName: z.string().trim().min(1).max(200).optional(),
  source: z.enum(["SEED", "MANUAL", "MEMBERSHIP"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict().refine((record) => Boolean(record.memberCode) === Boolean(record.memberName), "ข้อมูลสมาชิกไม่ครบ");

export type FinanceRecord = z.infer<typeof financeRecordSchema>;
export type EditableFinanceInput = Pick<FinanceRecord, "date" | "type" | "category" | "amount" | "note">;

const storeSchema = z.object({
  version: z.literal(1),
  records: z.array(financeRecordSchema.refine((record) => record.source !== "MEMBERSHIP")),
}).strict();

type FinanceStore = z.infer<typeof storeSchema>;

const memberSamples = [
  { code: "BLU-1012", name: "วิภาดา รักฟิต" },
  { code: "BLU-1020", name: "ธีรภัทร ใจกล้า" },
  { code: "BLU-1025", name: "กัลยา ศรีสุข" },
  { code: "BLU-1019", name: "ธนวัฒน์ พึ่งบุญ" },
];

function record(
  id: string,
  date: string,
  type: FinanceType,
  category: FinanceCategory,
  amount: number,
  note: string,
  memberIndex?: number,
): FinanceRecord {
  const member = memberIndex === undefined ? undefined : memberSamples[memberIndex % memberSamples.length];
  const createdAt = `${date}T08:00:00.000+07:00`;
  return financeRecordSchema.parse({
    id,
    date,
    type,
    category,
    amount,
    note,
    memberCode: member?.code,
    memberName: member?.name,
    source: "SEED",
    createdAt,
    updatedAt: createdAt,
  });
}

function seedRecords(): FinanceRecord[] {
  const records: FinanceRecord[] = [];
  for (const month of dashboardMonths.filter((item) => item.period !== "2026-09")) {
    records.push(record(`seed-income-${month.period}`, `${month.period}-15`, "INCOME", "อื่นๆ", month.income, "รายรับรวมประจำเดือน"));
    records.push(record(`seed-expense-${month.period}`, `${month.period}-28`, "EXPENSE", "รายจ่ายประจำเดือน", month.expense, "ค่าใช้จ่ายดำเนินงานประจำเดือน"));
  }
  let memberIndex = 0;
  for (const day of dashboardDays) {
    if (day.income > 0) {
      const isNew = day.newMembers > 0;
      records.push(record(
        `seed-income-${day.date}`,
        day.date,
        "INCOME",
        isNew ? "สมัครสมาชิกใหม่" : "ต่อสมาชิก",
        day.income,
        isNew ? "ชำระค่าแพ็กเกจสมาชิกใหม่" : "ชำระค่าต่ออายุสมาชิก",
        memberIndex++,
      ));
    }
    if (day.expense > 0) {
      records.push(record(`seed-expense-${day.date}`, day.date, "EXPENSE", "เงินเดือนพนักงาน", day.expense, "รายจ่ายประจำเดือน"));
    }
  }
  return records;
}

function seedStore(): FinanceStore {
  return { version: 1, records: seedRecords() };
}

function readStore(): FinanceStore {
  const raw = localStorage.getItem(FINANCE_STORAGE_KEY);
  if (raw === null) return seedStore();
  try {
    const store = storeSchema.parse(JSON.parse(raw));
    if (new Set(store.records.map((item) => item.id)).size !== store.records.length) throw new Error();
    return store;
  } catch {
    throw new Error("ข้อมูลรายรับ-รายจ่าย mock เสียหาย กรุณาตรวจสอบ localStorage");
  }
}

function membershipIncome(): FinanceRecord[] {
  const accounts = readMemberAccountStore();
  return accounts.accounts.flatMap((account) => {
    const purchases = [...account.purchases].sort((a, b) => Date.parse(a.purchasedAt) - Date.parse(b.purchasedAt));
    const member = mockAdminMembers.find((item) => item.memberCode === account.memberCode);
    const adminMember = readAdminMember(account.memberCode);
    const hadMembershipBeforePurchases = Boolean(adminMember?.membershipHistory.length);
    return purchases.flatMap((purchase, index) => purchase.paidAmount <= 0 ? [] : [financeRecordSchema.parse({
      id: `membership-${purchase.id}`,
      date: purchase.purchasedAt.slice(0, 10),
      type: "INCOME",
      category: index === 0 && !hadMembershipBeforePurchases ? "สมัครสมาชิกใหม่" : "ต่อสมาชิก",
      amount: purchase.paidAmount,
      note: `ชำระแพ็กเกจ ${purchase.packageName}${purchase.promoCode ? ` · ใช้โค้ด ${purchase.promoCode}` : ""}`,
      memberCode: account.memberCode,
      memberName: adminMember ? `${adminMember.firstName} ${adminMember.lastName}` : member?.fullName ?? account.memberCode,
      source: "MEMBERSHIP",
      createdAt: purchase.purchasedAt,
      updatedAt: purchase.purchasedAt,
    })]);
  });
}

export function readFinanceRecords(): FinanceRecord[] {
  const stored = readStore().records;
  const automatic = membershipIncome();
  const automaticIds = new Set(automatic.map((item) => item.id));
  return [...automatic, ...stored.filter((item) => !automaticIds.has(item.id))]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function writeStore(store: FinanceStore) {
  const serialized = JSON.stringify(storeSchema.parse(store));
  localStorage.setItem(FINANCE_STORAGE_KEY, serialized);
  window.dispatchEvent(new CustomEvent(FINANCE_EVENT));
}

export function saveFinanceRecord(input: EditableFinanceInput, existingId?: string): FinanceRecord {
  const store = readStore();
  const now = new Date().toISOString();
  if (existingId) {
    const index = store.records.findIndex((item) => item.id === existingId);
    if (index < 0) throw new Error("ไม่พบรายการที่ต้องการแก้ไข หรือเป็นรายรับอัตโนมัติ");
    const current = store.records[index];
    const updated = financeRecordSchema.parse({ ...current, ...input, updatedAt: now });
    store.records[index] = updated;
    writeStore(store);
    return updated;
  }
  const created = financeRecordSchema.parse({
    ...input,
    id: crypto.randomUUID(),
    source: "MANUAL",
    createdAt: now,
    updatedAt: now,
  });
  store.records.unshift(created);
  writeStore(store);
  return created;
}

export function deleteFinanceRecord(id: string) {
  const store = readStore();
  const next = store.records.filter((item) => item.id !== id);
  if (next.length === store.records.length) throw new Error("ไม่พบรายการที่ต้องการลบ หรือเป็นรายรับอัตโนมัติ");
  writeStore({ ...store, records: next });
}
