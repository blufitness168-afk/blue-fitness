import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { boundedBody } from "./payment-server";

const emailSchema = z.string().trim().max(254).regex(/^[\x00-\x7f]*$/)
  .transform(value => value.toLowerCase() || null)
  .pipe(z.email().nullable());
const inputSchema = z.object({
  requestKey: z.string().uuid(), reason: z.string().trim().min(1).max(240),
  expectedVersion: z.number().int().min(0).max(2147483646),
  email: z.union([emailSchema, z.null()]),
}).strict();
const contactSchema = z.object({ email: z.email().max(254).nullable(), version: z.number().int().nonnegative() }).strict();
export type MemberContactEmail = z.infer<typeof contactSchema>;

class ContactDenied extends Error {
  constructor(public status: number) { super("Contact access denied"); }
}
async function connection() {
  const actor = await getCurrentMember();
  if (!actor) throw new ContactDenied(401);
  if (actor.status === "SUSPENDED" || !["ADMIN", "OWNER"].includes(actor.role)) throw new ContactDenied(403);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new ContactDenied(401);
  if (!process.env.DATABASE_URL) throw Error("Contact unavailable");
  return { sql: neon(process.env.DATABASE_URL), digest: createHash("sha256").update(token).digest("hex") };
}
// Separate real read: absent row is null/version 0; absent migration is an error, never empty success.
export async function getMemberContactEmail(memberCode: string): Promise<MemberContactEmail> {
  if (!memberCode || memberCode.length > 50) throw new ContactDenied(400);
  const { sql, digest } = await connection();
  const rows = await sql`SELECT member_contact_email_read(${digest},${memberCode}) AS contact`;
  return contactSchema.parse(rows[0]?.contact);
}
function failure(error: unknown) {
  // Never log transport errors: SQL parameters contain PII/session hashes.
  if (error instanceof ContactDenied) return json({ error: "ไม่มีสิทธิ์อ่านหรือแก้ไขอีเมลติดต่อ" }, error.status);
  const code = (error as { code?: string }).code;
  if (code === "42501") return json({ error: "สิทธิ์หรือ session เปลี่ยน กรุณาโหลดหน้าใหม่" }, 403);
  if (code === "23505") return json({ error: "คำขอขัดแย้งกับข้อมูลปัจจุบัน กรุณาโหลดหน้าใหม่" }, 409);
  if (code === "P0001") return json({ error: "ข้อมูลเปลี่ยนหรือ UUID ใช้กับข้อมูลอื่นแล้ว กรุณาโหลดหน้าใหม่" }, 409);
  if (code === "22023") return json({ error: "ข้อมูลอีเมลติดต่อไม่ถูกต้อง" }, 400);
  return json({ error: "อีเมลติดต่อยังไม่พร้อมใช้งานหรือยังยืนยันผลไม่ได้ ส่งคำขอเดิมซ้ำหรือโหลดหน้าใหม่เพื่อตรวจสอบ" }, 503);
}
export async function memberContactEmailRequest(request: Request, memberCode: string) {
  if (!["GET", "PATCH"].includes(request.method)) return json({ error: "ไม่รองรับวิธีเรียกนี้" }, 405);
  if (!sameOrigin(request)) return json({ error: "ไม่อนุญาตคำขอจากเว็บไซต์อื่น" }, 403);
  try {
    if (request.method === "GET") {
      if (new URL(request.url).search || request.body !== null) return json({ error: "คำขอไม่ถูกต้อง" }, 400);
      return json({ contact: await getMemberContactEmail(memberCode) });
    }
    const { sql, digest } = await connection();
    if (!memberCode || memberCode.length > 50 || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return json({ error: "คำขอไม่ถูกต้อง" }, 400);
    }
    let body: unknown;
    try { body = JSON.parse((await boundedBody(request, 4096)).toString("utf8")); }
    catch { return json({ error: "คำขอไม่ถูกต้องหรือใหญ่เกินกำหนด" }, 400); }
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) return json({ error: "ระบุอีเมล ASCII ไม่เกิน 254 ตัว หรือเว้นว่าง พร้อมเหตุผล/version/UUID เท่านั้น" }, 400);
    const { requestKey, ...payload } = parsed.data;
    const result = await sql`SELECT member_contact_email_update(${digest},${requestKey}::uuid,${JSON.stringify({ memberCode, ...payload })}::jsonb) AS result`;
    if (result[0]?.result?.ok !== true) throw Error("Unconfirmed contact write");
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
