import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, readBody } from "./auth/http";
import { manualCategories, type FinanceData } from "../app/admin/finance/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function financePayload(action: string, body: Record<string, unknown>): Record<string, unknown> | null {
  if (!["create", "update", "delete"].includes(action)) return null;
  const payload: Record<string, unknown> = {};
  if (action !== "create") {
    if (typeof body.id !== "string" || !uuid.test(body.id) || !Number.isSafeInteger(body.version) || Number(body.version) < 1) return null;
    payload.id = body.id.toLowerCase(); payload.version = body.version;
  }
  if (action === "delete") {
    if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 500) return null;
    return { ...payload, reason: body.reason.trim() };
  }
  if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !Number.isFinite(Date.parse(body.date)) || new Date(body.date).toISOString().slice(0, 10) !== body.date || body.date < "2000-01-01" || body.date > "2100-12-31" ||
    !["INCOME", "EXPENSE"].includes(String(body.type)) || !manualCategories.includes(body.category as typeof manualCategories[number]) ||
    (body.type === "INCOME" && body.category !== manualCategories[0]) || (body.type === "EXPENSE" && body.category === manualCategories[0]) ||
    typeof body.amount !== "number" || !Number.isSafeInteger(Math.round(body.amount * 100)) || body.amount <= 0 || body.amount > 10000000 || Math.abs(body.amount * 100 - Math.round(body.amount * 100)) > 0.000001 ||
    typeof body.note !== "string" || !body.note.trim() || body.note.length > 500) return null;
  return { ...payload, date: body.date, type: body.type, category: body.category, amountSatang: Math.round(body.amount * 100), note: body.note.trim() };
}
async function execute(action: string, key: string | null, payload: Record<string, unknown>) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Unauthorized");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
  const sql = neon(process.env.DATABASE_URL);
  const digest = createHash("sha256").update(token).digest("hex");
  for (let attempt = 0; ; attempt++) {
    try {
      const rows = await sql`SELECT real_finance_action(${digest}, ${action}, ${key}::uuid, ${JSON.stringify(payload)}::jsonb) AS result`;
      return rows[0].result;
    } catch (error) {
      if (attempt >= 2 || !["40001", "40P01"].includes((error as { code?: string }).code ?? "")) throw error;
    }
  }
}
export async function readRealFinance(): Promise<FinanceData> {
  const member = await getCurrentMember();
  if (!member || member.role !== "OWNER" || member.status === "SUSPENDED") throw new Error("Forbidden");
  return execute("read", null, {});
}
export async function financeAction(request: Request, action: string) {
  if (!["read", "create", "update", "delete"].includes(action)) return json({ error: "ไม่พบคำสั่ง" }, 404);
  if (request.method !== (action === "read" ? "GET" : "POST")) return json({ error: "Method not allowed" }, 405);
  try {
    const member = await getCurrentMember();
    if (!member || member.status === "SUSPENDED") return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (member.role !== "OWNER") return json({ error: "เฉพาะเจ้าของเท่านั้น" }, 403);
    if (action === "read") return json({ data: await execute(action, null, {}) });
    const body = await readBody(request);
    if (!body || typeof body.requestKey !== "string" || !uuid.test(body.requestKey)) return json({ error: "ต้องระบุ requestKey UUID และ JSON จากเว็บไซต์เดียวกัน" }, 400);
    const payload = financePayload(action, body);
    if (!payload) return json({ error: "ข้อมูลไม่ถูกต้อง: รายรับกรอกเองต้องไม่ใช่การขายแพ็กเกจ และต้องมีหมายเหตุ" }, 400);
    return json({ data: await execute(action, body.requestKey.toLowerCase(), payload) });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "เซสชันหมดอายุหรือไม่มีสิทธิ์" }, 403);
    if (["22023", "P0001", "22007", "22008", "23514"].includes(code ?? "")) return json({ error: "ข้อมูลเปลี่ยนหรือ requestKey ถูกใช้แล้ว กรุณาโหลดใหม่" }, 409);
    console.error("[finance] operation failed", { code: code ?? "unknown" });
    return json({ error: "ยังยืนยันผลไม่ได้ ให้ลองคำขอเดิมอีกครั้ง" }, 503);
  }
}
