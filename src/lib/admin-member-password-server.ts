import "server-only";
import { createHash, createHmac } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { passwordSchema } from "./auth/registration";
import { hashPassword, PasswordWorkLimitError } from "./auth/password";
import { boundedBody } from "./payment-server";

const inputSchema = z.object({
  requestKey: z.string().uuid(), reason: z.string().trim().min(1).max(240), password: passwordSchema,
}).strict();

export function isAdminPasswordResetEnabled() {
  return process.env.ENABLE_ADMIN_PASSWORD_RESET === "true";
}

export async function resetAdminMemberPassword(request: Request, memberCode: string) {
  try {
    if (!sameOrigin(request)) return json({ error: "ไม่อนุญาตคำขอจากเว็บไซต์อื่น" }, 403);
    if (!isAdminPasswordResetEnabled()) return json({ error: "ระบบตั้งรหัสผ่านยังไม่เปิดใช้งาน" }, 503);
    const actor = await getCurrentMember();
    if (!actor) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (actor.status === "SUSPENDED" || !["ADMIN", "OWNER"].includes(actor.role)) return json({ error: "ไม่มีสิทธิ์ตั้งรหัสผ่าน" }, 403);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" || !memberCode || memberCode.length > 50) {
      return json({ error: "คำขอไม่ถูกต้อง" }, 400);
    }
    let body: unknown;
    try { body = JSON.parse((await boundedBody(request, 4096)).toString("utf8")); }
    catch { return json({ error: "คำขอไม่ถูกต้องหรือใหญ่เกินกำหนด" }, 400); }
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) return json({ error: "รหัสผ่านต้องยาว 10–128 ตัวอักษร พร้อมเหตุผลและ UUID (ไม่รองรับฟิลด์อื่น)" }, 400);
    const { requestKey, reason, password } = parsed.data;
    // Reasons are audit metadata, not a channel for disclosing the submitted password.
    if (reason.includes(password)) return json({ error: "ห้ามใส่รหัสผ่านในเหตุผล" }, 400);
    const secret = process.env.SMS_API_SECRET;
    if (!process.env.DATABASE_URL || !secret) throw Error("Service unavailable");
    // Domain-separated, length-unambiguous and server-keyed. Never an unkeyed password digest.
    const bodyMac = createHmac("sha256", secret).update(JSON.stringify([
      "blu:admin-member-password:v1", actor.id, memberCode, requestKey, reason, password,
    ])).digest("hex");
    const payload = JSON.stringify({ memberCode, reason, bodyMac });
    const digest = createHash("sha256").update(token).digest("hex");
    const sql = neon(process.env.DATABASE_URL);
    const claimed = await sql`SELECT admin_member_password_action(${digest},${requestKey}::uuid,${payload}::jsonb) AS result`;
    const state = claimed[0]?.result;
    if (state === "done") return json({ ok: true });
    if (state === "limited") return json({ error: "ตั้งรหัสผ่านถี่เกินกำหนด กรุณารอแล้วลองใหม่" }, 429);
    if (state === "busy") return json({ error: "คำขอนี้ถูกจองแล้ว ส่ง body เดิมเพื่อตรวจผลได้ แต่จะไม่เริ่มงานซ้ำ หากไม่สำเร็จให้รอ 2 นาทีแล้วเริ่มคำขอใหม่" }, 409);
    if (state !== "claimed") throw Error("Unknown claim result");
    const passwordHash = await hashPassword(password);
    const completed = await sql`SELECT admin_member_password_action(${digest},${requestKey}::uuid,${payload}::jsonb,${passwordHash}) AS result`;
    if (completed[0]?.result !== "done") throw Error("Unknown completion result");
    return json({ ok: true });
  } catch (error) {
    // Never log errors: transports can attach SQL parameters (including the credential hash).
    if (error instanceof PasswordWorkLimitError) return json({ error: "ระบบตั้งรหัสผ่านไม่ว่าง คำขอถูกจองแล้ว กรุณารอ 2 นาทีแล้วเริ่มคำขอใหม่" }, 429);
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "สิทธิ์หรือ session เปลี่ยน หรือบัญชีเป้าหมายไม่อนุญาต กรุณาโหลดหน้าใหม่" }, 403);
    if (code === "P0001") return json({ error: "UUID ถูกใช้กับข้อมูลอื่น หรือคำขอหมดอายุ/ข้อมูลเปลี่ยน กรุณาโหลดหน้าใหม่" }, 409);
    if (code === "22023") return json({ error: "คำขอตั้งรหัสผ่านไม่ถูกต้อง" }, 400);
    return json({ error: "ยังยืนยันผลไม่ได้ ส่งคำขอเดิมเพื่อตรวจผล ห้ามเปลี่ยน body โดยใช้ UUID เดิม" }, 503);
  }
}
