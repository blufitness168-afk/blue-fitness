import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { json, sameOrigin } from "./auth/http";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { packageCatalogDailySlot } from "./package-catalog";
import { boundedBody } from "./payment-server";
import { staffPaidReadsEnabled } from "./staff-paid-rollout-server";

const timestamp = z.iso.datetime({ offset: true });
const interval = {
  startsAt: timestamp, endsAt: timestamp,
  dailySlot: z.string().refine(slot => packageCatalogDailySlot(slot) !== null),
};
const amountSatang = z.number().int().positive().max(100_000_000);
const offerSchema = z.object({ ...interval, source: z.literal("ONLINE_PAID"), orderId: z.uuid(),
  packageId: z.number().int().positive(), catalogVersion: z.number().int().positive(),
  packageName: z.string().min(1).max(200), amountSatang,
}).strict();
const receiptSchema = z.object({ ...interval, source: z.literal("STAFF_TRANSFER"), saleId: z.uuid(),
  amountSatang, pointsEarned: z.number().int().nonnegative(), occurredAt: timestamp, recordedAt: timestamp,
}).strict();
const payloadSchema = z.object({
  requestKey: z.uuidv4(), offer: offerSchema, confirmedTransfer: z.literal(true),
  reason: z.string().trim().min(1).max(240).refine(reason => !reason.includes("\0")),
  transferAt: timestamp.optional(),
}).strict();

export async function staffPaidTransferRequest(request: Request, memberCode: string) {
  const write = request.method === "POST";
  if (!write && request.method !== "GET") return json({ error: "ไม่รองรับวิธีเรียกนี้" }, 405);
  if (!sameOrigin(request) || (write && !request.headers.get("origin"))) return json({ error: "ไม่อนุญาตคำขอจากเว็บไซต์อื่น" }, 403);
  if (!staffPaidReadsEnabled() || process.env.ENABLE_STAFF_PAID_TRANSFER !== "true") return json({ error: "ยังไม่เปิดบันทึกการต่ออายุแบบโอน" }, 503);
  if (!/^BLU-[0-9]{1,12}$/.test(memberCode) || new URL(request.url).search) return json({ error: "คำขอไม่ถูกต้อง" }, 400);
  try {
    const actor = await getCurrentMember();
    if (!actor) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (actor.status === "SUSPENDED" || !["ADMIN", "OWNER"].includes(actor.role)) return json({ error: "ไม่มีสิทธิ์ต่ออายุ" }, 403);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "กรุณาเข้าสู่ระบบใหม่" }, 401);
    if (!process.env.DATABASE_URL) throw new Error("Database unavailable");
    const sql = neon(process.env.DATABASE_URL);
    const session = createHash("sha256").update(token).digest("hex");
    if (!write) {
      const [row] = await sql`SELECT r4_staff_private.preview_paid_transfer(${session},${memberCode}) AS offer`;
      return json({ offer: offerSchema.nullable().parse(row?.offer) });
    }
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "ต้องส่ง JSON" }, 400);
    let payload: unknown;
    try { payload = JSON.parse((await boundedBody(request, 4096)).toString("utf8")); }
    catch { return json({ error: "คำขอไม่ถูกต้อง" }, 400); }
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return json({ error: "ข้อมูลโอนหรือเหตุผลไม่ถูกต้อง" }, 400);
    const { requestKey, offer, reason, confirmedTransfer, transferAt } = parsed.data;
    if (transferAt && actor.role !== "OWNER") return json({ error: "เฉพาะเจ้าของเท่านั้นที่ลงเวลาโอนย้อนหลังได้" }, 403);
    const [row] = await sql`SELECT r4_staff_private.record_paid_transfer(${session},${requestKey}::uuid,${memberCode},
      ${JSON.stringify(offer)}::jsonb,${reason},${confirmedTransfer},${transferAt ?? null}::timestamptz) AS receipt`;
    return json({ receipt: receiptSchema.parse(row?.receipt) });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "42501") return json({ error: "สิทธิ์หรือเซสชันเปลี่ยน กรุณาโหลดใหม่" }, 403);
    if (["55000", "23505", "40001", "22023", "22007", "22008"].includes(code ?? "")) return json({ error: "ราคา เวลาโอน หรือสิทธิ์ไม่ตรง กรุณาตรวจสอบรายการ" }, 409);
    return json({ error: "ยังยืนยันผลไม่ได้ ส่งคำขอเดิมซ้ำเพื่อตรวจผล" }, 503);
  }
}
