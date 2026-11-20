import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { json, sameOrigin } from "./auth/http";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { boundedBody } from "./payment-server";
import { isStaffFreeEnabled } from "./staff-free-server";

const validCode = (code: string) => /^BLU-[0-9]{1,12}$/.test(code);
const timestamp = z.iso.datetime({ offset: true });
const candidate = z.object({ saleId: z.uuid(), packageName: z.string().min(1).max(200),
  startsAt: timestamp, endsAt: timestamp }).strict();
const candidates = z.array(candidate).max(20);
const receipt = z.object({ saleId: z.uuid(), source: z.literal("STAFF_FREE_CANCELLATION"),
  status: z.literal("CANCELLED"), cancelledAt: timestamp, amountSatang: z.literal(0) }).strict();
const input = z.object({ requestKey: z.uuidv4(), saleId: z.uuid(),
  reason: z.string().trim().min(1).max(240).refine(s => !s.includes("\0")) }).strict();
export type StaffFreeCancellationCandidate = z.infer<typeof candidate>;

async function ownerConnection() {
  const actor = await getCurrentMember();
  if (!actor) return { denied: 401 } as const;
  if (actor.role !== "OWNER" || actor.status === "SUSPENDED") return { denied: 403 } as const;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return { denied: 401 } as const;
  if (!process.env.DATABASE_URL) throw Error("Database unavailable");
  return { sql: neon(process.env.DATABASE_URL), session: createHash("sha256").update(token).digest("hex") };
}

async function list({ sql, session }: Awaited<ReturnType<typeof ownerConnection>> & { denied?: never }, code: string) {
  const [row] = await sql`SELECT r4_staff_private.list_free_sale_cancellations(${session},${code}) AS candidates`;
  return candidates.parse(row?.candidates);
}

export async function readStaffFreeCancellationCandidates(code: string) {
  if (!isStaffFreeEnabled() || !validCode(code)) return [];
  try {
    const connection = await ownerConnection();
    return connection.denied ? [] : await list(connection, code);
  } catch {
    // A missing or incompatible R4 stack must not show a cancellation control.
    return [];
  }
}

export async function staffFreeCancellationRequest(request: Request, code: string) {
  const post = request.method === "POST";
  if (!sameOrigin(request) || (post && !request.headers.get("origin"))) return json({ error: "ไม่อนุญาตคำขอจากเว็บไซต์อื่น" }, 403);
  if (!isStaffFreeEnabled()) return json({ error: "ยังไม่เปิดยกเลิกเทอมฟรี" }, 503);
  if (!validCode(code) || new URL(request.url).search) return json({ error: "คำขอไม่ถูกต้อง" }, 400);
  if (!post && request.method !== "GET") return json({ error: "ไม่รองรับวิธีเรียกนี้" }, 405);
  try {
    const connection = await ownerConnection();
    if (connection.denied) return json({ error: "ต้องใช้เซสชัน OWNER ที่ยังใช้งานได้" }, connection.denied);
    if (!post) return json({ candidates: await list(connection, code) });
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "คำขอไม่ถูกต้อง" }, 400);
    let body: unknown;
    try { body = JSON.parse((await boundedBody(request, 4096)).toString("utf8")); }
    catch { return json({ error: "คำขอไม่ถูกต้อง" }, 400); }
    const parsed = input.safeParse(body);
    if (!parsed.success) return json({ error: "รายการหรือเหตุผลไม่ถูกต้อง" }, 400);
    const { requestKey, saleId, reason } = parsed.data;
    const { sql, session } = connection;
    const [row] = await sql`SELECT r4_staff_private.cancel_member_free_sale(${session},${code},${requestKey}::uuid,${saleId}::uuid,${reason}) AS receipt`;
    const result = receipt.parse(row?.receipt);
    if (result.saleId !== saleId.toLowerCase()) throw Error("Unexpected cancellation receipt");
    return json({ receipt: result });
  } catch (error) {
    const state = (error as { code?: string } | null)?.code;
    if (state === "42501") return json({ error: "สิทธิ์หรือเซสชันเปลี่ยน กรุณาโหลดใหม่" }, 403);
    if (post && ["55000", "23505", "22023"].includes(state ?? "")) return json({ error: "ไม่สามารถยกเลิกเทอมนี้ได้ กรุณาตรวจข้อมูลล่าสุด" }, 409);
    return json({ error: post ? "ยังยืนยันผลไม่ได้ กรุณาส่งคำขอเดิมซ้ำ" : "ยังไม่พร้อมตรวจเทอมฟรี" }, 503);
  }
}
