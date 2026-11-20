import { getCurrentMember } from "@/lib/auth/server";
import { readRealFinance } from "@/lib/real-finance-server";
import { createXlsx, XLSX_MAX_ROWS, XlsxLimitError } from "@/lib/xlsx";
import { financeCategories, validFinanceRange } from "@/app/admin/finance/types";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function GET(request: Request) {
  try {
    const member = await getCurrentMember();
    if (!member || member.status === "SUSPENDED") return fail("กรุณาเข้าสู่ระบบ", 401);
    if (member.role !== "OWNER") return fail("เฉพาะเจ้าของเท่านั้น", 403);
    const params = new URL(request.url).searchParams;
    const allowed = ["from", "to", "type", "category", "sort"];
    if (request.url.length > 2048 || [...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) return fail("ตัวกรองไม่ถูกต้อง", 400);
    const from = params.get("from") ?? "", to = params.get("to") ?? "";
    const type = params.get("type") ?? "ALL", category = params.get("category") ?? "ALL", sort = params.get("sort") ?? "NEWEST";
    if (!validFinanceRange(from, to) || !["ALL", "INCOME", "EXPENSE"].includes(type) ||
      (category !== "ALL" && !financeCategories.some(value => value === category)) ||
      !["NEWEST", "OLDEST", "AMOUNT_DESC", "AMOUNT_ASC"].includes(sort)) return fail("ตัวกรองไม่ถูกต้อง", 400);
    // Reuse R5's full, SQL-session-validated ledger; never export audit or client rows.
    const data = await readRealFinance();
    const records = data.records.filter(record => record.date >= from && record.date <= to &&
      (type === "ALL" || record.type === type) && (category === "ALL" || record.category === category));
    if (records.length > XLSX_MAX_ROWS) throw new XlsxLimitError("เกิน 10,000 รายการ กรุณาลดช่วงตัวกรอง");
    records.sort((a, b) => {
      if (sort === "OLDEST") return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
      if (sort === "AMOUNT_DESC") return b.amount - a.amount || b.date.localeCompare(a.date);
      if (sort === "AMOUNT_ASC") return a.amount - b.amount || b.date.localeCompare(a.date);
      return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
    });
    const includeSource = records.some(record => record.source === "ONLINE_REFUND");
    const workbook = createXlsx([
      ["ลำดับ", "วันที่", "ประเภท", "หมวดหมู่", "รหัสสมาชิก", "สมาชิกที่เกี่ยวข้อง", "จำนวนเงิน", "หมายเหตุ", ...(includeSource ? ["แหล่งที่มา"] : [])],
      ...records.map((record, index) => [index + 1, record.date, record.type === "INCOME" ? "รายรับ" : "รายจ่าย", record.category,
        record.memberCode ?? "", record.memberName ?? "", record.amount, record.note, ...(includeSource ? [record.source] : [])]),
    ]);
    return new Response(workbook, { headers: { ...headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="finance-${from}-${to}.xlsx"`,
    } });
  } catch (error) {
    if (error instanceof XlsxLimitError) return fail(error.message, 413);
    if ((error as { code?: string }).code === "42501" || (error instanceof Error && ["Forbidden", "Unauthorized"].includes(error.message))) return fail("เซสชันหมดอายุหรือไม่มีสิทธิ์", 403);
    return fail("ส่งออกไม่สำเร็จ กรุณาลองใหม่", 503);
  }
}
