import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { registrationSchema } from "./auth/registration";
import { boundedBody } from "./payment-server";

const profileSchema = z.object(registrationSchema.shape).omit({ password: true }).strict()
  .refine(({ birthDay, birthMonth }) => {
    const date = new Date(2000, birthMonth - 1, birthDay);
    return date.getMonth() === birthMonth - 1 && date.getDate() === birthDay;
  }, { message: "วันเกิดไม่ถูกต้อง" })
  .refine(({ emergencyPhone }) => !emergencyPhone || /^0\d{8,9}$/.test(emergencyPhone), { message: "เบอร์ฉุกเฉินไม่ถูกต้อง" });
// Preserve raw nullable legacy values for comparison, not the normalized form defaults.
const snapshotSchema = z.object({
  fullName: z.string(), nickname: z.string().nullable(), gender: z.string(),
  birthDay: z.number().int().nullable(), birthMonth: z.number().int().nullable(),
  emergencyName: z.string().nullable(), emergencyPhone: z.string().nullable(), emergencyRelation: z.string().nullable(),
}).strict();
const inputSchema = z.object({
  requestKey: z.string().uuid(), reason: z.string().trim().min(1).max(240),
  expected: snapshotSchema, profile: profileSchema,
}).strict();
export type AdminMemberProfileSnapshot = z.infer<typeof snapshotSchema>;

export async function updateAdminMemberProfile(request: Request, memberCode: string) {
  try {
    if (!sameOrigin(request)) return json({ error: "ไม่อนุญาตคำขอจากเว็บไซต์อื่น" }, 403);
    const actor = await getCurrentMember();
    if (!actor) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (actor.status === "SUSPENDED" || !["ADMIN", "OWNER"].includes(actor.role)) return json({ error: "ไม่มีสิทธิ์แก้ข้อมูลสมาชิก" }, 403);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" || !memberCode || memberCode.length > 50) {
      return json({ error: "คำขอไม่ถูกต้อง" }, 400);
    }
    let body: unknown;
    try { body = JSON.parse((await boundedBody(request, 8192)).toString("utf8")); }
    catch { return json({ error: "คำขอไม่ถูกต้องหรือใหญ่เกินกำหนด" }, 400); }
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) return json({ error: "ตรวจสอบชื่อ เพศ วันเดือนเกิด เบอร์ฉุกเฉิน และเหตุผล (ไม่รองรับฟิลด์อื่น)" }, 400);
    if (!process.env.DATABASE_URL) throw Error("Database unavailable");
    const sql = neon(process.env.DATABASE_URL);
    const digest = createHash("sha256").update(token).digest("hex");
    const { requestKey, ...payload } = parsed.data;
    await sql`SELECT admin_member_profile_update(${digest},${requestKey}::uuid,${JSON.stringify({ memberCode, ...payload })}::jsonb)`;
    // Do not return DB records, payload hashes, session identifiers or audit data.
    return json({ ok: true });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "สิทธิ์หรือ session เปลี่ยน กรุณาโหลดหน้าใหม่" }, 403);
    if (code === "P0001") return json({ error: "ข้อมูลเปลี่ยนแล้ว หรือรหัสคำขอถูกใช้กับข้อมูลอื่น กรุณาโหลดหน้าใหม่" }, 409);
    if (code === "22023") return json({ error: "ข้อมูลโปรไฟล์ไม่ถูกต้อง" }, 400);
    return json({ error: "ยังยืนยันผลบันทึกไม่ได้ ลองส่งคำขอเดิมซ้ำ หรือโหลดหน้าใหม่เพื่อตรวจสอบ" }, 503);
  }
}
