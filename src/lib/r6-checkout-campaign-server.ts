import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { json, sameOrigin } from "./auth/http";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { boundedBody } from "./payment-server";

const count = z.number().int().min(1).max(100);
const payload = z.object({
  requestKey: z.uuid(), title: z.string().trim().min(1).max(120),
  campaignCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/),
  campaignKind: z.enum(["DISCOUNT", "POINTS"]), description: z.string().trim().min(1).max(500),
  usesPerCoupon: count, perMember: count, total: z.number().int().min(1).max(1000000),
  activationDurationMinutes: z.number().int().min(0).max(2147483647).nullable(), expiresAt: z.iso.datetime({ offset: true }),
  checkoutUnit: z.enum(["SATANG", "PERCENT", "POINTS"]), checkoutValue: z.number().int().min(1).max(100000000),
  checkoutCap: z.number().int().min(1).max(100000000).nullable(),
}).strict().refine(p => p.total >= p.perMember && (p.campaignKind === "POINTS"
  ? p.checkoutUnit === "POINTS" && p.checkoutValue <= 1000000 && (p.checkoutCap ?? 0) <= 1000000
  : p.checkoutUnit !== "POINTS" && (p.checkoutUnit !== "PERCENT" || p.checkoutValue <= 100)));

export async function createCheckoutCampaign(request: Request) {
  if (!sameOrigin(request)) return json({ error: "ไม่อนุญาตคำขอข้ามเว็บไซต์" }, 403);
  if (process.env.R6_CHECKOUT_COUPONS_ENABLED !== "true") return json({ error: "ระบบยังไม่เปิดใช้คูปองสำหรับคำสั่งซื้อ" }, 503);
  try {
    const member = await getCurrentMember();
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!member || !token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (member.status === "SUSPENDED" || !["ADMIN", "OWNER"].includes(member.role)) return json({ error: "ไม่มีสิทธิ์" }, 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "ต้องระบุ JSON" }, 400);
    let raw: unknown;
    try { raw = JSON.parse((await boundedBody(request, 4096)).toString("utf8")); }
    catch { return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400); }
    const parsed = payload.safeParse(raw);
    if (!parsed.success) return json({ error: "ข้อมูลคูปองไม่ถูกต้อง" }, 400);
    if (!process.env.DATABASE_URL) return json({ error: "ระบบยังไม่พร้อม" }, 503);
    const { requestKey, ...campaign } = parsed.data;
    const digest = createHash("sha256").update(token).digest("hex");
    const sql = neon(process.env.DATABASE_URL);
    const [row] = await sql`SELECT public.real_benefits_admin_action(${digest}, 'create_r6_campaign',
      ${requestKey}::uuid, ${JSON.stringify({ ...campaign, bonusDays: 0 })}::jsonb) AS result`;
    return json({ data: { id: row.result.id, code: row.result.campaign_code } }, 201);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "42501") return json({ error: "ต้องใช้เซสชันปกติ ADMIN/OWNER" }, 403);
    if (["22023", "22007", "22008", "22003", "23514", "23505", "P0001"].includes(code ?? "")) {
      return json({ error: "สร้างแคมเปญไม่ได้ กรุณาตรวจรหัส วันหมดอายุ และโควตา" }, 409);
    }
    return json({ error: "ยังยืนยันผลไม่ได้ กรุณาลองคำขอเดิม" }, 503);
  }
}
