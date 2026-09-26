import { json, readBody } from "@/lib/auth/http";
import { normalizePhone } from "@/lib/auth/policy";
import { sendOtp } from "@/lib/auth/server";


export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readBody(request);
  const phone = normalizePhone(body?.phone);
  if (!phone) return json({ error: "กรุณาตรวจสอบเบอร์โทรศัพท์" }, 400);
  try {
    const challenge = await sendOtp(phone, "REGISTER");
    if (!challenge) return json({ error: "เบอร์นี้สมัครไม่ได้ หรือขอ OTP บ่อยเกินไป" }, 409);
    return json(challenge, 202);
  } catch {
    return json({ error: "ส่ง OTP ไม่สำเร็จ กรุณาลองใหม่ภายหลัง" }, 503);
  }
}
