import { randomBytes } from "node:crypto";
import { json, readBody } from "@/lib/auth/http";
import { normalizePhone } from "@/lib/auth/policy";
import { sendOtp } from "@/lib/auth/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await readBody(request);
  const phone = normalizePhone(body?.phone);
  const purpose = body?.purpose;
  if (!phone || (purpose !== "PASSWORD_SETUP" && purpose !== "PASSWORD_RESET")) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  try {
    const result = await sendOtp(phone, purpose);
    return json({ challengeId: result?.challengeId ?? randomBytes(16).toString("hex") }, 202);
  } catch { return json({ error: "ส่ง OTP ไม่สำเร็จ กรุณาลองภายหลัง" }, 503); }
}
