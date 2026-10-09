import { PasswordWorkLimitError } from "@/lib/auth/password";
import { json, readBody } from "@/lib/auth/http";
import { normalizePhone } from "@/lib/auth/policy";
import { loginPassword, SESSION_COOKIE } from "@/lib/auth/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await readBody(request);
  const phone = normalizePhone(body?.phone);
  if (!phone || typeof body?.password !== "string" || !body.password.length || body.password.length > 128) return json({ error: "กรุณาตรวจสอบเบอร์โทรและรหัสผ่าน" }, 400);
  try {
    const session = await loginPassword(phone, body.password);
    if (!session) return json({ error: "เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง หากยังไม่มีรหัสผ่าน กรุณาตั้งรหัสผ่านครั้งแรก" }, 401);
    if ("limited" in session) return json({ error: "ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาที" }, 429);
    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", expires: session.expiresAt });
    return response;
  } catch (error) {
    if (error instanceof PasswordWorkLimitError) return json({ error: "ระบบกำลังประมวลผล กรุณารอสักครู่ แล้วขอ OTP ใหม่หากกำลังตั้งรหัสผ่านหรือสมัครสมาชิก" }, 429);
    return json({ error: "ระบบไม่พร้อมใช้งาน" }, 503); }
}
