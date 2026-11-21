import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json } from "./auth/http";
import { couponKinds, couponStatuses, couponGroups } from "./r6-coupon-history";

const query = z.object({
  before: z.string().regex(/^[1-9][0-9]{0,9}$/).transform(Number).refine(n => n <= 2147483647).optional(),
  memberCode: z.string().trim().regex(/^BLU-[0-9]{1,12}$/).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(Object.keys(couponKinds)).optional(),
  status: z.enum(Object.keys(couponStatuses)).optional(),
  days: z.enum(Object.keys(couponGroups)).transform(Number).optional(),
}).strict();

export async function couponHistory(request: Request, staff: boolean) {
  try {
    const member = await getCurrentMember();
    if (!member || member.status === "SUSPENDED") return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (staff && !["ADMIN", "OWNER"].includes(member.role)) return json({ error: "ไม่มีสิทธิ์" }, 403);
    const params = new URL(request.url).searchParams;
    const parsed = query.safeParse(Object.fromEntries(params));
    if (!parsed.success || new Set(params.keys()).size !== params.size || (!staff && (params.has("memberCode") || params.has("days")))) {
      return json({ error: "ตัวกรองไม่ถูกต้อง" }, 400);
    }
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (!process.env.DATABASE_URL) throw Error("Database unavailable");
    const digest = createHash("sha256").update(token).digest("hex");
    const { before, memberCode, q, kind, status, days } = parsed.data;
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT public.r6_coupon_history(${digest}, ${staff}, ${before ?? null}::integer,
      ${memberCode ?? null}, ${q ?? null}, ${kind ?? null}, ${status ?? null}, ${days ?? null}::integer) AS data`;
    return json({ data: rows[0].data });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "ต้องใช้เซสชันปกติที่มีสิทธิ์" }, 403);
    if (code === "42883") return json({ error: "ฐานข้อมูลยังไม่รองรับประวัติคูปองแบบแบ่งหน้า", notInstalled: true }, 404);
    return json({ error: "โหลดประวัติคูปองไม่สำเร็จ กรุณาลองใหม่" }, 503);
  }
}
