import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { boundedBody } from "./payment-server";
import { packageCatalogDailySlot } from "./package-catalog";

const intervalFields = {
  startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }),
  dailySlot: z.string().refine(s => packageCatalogDailySlot(s) !== null),
};
const offerSchema = z.object({ ...intervalFields, source: z.literal("ONLINE_PAID"), orderId: z.uuid(),
  packageId: z.number().int().positive(), catalogVersion: z.number().int().positive(), packageName: z.string().min(1).max(200) }).strict();
const receiptSchema = z.object({ ...intervalFields, source: z.literal("STAFF_FREE"), saleId: z.uuid(), amountSatang: z.literal(0) }).strict();
const input = z.object({ requestKey: z.uuidv4(), offer: offerSchema, reason: z.string().trim().min(1).max(240).refine(s => !s.includes("\0")) }).strict();
export type StaffFreeOffer = z.infer<typeof offerSchema>;

export function isStaffFreeEnabled() { return process.env.ENABLE_STAFF_FREE === "true"; }

export async function staffFreeRequest(request: Request, code: string) {
  if (!sameOrigin(request) || (request.method === "POST" && !request.headers.get("origin"))) return json({ error: "ไม่อนุญาตคำขอจากเว็บไซต์อื่น" }, 403);
  if (!isStaffFreeEnabled()) return json({ error: "ยังไม่เปิดต่ออายุ 0 บาท" }, 503);
  if (!/^BLU-[0-9]{1,12}$/.test(code) || new URL(request.url).search) return json({ error: "คำขอไม่ถูกต้อง" }, 400);
  try {
    const actor = await getCurrentMember();
    if (!actor) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (actor.status === "SUSPENDED" || !["ADMIN", "OWNER"].includes(actor.role)) return json({ error: "ไม่มีสิทธิ์ต่ออายุ" }, 403);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "กรุณาเข้าสู่ระบบใหม่" }, 401);
    if (!process.env.DATABASE_URL) throw Error("Database unavailable");
    const sql = neon(process.env.DATABASE_URL);
    const session = createHash("sha256").update(token).digest("hex");
    if (request.method === "GET") {
      const [row] = await sql`SELECT r4_staff_private.preview_free_sale(${session},${code}) AS offer`;
      return json({ offer: offerSchema.nullable().parse(row?.offer) });
    }
    if (request.method !== "POST") return json({ error: "ไม่รองรับวิธีเรียกนี้" }, 405);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "คำขอไม่ถูกต้อง" }, 400);
    let body: unknown;
    try { body = JSON.parse((await boundedBody(request, 4096)).toString("utf8")); }
    catch { return json({ error: "คำขอไม่ถูกต้อง" }, 400); }
    const parsed = input.safeParse(body);
    if (!parsed.success) return json({ error: "ข้อมูลต่ออายุหรือเหตุผลไม่ถูกต้อง" }, 400);
    const { requestKey, offer, reason } = parsed.data;
    const [row] = await sql`SELECT r4_staff_private.record_free_sale(${session},${requestKey}::uuid,${code},${JSON.stringify(offer)}::jsonb,${reason}) AS receipt`;
    return json({ receipt: receiptSchema.parse(row?.receipt) });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "42501") return json({ error: "สิทธิ์หรือเซสชันเปลี่ยน กรุณาโหลดใหม่" }, 403);
    if (["55000", "23505", "40001", "22023"].includes(code ?? "")) return json({ error: "คำขอขัดแย้งหรือสิทธิ์เปลี่ยน กรุณาตรวจสอบข้อมูลล่าสุด" }, 409);
    return json({ error: "ยังยืนยันผลไม่ได้ ส่งคำขอเดิมซ้ำเพื่อตรวจผล" }, 503);
  }
}
