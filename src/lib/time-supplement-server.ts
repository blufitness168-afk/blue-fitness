import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { boundedBody } from "./payment-server";
import { packageCatalogDailySlot } from "./package-catalog";

const grant = z.object({ requestKey: z.uuid(), memberCode: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120), reason: z.string().trim().min(1).max(240),
  timeSlot: z.string().refine(value => packageCatalogDailySlot(value) !== null),
}).strict();
const activate = z.object({ requestKey: z.uuid(), couponId: z.number().int().min(1).max(999999999) }).strict();

export async function timeSupplement(request: Request, staff = false) {
  if (!["GET", "POST"].includes(request.method) || (staff && request.method !== "POST")) return json({ error: "Method not allowed" }, 405);
  if (request.method === "POST" && !sameOrigin(request)) return json({ error: "ไม่อนุญาตคำขอข้ามเว็บไซต์" }, 403);
  try {
    const member = await getCurrentMember();
    if (!member || member.status === "SUSPENDED") return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (staff && !["ADMIN", "OWNER"].includes(member.role)) return json({ error: "เฉพาะ ADMIN/OWNER" }, 403);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (!process.env.DATABASE_URL) throw Error("Database unavailable");
    const digest = createHash("sha256").update(token).digest("hex");
    let key: string | null = null;
    let payload: Record<string, unknown> = {};
    const action = request.method === "GET" ? "list" : staff ? "grant" : "activate";
    if (request.method === "POST") {
      let body: unknown;
      try {
        if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw Error("JSON required");
        body = JSON.parse((await boundedBody(request, 4096)).toString("utf8"));
      } catch { return json({ error: "ต้องส่ง JSON ไม่เกิน 4 KB" }, 400); }
      const parsed = (staff ? grant : activate).safeParse(body);
      if (!parsed.success) return json({ error: "ข้อมูลสิทธิ์เสริมไม่ถูกต้อง" }, 400);
      const { requestKey, ...fields } = parsed.data;
      key = requestKey.toLowerCase(); payload = fields;
    }
    const sql = neon(process.env.DATABASE_URL);
    // Retry only transactions PostgreSQL definitely rolled back. Unknown outcomes stay
    // with the caller's UUID; do not generate a new key or blindly replay provider work.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const rows = await sql`SELECT time_supplement_action(${digest},${action},${key}::uuid,${JSON.stringify(payload)}::jsonb) AS result`;
        return json({ data: rows[0].result });
      } catch (error) {
        if (!["40001", "40P01"].includes((error as { code?: string }).code ?? "") || attempt === 2) throw error;
      }
    }
    throw Error("Retry exhausted");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "เซสชันหมดอายุหรือไม่มีสิทธิ์" }, 403);
    if (["P0001", "22023", "23505"].includes(code ?? "")) return json({ error: "ใช้สิทธิ์ไม่ได้: ต้องมีหลักเดี่ยวที่ยืนยันได้ อยู่ในช่วงเวลา และคูปองยังใช้ได้ หรือ UUID ถูกใช้กับข้อมูลอื่น" }, 409);
    return json({ error: "ยังยืนยันผลไม่ได้ ให้ลองคำขอเดิมด้วย UUID เดิมอีกครั้ง" }, 503);
  }
}
