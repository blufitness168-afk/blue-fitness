export const manualCategories = ["รายได้อื่น (ไม่ใช่แพ็กเกจ)", "รายจ่ายประจำเดือน", "อุปกรณ์", "เงินเดือน", "รายจ่ายอื่น"] as const;
export const financeCategories = ["แพ็กเกจ", ...manualCategories] as const;
export type FinanceCategory = typeof financeCategories[number];
export type FinanceType = "INCOME" | "EXPENSE";
export type EditableFinanceInput = { date: string; type: FinanceType; category: FinanceCategory; amount: number; note: string };
export type FinanceRecord = EditableFinanceInput & { id: string; source: "MANUAL" | "MEMBERSHIP"; createdAt: string; version: number; memberCode?: string; memberName?: string; reversalOf?: string };
export type FinanceAudit = { id: number; actorId: number; action: string; entryId: string; before: unknown; after: unknown; reason: string; createdAt: string };
export type FinanceData = { records: FinanceRecord[]; audit: FinanceAudit[] };
