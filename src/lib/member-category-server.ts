import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { boundedBody } from "./payment-server";

export const MEMBER_CATEGORY_LABELS = {
  MEMBER: "สมาชิก",
  TRAINER: "เทรนเนอร์",
  STAFF: "พนักงาน",
  OTHER: "อื่น ๆ",
} as const;

export type MemberCategory = keyof typeof MEMBER_CATEGORY_LABELS;

const categoryValues = ["MEMBER", "TRAINER", "STAFF", "OTHER"] as const;
const categorySchema = z.object({
  category: z.enum(categoryValues),
  version: z.number().int().nonnegative(),
}).strict();

const inputSchema = z.object({
  requestKey: z.string().uuid(),
  reason: z.string().trim().min(1).max(240),
  expectedVersion: z.number().int().min(0).max(2147483646),
  category: z.enum(categoryValues),
}).strict();

export type MemberCategorySnapshot = z.infer<typeof categorySchema>;

class CategoryDenied extends Error {
  constructor(public status: number) { super("Category access denied"); }
}

async function connection() {
  const actor = await getCurrentMember();
  if (!actor) throw new CategoryDenied(401);
  if (actor.status === "SUSPENDED" || !["ADMIN", "OWNER"].includes(actor.role)) throw new CategoryDenied(403);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new CategoryDenied(401);
  if (!process.env.DATABASE_URL) throw Error("Category unavailable");
  return { sql: neon(process.env.DATABASE_URL), digest: createHash("sha256").update(token).digest("hex") };
}

export async function getMemberCategory(memberCode: string): Promise<MemberCategorySnapshot> {
  if (!memberCode || memberCode.length > 50) throw new CategoryDenied(400);
  const { sql, digest } = await connection();
  const rows = await sql`SELECT member_category_read(${digest}, ${memberCode}) AS result`;
  return categorySchema.parse(rows[0]?.result);
}

export async function getMemberCategoriesMap(memberCodes: string[]): Promise<Record<string, MemberCategory>> {
  const codes = [...new Set(memberCodes.map(c => c.trim()).filter(c => c && c.length <= 50))];
  if (!codes.length) return {};
  try {
    const { sql, digest } = await connection();
    const [exists] = await sql`SELECT to_regclass('public.member_categories') IS NOT NULL AS ready`;
    if (!exists?.ready) return {};
    const rows = await sql`
      WITH staff AS (
        SELECT 1 FROM auth_sessions s JOIN members actor ON actor.id = s.member_id
        WHERE s.token_hash = ${digest} AND actor.role IN ('ADMIN', 'OWNER') AND actor.status <> 'SUSPENDED'
          AND s.revoked_at IS NULL AND s.expires_at > now() AND s.mode = 'NORMAL'
      )
      SELECT m.member_code AS "memberCode", c.category
      FROM staff CROSS JOIN public.member_categories c
      JOIN public.members m ON m.id = c.member_id
      WHERE m.member_code = ANY(${codes}::text[])
    `;
    const map: Record<string, MemberCategory> = {};
    for (const row of rows) {
      const cat = String(row.category);
      if (Object.hasOwn(MEMBER_CATEGORY_LABELS, cat)) {
        map[String(row.memberCode)] = cat as MemberCategory;
      }
    }
    return map;
  } catch {
    return {};
  }
}

function failure(error: unknown) {
  if (error instanceof CategoryDenied) return json({ error: "ไม่มีสิทธิ์อ่านหรือแก้ไขประเภทบุคคล" }, error.status);
  const code = (error as { code?: string }).code;
  if (code === "42501") return json({ error: "สิทธิ์หรือ session เปลี่ยน กรุณาโหลดหน้าใหม่" }, 403);
  if (code === "23505" || code === "P0001") return json({ error: "ข้อมูลเปลี่ยนหรือ UUID ใช้กับข้อมูลอื่นแล้ว กรุณาโหลดหน้าใหม่" }, 409);
  if (code === "22023") return json({ error: "ข้อมูลประเภทบุคคลไม่ถูกต้อง" }, 400);
  return json({ error: "ระบบประเภทบุคคลยังไม่พร้อมใช้งานหรือยังยืนยันผลไม่ได้ ส่งคำขอเดิมซ้ำหรือโหลดหน้าใหม่" }, 503);
}

export async function memberCategoryRequest(request: Request, memberCode: string) {
  if (!["GET", "PATCH"].includes(request.method)) return json({ error: "ไม่รองรับวิธีเรียกนี้" }, 405);
  if (!sameOrigin(request)) return json({ error: "ไม่อนุญาตคำขอจากเว็บไซต์อื่น" }, 403);
  try {
    if (request.method === "GET") {
      if (new URL(request.url).search || request.body !== null) return json({ error: "คำขอไม่ถูกต้อง" }, 400);
      return json({ category: await getMemberCategory(memberCode) });
    }
    const { sql, digest } = await connection();
    if (!memberCode || memberCode.length > 50 || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return json({ error: "คำขอไม่ถูกต้อง" }, 400);
    }
    let body: unknown;
    try { body = JSON.parse((await boundedBody(request, 4096)).toString("utf8")); }
    catch { return json({ error: "คำขอไม่ถูกต้องหรือใหญ่เกินกำหนด" }, 400); }
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) return json({ error: "กรุณาเลือกประเภทบุคคลและระบุเหตุผลไม่เกิน 240 ตัวอักษร" }, 400);
    const { requestKey, ...payload } = parsed.data;
    const result = await sql`SELECT member_category_update(${digest}, ${requestKey}::uuid, ${JSON.stringify({ memberCode, ...payload })}::jsonb) AS result`;
    if (result[0]?.result?.ok !== true) throw Error("Unconfirmed category write");
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
