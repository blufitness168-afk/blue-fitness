import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { getCurrentMember, SESSION_COOKIE } from "@/lib/auth/server";
import { json, readBody } from "@/lib/auth/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readBody(request);
  const couponId = body?.couponId;
  if (!body || Object.keys(body).length !== 1 || typeof couponId !== "number" || !Number.isInteger(couponId) || couponId < 1 || couponId > 2147483647) {
    return json({ error: "ข้อมูลคูปองไม่ถูกต้อง" }, 400);
  }
  try {
    const member = await getCurrentMember();
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!member || !token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "กรุณาเข้าสู่ระบบใหม่" }, 401);
    if (!process.env.DATABASE_URL) throw Error("Database unavailable");
    const digest = createHash("sha256").update(token).digest("hex");
    const sql = neon(process.env.DATABASE_URL);
    const [row] = await sql`SELECT public.r6_activate_coupon(${digest}, ${couponId}::integer) AS result`;
    if (!row?.result) throw Error("Activation receipt missing");
    return json({ data: row.result });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "เซสชันนี้เปิดใช้คูปองไม่ได้ กรุณาเข้าสู่ระบบใหม่" }, 403);
    if (code === "P0001") return json({ error: "เปิดใช้ไม่ได้: คูปองหมดอายุ ถูกยกเลิก หรือไม่พร้อมเปิดใช้" }, 409);
    return json({ error: "ยังยืนยันผลไม่ได้ ลองเปิดใช้คูปองใบเดิมอีกครั้ง ระบบจะไม่นับเวลาใหม่" }, 503);
  }
}
