import { json, readBody } from "@/lib/auth/http";
import { completeRegistration, SESSION_COOKIE } from "@/lib/auth/server";
import { registrationSchema } from "@/lib/auth/registration";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readBody(request);
  if (typeof body?.ticket !== "string" || !/^[a-f0-9]{64}$/.test(body.ticket)) return json({ error: "ยืนยันเบอร์โทรก่อนสมัคร" }, 400);
  const profile = registrationSchema.safeParse(body.profile);
  if (!profile.success) return json({ error: "กรุณาตรวจสอบข้อมูลสมัครสมาชิก" }, 400);
  try {
    const session = await completeRegistration(body.ticket, profile.data);
    if (!session) return json({ error: "ลิงก์ยืนยันหมดอายุหรือถูกใช้แล้ว กรุณาขอ OTP ใหม่" }, 409);
    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      expires: session.expiresAt,
    });
    return response;
  } catch {
    return json({ error: "สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่" }, 503);
  }
}
