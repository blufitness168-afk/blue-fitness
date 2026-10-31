import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { generatePromptPayPayload } from "./promptpay";
import { MAX_SLIP_BYTES, paymentReadiness, quotePackage, validateSlip, validImageSignature, type Receiver } from "./payment-policy";
import { z } from "zod";

const uuid = z.string().uuid();
const createInput = z.object({ packageId: z.number().int().positive(), promoCode: z.string().max(40).default(""), requestKey: uuid }).strict();
const sqlClient = () => {
  if (!process.env.DATABASE_URL) throw Error("Database unavailable");
  return neon(process.env.DATABASE_URL);
};
export type PaymentOrder = {
  id: string; member_id: number; package_snapshot: ReturnType<typeof quotePackage>["package"];
  receiver_snapshot: Receiver; amount_satang: number; subtotal_satang: number; discount_satang: number;
  created_at: string; expires_at: string; upload_deadline: string; status: "PENDING" | "PAID" | "REJECTED"; paid_at: string | null;
    rejection_reason: string | null; confirmed_at: string | null;
  membership_expires_at: string | null; points_earned: number;
};

function receiverConfig(): Receiver {
  const receiver = { promptpay: process.env.PAYMENT_PROMPTPAY_MOBILE ?? "", bankCode: process.env.PAYMENT_RECEIVER_BANK_CODE ?? "", bankAccount: process.env.PAYMENT_RECEIVER_BANK_ACCOUNT ?? "", name: process.env.PAYMENT_RECEIVER_NAME ?? "" };
  if (!/^0[689]\d{8}$/.test(receiver.promptpay) || !/^\d{3}$/.test(receiver.bankCode) || !/^\d{10}$/.test(receiver.bankAccount) || !receiver.name.trim() || !process.env.EASYSLIP_PAYMENT_V2_API_KEY) throw Error("Payment configuration unavailable");
  return receiver;
}
async function identity() {
  const member = await getCurrentMember();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return member && token && /^[a-f0-9]{64}$/.test(token) ? { member, digest: createHash("sha256").update(token).digest("hex") } : null;
}
export function publicOrder(order: PaymentOrder) {
  return { id: order.id, package: order.package_snapshot, receiver: order.receiver_snapshot,
    amountSatang: order.amount_satang, subtotalSatang: order.subtotal_satang, discountSatang: order.discount_satang,
    createdAt: order.created_at, expiresAt: order.expires_at, uploadDeadline: order.upload_deadline, status: order.status, paidAt: order.paid_at,
        confirmedAt: order.confirmed_at, rejectionReason: order.rejection_reason, readiness: paymentReadiness(process.env),
    membershipExpiresAt: order.membership_expires_at, pointsEarned: order.points_earned,
    qrPayload: paymentReadiness(process.env).transfersEnabled && order.status === "PENDING" && Date.parse(order.expires_at) > Date.now() ? generatePromptPayPayload(order.receiver_snapshot.promptpay, order.amount_satang / 100) : null };
}

// Bound actual bytes (also for chunked bodies) and time spent reading, before parsing.
export async function boundedBody(request: Pick<Request, "headers" | "body">, maxBytes: number, timeoutMs = 10_000) {
  if (Number(request.headers.get("content-length")) > maxBytes) throw Error("ข้อมูลใหญ่เกินกำหนด");
  const reader = request.body?.getReader();
  if (!reader) throw Error("ไม่พบข้อมูล");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      const part = await reader.read();
      if (Date.now() >= deadline) throw Error("อ่านข้อมูลหมดเวลา");
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw Error("ข้อมูลใหญ่เกินกำหนด");
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

export async function createOrder(request: Request) {
  if (!sameOrigin(request)) return json({ error: "ไม่อนุญาตคำขอข้ามเว็บไซต์" }, 403);
  try {
    const auth = await identity();
    if (!auth) return json({ error: "กรุณาเข้าสู่ระบบสมาชิก" }, 401);
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    const parsed = createInput.safeParse(JSON.parse((await boundedBody(request, 4096)).toString("utf8")));
    if (!parsed.success) return json({ error: "ข้อมูลคำสั่งซื้อไม่ถูกต้อง" }, 400);
    let quote;
    try { quote = { ...quotePackage(parsed.data.packageId, ""), promo: parsed.data.promoCode.trim() ? { code: parsed.data.promoCode.trim().toUpperCase() } : null }; }
    catch (cause) { return json({ error: cause instanceof Error ? cause.message : "แพ็กเกจไม่ถูกต้อง" }, 400); }
    const readiness = paymentReadiness(process.env);
    if (!readiness.transfersEnabled) return json({ error: readiness.blocker, readiness }, 503);
    const receiver = receiverConfig();
    const sql = sqlClient();
    const rows = await sql`SELECT * FROM create_package_payment_order(${randomUUID()}::uuid, ${auth.member.id}, ${auth.digest}, ${parsed.data.requestKey}::uuid, ${JSON.stringify(quote)}::jsonb, ${JSON.stringify(receiver)}::jsonb)`;
    return json({ order: publicOrder(rows[0] as PaymentOrder) }, 201);
  } catch {
    return json({ error: "สร้างคำสั่งซื้อไม่ได้ กรุณาโหลดรายการค้างก่อน (อาจมีรายการค้าง/โควตาเต็ม/ระบบยังไม่พร้อม)" }, 409);
  }
}

export async function getOrder(orderId: string) {
  if (!uuid.safeParse(orderId).success) return json({ error: "ไม่พบคำสั่งซื้อ" }, 404);
  try {
    const auth = await identity();
    if (!auth) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    const sql = sqlClient();
    const rows = await sql`SELECT * FROM package_payment_orders WHERE id = ${orderId}::uuid AND member_id = ${auth.member.id}`;
    if (!rows[0]) return json({ error: "ไม่พบคำสั่งซื้อ" }, 404);
    const attempts = await sql`SELECT state, rejection_reason, updated_at, provider_calls FROM package_payment_attempts WHERE order_id = ${orderId}::uuid ORDER BY created_at DESC LIMIT 1`;
    const audits = await sql`SELECT id FROM package_payment_resolution_audit WHERE order_id = ${orderId}::uuid AND action = 'OWNER_RECHECK' LIMIT 1`;
    return json({ order: publicOrder(rows[0] as PaymentOrder), verification: attempts[0] ?? null, ownerRecheckAvailable: auth.member.role === "OWNER" && rows[0].status === "PENDING" && attempts[0]?.state === "REJECTED" && attempts[0]?.rejection_reason === "PROVIDER_VALIDATION_FAILED" && attempts[0]?.provider_calls === 1 && !audits[0], ownerRecheckPrepared: auth.member.role === "OWNER" && !!audits[0] && attempts[0]?.state === "UNKNOWN" && attempts[0]?.provider_calls === 1 });
  } catch { return json({ error: "อ่านคำสั่งซื้อไม่ได้" }, 503); }
}

export async function paymentAccount() {
  const auth = await identity();
  if (!auth) throw Error("Unauthorized");
  const sql = sqlClient();
  const orders = await sql`SELECT * FROM package_payment_orders WHERE member_id = ${auth.member.id} ORDER BY created_at DESC LIMIT 30`;
  const paid = orders.filter(o => o.status === "PAID");
  return { memberCode: auth.member.memberCode, status: auth.member.status === "ACTIVE" && (!auth.member.expireDate || auth.member.expireDate.getTime() <= Date.now()) ? "EXPIRED" : auth.member.status, expiresAt: auth.member.expireDate?.toISOString() ?? null,
    points: auth.member.points, package: paid[0]?.package_snapshot ?? null,
    purchases: paid.map(o => publicOrder(o as PaymentOrder)),
    readiness: paymentReadiness(process.env),
    pendingOrder: orders.find(o => o.status === "PENDING") ? publicOrder(orders.find(o => o.status === "PENDING") as PaymentOrder) : null };
}
export async function getPaymentAccount() {
  try { return json(await paymentAccount()); }
  catch (cause) { return json({ error: "อ่านบัญชีชำระเงินจริงไม่ได้ กรุณาเข้าสู่ระบบหรือโหลดใหม่" }, cause instanceof Error && cause.message === "Unauthorized" ? 401 : 503); }
}

export async function prepareOwnerRecheck(request: Request, orderId: string) {
  if (!sameOrigin(request)) return json({ error: "ไม่อนุญาตคำขอข้ามเว็บไซต์" }, 403);
  if (!uuid.safeParse(orderId).success) return json({ error: "ไม่พบคำสั่งซื้อ" }, 404);
  try {
    const auth = await identity();
    if (!auth || auth.member.role !== "OWNER") return json({ error: "OWNER เท่านั้น" }, 403);
    const body = JSON.parse((await boundedBody(request, 1024)).toString("utf8"));
    if (body.confirmed !== true || body.reason !== "PROMPTPAY_REGISTRATION_FIX") return json({ error: "ต้องยืนยันตรวจภาพเดิมอีกหนึ่งครั้ง" }, 400);
    const sql = sqlClient();
    await sql`SELECT id FROM prepare_owner_payment_recheck(${orderId}::uuid, ${auth.member.id}, ${auth.digest})`;
    return json({ prepared: true, message: "เลือกรูปเดิมแล้วตรวจซ้ำได้หนึ่งครั้ง ไม่มีการเพิ่มสิทธิ์จากคำขอนี้" });
  } catch { return json({ error: "ไม่สามารถเปิดตรวจซ้ำได้ หรือใช้สิทธิ์ไปแล้ว" }, 409); }
}

export async function verifyOrder(request: Request, orderId: string) {
  if (!sameOrigin(request)) return json({ error: "ไม่อนุญาตคำขอข้ามเว็บไซต์" }, 403);
  if (!uuid.safeParse(orderId).success) return json({ error: "ไม่พบคำสั่งซื้อ" }, 404);
  try {
    const auth = await identity();
    if (!auth) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    const sql = sqlClient();
    const orders = await sql`SELECT * FROM package_payment_orders WHERE id = ${orderId}::uuid AND member_id = ${auth.member.id}`;
    const order = orders[0] as PaymentOrder | undefined;
    if (!order) return json({ error: "ไม่พบคำสั่งซื้อ" }, 404);
    if (order.status === "PAID") return json({ order: publicOrder(order) });
    if (order.status === "REJECTED") return json({ order: publicOrder(order), error: "รายการถูกปิดแล้ว กรุณาติดต่อเจ้าหน้าที่ หากโอนแล้วอย่าโอนซ้ำ" }, 422);
    const type = request.headers.get("content-type") ?? "";
    if (!type.startsWith("multipart/form-data;")) return json({ error: "กรุณาแนบรูปสลิป" }, 400);
    let file: File, reconcile: boolean;
    try {
      const form = await new Response(await boundedBody(request, MAX_SLIP_BYTES + 65536), { headers: { "Content-Type": type } }).formData();
      const value = form.get("file");
      if ([...form.keys()].some(k => !["file", "reconcile"].includes(k)) || form.getAll("file").length !== 1 || form.getAll("reconcile").length > 1 || !(value instanceof File) || value.size <= 0 || value.size > MAX_SLIP_BYTES || !validImageSignature(value.type, new Uint8Array(await value.slice(0, 12).arrayBuffer()))) throw Error("ใช้ไฟล์ JPG, PNG, GIF หรือ WebP ที่ถูกต้อง ไม่เกิน 4 MB");
      file = value;
      reconcile = form.get("reconcile") === "true";
    } catch (cause) { return json({ error: cause instanceof Error ? cause.message : "ไฟล์ไม่ถูกต้อง" }, 400); }
    const key = process.env.EASYSLIP_PAYMENT_V2_API_KEY;
    const hash = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
    const readiness = paymentReadiness(process.env);
    if (!readiness.transfersEnabled || !key) {
      const cached = await sql`SELECT state FROM package_payment_attempts WHERE order_id = ${orderId}::uuid AND image_sha256 = ${hash}`;
      if (cached[0]?.state !== "VERIFIED") return json({ error: readiness.blocker ?? "ระบบตรวจสลิปยังไม่พร้อม", readiness }, 503);
    }
    const lease = randomUUID();
    const attempts = await sql`SELECT * FROM claim_package_payment_attempt(${orderId}::uuid, ${auth.member.id}, ${auth.digest}, ${lease}::uuid, ${hash}, ${reconcile})`;
    const attempt = attempts[0];
    if (!attempt) return json({ error: "เริ่มตรวจไม่ได้" }, 409);
    if (attempt.state === "REJECTED") return json({ error: "สลิปนี้ไม่ผ่านแล้ว กรุณาใช้สลิปที่ถูกต้องหรือติดต่อเจ้าหน้าที่" }, 422);
    if (attempt.state !== "VERIFIED" && attempt.lease_token !== lease) return json({ pending: true, error: "ยังรอผลตรวจ ห้ามโอนซ้ำ โหลดสถานะ หรือใช้รูปเดิมตรวจซ้ำหลัง 2 นาทีโดยยอมรับค่าโควตา" }, 202);
    if (attempt.state !== "VERIFIED") {
      if (!key) return json({ pending: true, error: "ระบบตรวจสลิปยังไม่พร้อม ไม่ได้เรียกผู้ให้บริการ" }, 503);
      const upload = new FormData();
      upload.append("image", file, `slip.${file.type.split("/")[1]}`);
      upload.append("matchAccount", "true");
      upload.append("matchAmount", (order.amount_satang / 100).toFixed(2));
      upload.append("checkDuplicate", "true");
      upload.append("remark", order.id);
      // Duplicate flags alone cannot settle or reject a transfer: validate full
      // evidence and let DB global transRef uniqueness decide ownership.
      let result: unknown;
      try {
        const response = await fetch("https://api.easyslip.com/v2/verify/bank", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: upload, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
        result = JSON.parse((await boundedBody(response, 65536, 12_000)).toString("utf8"));
        if (!response.ok) {
          // Even structured provider failures are fail-closed. Do not auto-resubmit.
          throw Error("PROVIDER_UNKNOWN");
        }
      } catch {
        await sql`UPDATE package_payment_attempts SET state = 'UNKNOWN', updated_at = now() WHERE id = ${attempt.id}::uuid AND lease_token = ${lease}::uuid AND state = 'PROCESSING'`;
        return json({ pending: true, error: "ยังยืนยันไม่ได้ ผู้ให้บริการอาจใช้โควตาแล้ว ห้ามโอนซ้ำ กรุณาโหลดสถานะหรือติดต่อเจ้าหน้าที่" }, 202);
      }
      let evidence;
      try { evidence = validateSlip(result, order); }
      catch (cause) {
        // Record the policy failure without the slip, provider payload or credentials.
        console.warn("[payment] slip validation rejected", { orderId, attemptId: attempt.id, reason: cause instanceof Error ? cause.message : "INVALID_PAYMENT_EVIDENCE" });
        await sql`UPDATE package_payment_attempts SET state = 'REJECTED', rejection_reason = 'PROVIDER_VALIDATION_FAILED', updated_at = now() WHERE id = ${attempt.id}::uuid AND lease_token = ${lease}::uuid AND state = 'PROCESSING'`;
        return json({ error: cause instanceof Error ? cause.message : "สลิปไม่ผ่าน" }, 422);
      }
      const saved = await sql`UPDATE package_payment_attempts SET state = 'VERIFIED', evidence = ${JSON.stringify(evidence)}::jsonb, updated_at = now() WHERE id = ${attempt.id}::uuid AND lease_token = ${lease}::uuid AND state = 'PROCESSING' RETURNING id`;
      if (!saved[0]) return json({ pending: true, error: "รอการตรวจสอบสถานะ ห้ามโอนซ้ำ" }, 202);
    }
    // Evidence persisted first: DB/network failure can retry finalization without quota.
    const completed = await sql`SELECT * FROM finalize_package_payment(${orderId}::uuid, ${auth.member.id}, ${auth.digest}, ${attempt.id}::uuid)`;
    const settled = completed[0] as PaymentOrder;
    if (settled.status === "REJECTED") return json({ order: publicOrder(settled), error: settled.rejection_reason === "DUPLICATE_TRANS_REF" ? "สลิปนี้ถูกใช้แล้ว รายการถูกปิดโดยไม่เพิ่มสิทธิ์" : "บัญชีถูกระงับ รายการถูกปิดโดยไม่เพิ่มสิทธิ์ กรุณาติดต่อเจ้าหน้าที่เรื่องยอดโอน" }, 422);
    return json({ order: publicOrder(settled) });
  } catch {
    return json({ pending: true, error: "ยังไม่ยืนยันการชำระ อาจมีรายการซ้ำ/กำลังตรวจ/คำสั่งซื้อหมดอายุ กรุณาโหลดสถานะและอย่าโอนซ้ำ" }, 409);
  }
}
