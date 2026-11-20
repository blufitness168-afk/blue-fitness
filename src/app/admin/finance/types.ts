export const manualCategories = ["รายได้อื่น (ไม่ใช่แพ็กเกจ)", "รายจ่ายประจำเดือน", "อุปกรณ์", "เงินเดือน", "คอมมิชชัน", "ค่าเสื่อม", "รายจ่ายอื่น"] as const;
// Package lifecycle categories require sale provenance; never infer them from order sequence.
export const financeCategories = ["แพ็กเกจ", "ต่อสมาชิก", "สมัครใหม่", "ยกเลิกการสมัคร", ...manualCategories] as const;
export type FinanceCategory = typeof financeCategories[number];
export type FinanceType = "INCOME" | "EXPENSE";
export type EditableFinanceInput = { date: string; type: FinanceType; category: FinanceCategory; amount: number; note: string };
export type FinanceRecord = EditableFinanceInput & { id: string; source: "MANUAL" | "MEMBERSHIP" | "STAFF_FREE" | "STAFF_FREE_CANCELLATION" | "STAFF_TRANSFER" | "STAFF_TRANSFER_REFUND" | "ONLINE_REFUND"; createdAt: string; version: number; memberCode?: string; memberName?: string; reversalOf?: string };
export type FinanceAudit = { id: number; actorId: number; action: string; entryId: string; before: unknown; after: unknown; reason: string; createdAt: string };
export type FinanceData = { records: FinanceRecord[]; audit: FinanceAudit[]; unconfirmedPaidCount?: number };

export function validFinanceRange(from: string, to: string): boolean {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return valid(from) && valid(to) && from >= "2000-01-01" && to <= "2100-12-31" && from <= to;
}

export function financeChart(records: FinanceRecord[], mode: "month" | "day", from: string, to: string) {
  if (!validFinanceRange(from, to)) return [];
  const groups = new Map<string, { income: number; expense: number }>();
  for (const record of records) {
    if (record.date < from || record.date > to) continue;
    const key = mode === "month" ? record.date.slice(0, 7) : record.date;
    const value = groups.get(key) ?? { income: 0, expense: 0 };
    value[record.type === "INCOME" ? "income" : "expense"] += Math.round(record.amount * 100);
    groups.set(key, value);
  }
  const cursor = new Date(`${mode === "month" ? from.slice(0, 7) + "-01" : from}T00:00:00Z`);
  const result = [];
  while (cursor.toISOString().slice(0, 10) <= to) {
    const key = cursor.toISOString().slice(0, mode === "month" ? 7 : 10);
    const value = groups.get(key) ?? { income: 0, expense: 0 };
    result.push({ label: key, values: { income: value.income / 100, expense: value.expense / 100, net: (value.income - value.expense) / 100 } });
    if (mode === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}
