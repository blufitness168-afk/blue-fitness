import { PasswordWorkLimitError } from "@/lib/auth/password";
import { json, readBody } from "@/lib/auth/http";
import { passwordSchema } from "@/lib/auth/registration";
import { completePassword, SESSION_COOKIE } from "@/lib/auth/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await readBody(request);
  const password = passwordSchema.safeParse(body?.password);
  const purpose = body?.purpose;
  if (typeof body?.ticket !== "string" || !/^[a-f0-9]{64}$/.test(body.ticket) || !password.success || (purpose !== "PASSWORD_SETUP" && purpose !== "PASSWORD_RESET")) return json({ error: "รหัสผ่านต้องยาว 10–128 ตัวอักษร และต้องยืนยัน OTP ก่อน" }, 400);
  try {
    if (!await completePassword(body.ticket, purpose, password.data)) return json({ error: "การยืนยันหมดอายุหรือถูกใช้แล้ว กรุณาขอ OTP ใหม่" }, 409);
    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    if (error instanceof PasswordWorkLimitError) return json({ error: "ระบบกำลังประมวลผล กรุณารอสักครู่ แล้วขอ OTP ใหม่หากกำลังตั้งรหัสผ่านหรือสมัครสมาชิก" }, 429);
    return json({ error: "ตั้งรหัสผ่านไม่สำเร็จ" }, 503); }
}
