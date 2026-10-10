import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { boundedBody, publicOrder, type PaymentOrder } from "./payment-server";
import { readV2Diagnostics } from "./payment-provider-diagnostics";

const resolution = z.object({ reason: z.string().trim().min(10).max(500), evidence: z.object({ source: z.enum(["BANK", "PROVIDER"]), outcome: z.enum(["NO_TRANSFER_CONFIRMED", "REFUND_CONFIRMED", "DUPLICATE_CONFIRMED"]), caseReference: z.string().trim().min(5).max(200), summary: z.string().trim().min(10).max(1000), approved: z.literal(true) }).strict() }).strict();
async function owner() {
  const member = await getCurrentMember();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return member?.role === "OWNER" && token && /^[a-f0-9]{64}$/.test(token) ? { id: member.id, digest: createHash("sha256").update(token).digest("hex") } : null;
}
function sqlClient() {
  if (!process.env.DATABASE_URL) throw Error("Database unavailable");
  return neon(process.env.DATABASE_URL);
}
export async function unresolvedPayments() {
  try {
    if (!await owner()) return json({ error: "เฉพาะเจ้าของ" }, 403);
    const sql = sqlClient();
    const orders = await sql`SELECT o.id, o.member_id, o.amount_satang, o.expires_at, o.upload_deadline, o.status,
      a.id AS attempt_id, a.state, a.updated_at, a.provider_calls,
      (o.upload_deadline < clock_timestamp() AND a.updated_at < clock_timestamp() - interval '2 minutes') AS rejection_review_available
      FROM package_payment_orders o JOIN package_payment_attempts a ON a.order_id = o.id
      WHERE o.status = 'PENDING' AND a.state IN ('PROCESSING','UNKNOWN','VERIFIED')
      ORDER BY a.updated_at ASC LIMIT 100`;
    return json({ orders, limit: 100, manualPaidSupported: false, warning: "ปิดรายการได้เฉพาะหลังตรวจหลักฐานธนาคาร/ผู้ให้บริการและอนุมัติ audit ไม่ใช่การคืนเงินหรืออนุมัติ PAID" });
  } catch { return json({ error: "อ่านรายการค้างไม่ได้" }, 503); }
}
export async function rejectUnresolvedPayment(request: Request, orderId: string) {
  if (!sameOrigin(request)) return json({ error: "ไม่อนุญาตข้ามเว็บไซต์" }, 403);
  try {
    const actor = await owner();
    if (!actor) return json({ error: "เฉพาะเจ้าของ" }, 403);
    if (!z.string().uuid().safeParse(orderId).success || request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    const parsed = resolution.safeParse(JSON.parse((await boundedBody(request, 8192)).toString("utf8")));
    if (!parsed.success) return json({ error: "ต้องระบุเหตุผลและหลักฐาน reconcile ที่อนุมัติแล้ว ห้ามสั่ง PAID" }, 400);
    const sql = sqlClient();
    const rows = await sql`SELECT * FROM reject_unresolved_package_payment(${orderId}::uuid, ${actor.id}, ${actor.digest}, ${parsed.data.reason}, ${JSON.stringify(parsed.data.evidence)}::jsonb)`;
    return json({ order: publicOrder(rows[0] as PaymentOrder), manualPaidSupported: false });
  } catch { return json({ error: "ปิดรายการไม่ได้: ต้องหมด grace และไม่มี worker ใหม่ หรือหลักฐาน/สิทธิ์ไม่ครบ" }, 409); }
}
export async function providerDiagnostics(request: Request) {
  if (!sameOrigin(request)) return json({ error: "ไม่อนุญาตข้ามเว็บไซต์" }, 403);
  try {
    if (!await owner()) return json({ error: "เฉพาะเจ้าของ" }, 403);
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    const input = z.object({ confirmedReadOnly: z.literal(true) }).strict().safeParse(JSON.parse((await boundedBody(request, 1024)).toString("utf8")));
    if (!input.success) return json({ error: "ต้องยืนยันการอ่าน key/info และบัญชีที่ผูก branch (ไม่ตรวจสลิป)" }, 400);
    return json({ diagnostics: await readV2Diagnostics() });
  } catch { return json({ error: "อ่าน diagnostics ไม่สำเร็จ" }, 503); }
}
