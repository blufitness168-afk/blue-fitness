import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { boundedBody } from "./payment-server";
import { onlineCancellationEnabled } from "./online-cancellation-rollout-server";
import { onlineCancellationInput, onlineCancellationPreview, onlineCancellationReceipt } from "./online-cancellation-contract";

export async function onlineCancellationRequest(request: Request, rawOrderId: string) {
  const post = request.method === "POST";
  if (!post && request.method !== "GET") return json({ error: "ไม่รองรับวิธีเรียกนี้" }, 405);
  if (!sameOrigin(request) || (post && !request.headers.get("origin"))) return json({ error: "ไม่อนุญาตคำขอข้ามเว็บไซต์" }, 403);
  let sent = false;
  try {
    const actor = await getCurrentMember(); // NORMAL sessions only; SQL rechecks and locks session/actor.
    if (!actor) return json({ error: "กรุณาเข้าสู่ระบบปกติใหม่" }, 401);
    if (actor.role !== "OWNER" || actor.status === "SUSPENDED") return json({ error: "เฉพาะเจ้าของเท่านั้น" }, 403);
    if (!onlineCancellationEnabled()) return json({ code: "UNAVAILABLE", error: "ยังไม่เปิดใช้งานการยกเลิกออนไลน์" }, 503);
    if (!z.uuid().safeParse(rawOrderId).success || new URL(request.url).search) return json({ error: "คำขอไม่ถูกต้อง" }, 400);
    const orderId = rawOrderId.toLowerCase();
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "กรุณาเข้าสู่ระบบใหม่" }, 401);
    if (!process.env.DATABASE_URL) throw Error("Database unavailable");
    const sql = neon(process.env.DATABASE_URL);
    const session = createHash("sha256").update(token).digest("hex");
    if (!post) {
      const [row] = await sql`SELECT r4_online_private.preview_online_cancellation(${session}, ${orderId}::uuid) AS preview`;
      if (row?.preview === null) return json({ error: "ไม่พบรายการออนไลน์ที่ชำระแล้ว" }, 404);
      const preview = onlineCancellationPreview.parse(row?.preview);
      if (preview.orderId !== orderId) throw Error("Unexpected preview order");
      return json({ preview });
    }
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "ต้องส่ง JSON" }, 400);
    let body: unknown;
    try { body = JSON.parse((await boundedBody(request, 4096)).toString("utf8")); }
    catch { return json({ error: "คำขอไม่ถูกต้อง" }, 400); }
    const parsed = onlineCancellationInput.safeParse(body);
    if (!parsed.success) return json({ error: "กรุณาระบุยอดคืนและเหตุผล พร้อมยืนยันว่าคืนเงินเต็มจำนวนนอกระบบแล้ว" }, 400);
    const { requestKey, refundSatang, reason, confirmedFullExternalRefund } = parsed.data;
    sent = true;
    // The RPC rechecks evidence after waiting on locks; it needs a fresh READ COMMITTED snapshot.
    const [[row]] = await sql.transaction([
      sql`SELECT r4_online_private.cancel_online_order(${session}, ${orderId}::uuid, ${requestKey}::uuid, ${refundSatang}::integer, ${reason}, ${confirmedFullExternalRefund}) AS receipt`,
    ], { isolationLevel: "ReadCommitted" });
    const receipt = onlineCancellationReceipt.parse(row?.receipt);
    if (receipt.orderId !== orderId || receipt.refundSatang !== refundSatang) throw Error("Unexpected cancellation receipt");
    return json({ receipt });
  } catch (error) {
    const state = (error as { code?: string } | null)?.code;
    if (state === "42501") return json({ error: "สิทธิ์หรือเซสชันเปลี่ยน กรุณาเข้าสู่ระบบใหม่" }, 403);
    if (sent && ["55000", "22023", "23505"].includes(state ?? "")) return json({ code: "CONFLICT", error: "บันทึกไม่ได้ เนื่องจากเงื่อนไขเปลี่ยนหรือข้อมูลไม่ตรง กรุณาตรวจสอบรายการ ห้ามคืนเงินซ้ำ" }, 409);
    if (sent && !["42883", "42P01", "3F000", "0A000"].includes(state ?? "")) {
      return json({ code: "RETRY_SAME_REQUEST", error: "ยังยืนยันผลไม่ได้ กรุณาส่งคำขอเดิมซ้ำ ห้ามคืนเงินซ้ำ" }, 503);
    }
    return json({ code: "UNAVAILABLE", error: "ระบบยกเลิกออนไลน์ยังไม่พร้อมใช้งาน" }, 503);
  }
}
