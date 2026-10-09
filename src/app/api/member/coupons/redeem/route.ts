import { getCurrentMember } from "@/lib/auth/server";
import { json, readBody } from "@/lib/auth/http";
import { redeemWelcomeEntry } from "@/lib/benefits-server";

export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body || Object.keys(body).length !== 1 || !Number.isSafeInteger(body.couponId) || Number(body.couponId) < 1) return json({ error: "ข้อมูลคูปองไม่ถูกต้อง" }, 400);
  try {
    const member = await getCurrentMember();
    if (!member) return json({ error: "กรุณาเข้าสู่ระบบใหม่" }, 401);
    const result = await redeemWelcomeEntry(Number(body.couponId));
    if (!result) return json({ error: "ใช้สิทธิ์ไม่ได้: คูปองหมดอายุ ใช้แล้ว หรือไม่มีสิทธิ์" }, 409);
    return json({ ...result, message: "ใช้คูปองและบันทึกสิทธิ์เข้าฟรี 1 ครั้งแล้ว (ยืนยันเอง ไม่ใช่การสแกนหน้าร้าน)" });
  } catch {
    return json({ error: "ยังยืนยันผลไม่ได้ กรุณาโหลดหน้าใหม่เพื่อตรวจสถานะก่อนลองอีกครั้ง" }, 503);
  }
}
