import { json, readBody } from "@/lib/auth/http";
import { validChallengeId, validCode } from "@/lib/auth/policy";
import { verifyOtp } from "@/lib/auth/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await readBody(request);
  if (!validChallengeId(body?.challengeId) || !validCode(body?.code)) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  try {
    const result = await verifyOtp(body.challengeId, body.code);
    return result ? json(result) : json({ error: "OTP ไม่ถูกต้องหรือหมดอายุ" }, 401);
  } catch { return json({ error: "ระบบไม่พร้อมใช้งาน" }, 503); }
}
