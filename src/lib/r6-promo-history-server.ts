import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json } from "./auth/http";
import { couponGroups } from "./r6-coupon-history";
import { promoStatuses } from "./r6-promo-history";

const query = z.object({
  before: z.string().regex(/^[1-9][0-9]{0,9}$/).transform(Number).refine(n => n <= 2147483647).optional(),
  memberCode: z.string().trim().regex(/^BLU-[0-9]{1,12}$/).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/).optional(),
  status: z.enum(Object.keys(promoStatuses)).optional(), days: z.enum(Object.keys(couponGroups)).transform(Number).optional(),
}).strict();

export async function promoHistory(request: Request, staff: boolean) {
  try {
    const member = await getCurrentMember();
    if (!member || member.status === "SUSPENDED") return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (staff && !["ADMIN", "OWNER"].includes(member.role)) return json({ error: "ไม่มีสิทธิ์" }, 403);
    const params = new URL(request.url).searchParams;
    const parsed = query.safeParse(Object.fromEntries(params));
    if (!parsed.success || new Set(params.keys()).size !== params.size || (!staff && params.has("memberCode"))) {
      return json({ error: "ตัวกรองไม่ถูกต้อง" }, 400);
    }
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (!process.env.DATABASE_URL) throw Error("Database unavailable");
    const digest = createHash("sha256").update(token).digest("hex");
    const { before, memberCode, name, code, status, days } = parsed.data;
    const sql = neon(process.env.DATABASE_URL);
    const [row] = await sql`SELECT public.r6_promo_history(${digest}, ${staff}, ${before ?? null}::integer,
      ${memberCode ?? null}, ${name ?? null}, ${code ?? null}, ${status ?? null}, ${days ?? null}::integer) AS data`;
    return json({ data: row.data });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "ต้องใช้เซสชันปกติที่มีสิทธิ์" }, 403);
    if (code === "42883") return json({ error: "ฐานข้อมูลยังไม่รองรับประวัติโปรโมโค้ด", notInstalled: true }, 404);
    return json({ error: "โหลดประวัติโปรโมโค้ดไม่ได้ กรุณาลองใหม่" }, 503);
  }
}
