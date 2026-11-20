import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { json, sameOrigin } from "./auth/http";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { boundedBody } from "./payment-server";

const timestamp = z.iso.datetime({ offset: true });
const amount = z.number().int().positive().max(100_000_000);
const points = z.number().int().nonnegative();
const candidate = z.object({ saleId: z.uuid(), packageName: z.string().min(1).max(200),
  startsAt: timestamp, endsAt: timestamp, amountSatang: amount, pointsToReverse: points }).strict();
const receipt = z.object({ saleId: z.uuid(), source: z.literal("STAFF_TRANSFER_REFUND"),
  status: z.literal("CANCELLED"), cancelledAt: timestamp, refundSatang: amount, pointsReversed: points }).strict();
const input = z.object({ requestKey: z.uuidv4(), saleId: z.uuid(), confirmedFullExternalRefund: z.literal(true),
  reason: z.string().trim().min(1).max(240).refine(reason => !reason.includes("\0")) }).strict();
export type StaffPaidCancellationCandidate = z.infer<typeof candidate>;

export async function staffPaidCancellationRequest(request: Request, code: string) {
  const post = request.method === "POST";
  if (!post && request.method !== "GET") return json({ error: "ไม่รองรับวิธีเรียกนี้" }, 405);
  if (!sameOrigin(request) || (post && !request.headers.get("origin"))) return json({ error: "ไม่อนุญาตคำขอจากเว็บไซต์อื่น" }, 403);
  if (process.env.ENABLE_STAFF_PAID_CANCELLATION !== "true") return json({ error: "ยังไม่เปิดยกเลิกเทอมโอน" }, 503);
  if (!/^BLU-[0-9]{1,12}$/.test(code) || new URL(request.url).search) return json({ error: "คำขอไม่ถูกต้อง" }, 400);
  try {
    const actor = await getCurrentMember();
    if (!actor) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (actor.role !== "OWNER" || actor.status === "SUSPENDED") return json({ error: "เฉพาะเจ้าของเท่านั้น" }, 403);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "กรุณาเข้าสู่ระบบใหม่" }, 401);
    if (!process.env.DATABASE_URL) throw Error("Database unavailable");
    const sql = neon(process.env.DATABASE_URL);
    const session = createHash("sha256").update(token).digest("hex");
    if (!post) {
      const [row] = await sql`SELECT r4_staff_private.list_paid_transfer_cancellations(${session},${code}) AS candidates`;
      return json({ candidates: z.array(candidate).parse(row?.candidates) });
    }
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "ต้องส่ง JSON" }, 400);
    let body: unknown;
    try { body = JSON.parse((await boundedBody(request, 4096)).toString("utf8")); }
    catch { return json({ error: "คำขอไม่ถูกต้อง" }, 400); }
    const parsed = input.safeParse(body);
    if (!parsed.success) return json({ error: "กรุณาระบุเหตุผลและยืนยันว่าได้คืนเงินเต็มจำนวนนอกระบบแล้ว" }, 400);
    const { requestKey, saleId, reason, confirmedFullExternalRefund } = parsed.data;
    const [row] = await sql`SELECT r4_staff_private.cancel_member_paid_transfer(${session},${code},${requestKey}::uuid,${saleId}::uuid,${reason},${confirmedFullExternalRefund}) AS receipt`;
    const result = receipt.parse(row?.receipt);
    if (result.saleId !== saleId.toLowerCase()) throw Error("Unexpected cancellation receipt");
    return json({ receipt: result });
  } catch (error) {
    const state = (error as { code?: string } | null)?.code;
    if (state === "42501") return json({ error: "สิทธิ์หรือเซสชันเปลี่ยน กรุณาโหลดใหม่" }, 403);
    if (post && ["55000", "23505", "22023"].includes(state ?? "")) return json({ error: "ไม่สามารถยกเลิกอัตโนมัติได้ กรุณาตรวจสอบรายการ" }, 409);
    return json({ error: post ? "ยังยืนยันผลไม่ได้ กรุณาส่งคำขอเดิมซ้ำ ไม่ต้องคืนเงินซ้ำ" : "ยังไม่พร้อมตรวจเทอมโอน" }, 503);
  }
}
