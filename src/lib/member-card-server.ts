import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { boundedBody } from "./payment-server";

const cardCode = z.string().trim().toUpperCase().regex(/^CARD-[0-9]{1,95}$/);
const snapshot = z.object({ cardCode: z.string().regex(/^CARD-[0-9]{1,95}$/).nullable(), version: z.number().int().min(0).max(2147483647) }).strict();
const input = z.object({
  requestKey: z.string().uuid(), reason: z.string().trim().min(1).max(240),
  expectedVersion: z.number().int().min(0).max(2147483646), cardCode: cardCode.nullable(),
}).strict();
export type MemberCardSnapshot = z.infer<typeof snapshot>;
class CardDenied extends Error {
  constructor(public status: number) { super("Card access denied"); }
}
async function connection() {
  const actor = await getCurrentMember();
  if (!actor) throw new CardDenied(401);
  if (actor.status === "SUSPENDED" || !["ADMIN", "OWNER"].includes(actor.role)) throw new CardDenied(403);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new CardDenied(401);
  if (!process.env.DATABASE_URL) throw Error("Card unavailable");
  return { sql: neon(process.env.DATABASE_URL), digest: createHash("sha256").update(token).digest("hex") };
}
export async function getMemberCard(memberCode: string): Promise<MemberCardSnapshot> {
  if (!memberCode || memberCode.length > 50) throw new CardDenied(400);
  const { sql, digest } = await connection();
  const rows = await sql`SELECT member_card_read(${digest},${memberCode}) AS card`;
  // Missing migration/denied read must never become an editable empty binding.
  return snapshot.parse(rows[0]?.card);
}
function failure(error: unknown) {
  if (error instanceof CardDenied) return json({ error: "ไม่มีสิทธิ์จัดการบัตรสมาชิก" }, error.status);
  const code = (error as { code?: string }).code;
  if (code === "42501") return json({ error: "สิทธิ์หรือ session เปลี่ยน กรุณาโหลดใหม่" }, 403);
  if (code === "23505" || code === "P0001") return json({ error: "คำขอขัดแย้งกับข้อมูลปัจจุบัน กรุณาโหลดใหม่" }, 409);
  if (code === "22023") return json({ error: "ข้อมูลบัตรไม่ถูกต้อง" }, 400);
  return json({ error: "บัตรยังไม่พร้อมใช้งานหรือยังยืนยันผลไม่ได้ ส่งคำขอเดิมซ้ำหรือโหลดใหม่เพื่อตรวจสอบ" }, 503);
}
export async function memberCardRequest(request: Request, memberCode: string) {
  if (!["GET", "PATCH"].includes(request.method)) return json({ error: "ไม่รองรับวิธีเรียกนี้" }, 405);
  if (!sameOrigin(request)) return json({ error: "ไม่อนุญาตคำขอจากเว็บไซต์อื่น" }, 403);
  try {
    if (request.method === "GET") {
      if (new URL(request.url).search || request.body !== null) return json({ error: "คำขอไม่ถูกต้อง" }, 400);
      return json({ card: await getMemberCard(memberCode) });
    }
    const { sql, digest } = await connection();
    if (!memberCode || memberCode.length > 50 || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "คำขอไม่ถูกต้อง" }, 400);
    let body: unknown;
    try { body = JSON.parse((await boundedBody(request, 4096)).toString("utf8")); }
    catch { return json({ error: "คำขอไม่ถูกต้องหรือใหญ่เกินกำหนด" }, 400); }
    const parsed = input.safeParse(body);
    if (!parsed.success) return json({ error: "ใช้ CARD-ตามด้วยตัวเลข พร้อมเหตุผล/version/UUID เท่านั้น" }, 400);
    const { requestKey, ...payload } = parsed.data;
    const rows = await sql`SELECT member_card_update(${digest},${requestKey}::uuid,${JSON.stringify({ memberCode, ...payload })}::jsonb) AS result`;
    if (rows[0]?.result?.ok !== true) throw Error("Unconfirmed card write");
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
