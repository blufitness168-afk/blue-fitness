import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { neon } from "@neondatabase/serverless";
import { getCurrentMember, loginPassword, requireKioskSession, SESSION_COOKIE } from "./auth/server";
import { json, readBody } from "./auth/http";

const station = () => process.env.KIOSK_STATION_ID || "LOCAL_FRONT_DESK";
const client = () => {
  if (!process.env.DATABASE_URL) throw Error("Database unavailable");
  return neon(process.env.DATABASE_URL);
};
async function digest() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw Error("Unauthorized");
  return createHash("sha256").update(token).digest("hex");
}
export async function kioskAction(request: Request, action: string) {
  const body = await readBody(request);
  if (!body) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  try {
    const sql = client();
    if (action === "enter") {
      const member = await getCurrentMember();
      if (!member || !["ADMIN", "OWNER"].includes(member.role)) return json({ error: "เฉพาะพนักงาน" }, 403);
      const rows = await sql`UPDATE auth_sessions s SET mode='KIOSK', device_id=${station()}, expires_at=LEAST(expires_at,clock_timestamp()+interval '12 hours')
        WHERE token_hash=${await digest()} AND mode='NORMAL' AND revoked_at IS NULL AND expires_at>clock_timestamp()
        AND EXISTS(SELECT 1 FROM members m WHERE m.id=s.member_id AND m.role IN ('ADMIN','OWNER') AND m.status<>'SUSPENDED') RETURNING id`;
      return rows.length ? json({ ok: true }) : json({ error: "กรุณาเข้าสู่ระบบใหม่" }, 401);
    }
    const current = await requireKioskSession();
    if (!current) return json({ error: "เซสชัน kiosk สิ้นสุด กรุณาให้พนักงานเข้าสู่ระบบใหม่" }, 401);
    if (action === "status") return json({ ok: true, expiresAt: current.session.expiresAt });
    if (action === "exit") {
      if (typeof body.password !== "string" || !body.password.length || body.password.length > 128) return json({ error: "กรุณากรอกรหัสผ่าน" }, 400);
      // Reuse existing password verification + throttle. Never change role or other sessions.
      const fresh = await loginPassword(current.member.phone, body.password);
      if (!fresh) return json({ error: "รหัสผ่านไม่ถูกต้อง" }, 401);
      if ("limited" in fresh) return json({ error: "ลองบ่อยเกินไป กรุณารอ 15 นาที" }, 429);
      const newHash = createHash("sha256").update(fresh.token).digest("hex");
      const rows = await sql`WITH old AS (
        UPDATE auth_sessions s SET revoked_at=clock_timestamp() WHERE token_hash=${await digest()} AND mode='KIOSK'
        AND revoked_at IS NULL AND expires_at>clock_timestamp()
        AND EXISTS(SELECT 1 FROM members m WHERE m.id=s.member_id AND m.role IN ('ADMIN','OWNER') AND m.status<>'SUSPENDED') RETURNING member_id
      ) UPDATE auth_sessions SET revoked_at=CASE WHEN EXISTS(SELECT 1 FROM old WHERE member_id=auth_sessions.member_id) THEN NULL ELSE clock_timestamp() END
       WHERE token_hash=${newHash} RETURNING revoked_at`;
      if (!rows.length || rows[0].revoked_at) return json({ error: "เซสชันสิ้นสุด กรุณาเข้าสู่ระบบใหม่" }, 401);
      const response = json({ ok: true });
      response.cookies.set(SESSION_COOKIE, fresh.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", expires: fresh.expiresAt });
      return response;
    }
    if (action === "scan") {
      if (typeof body.code !== "string" || !/^BLU-\d{1,12}$/i.test(body.code.trim()) || typeof body.requestKey !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.requestKey)) return json({ error: "รหัสสแกนไม่ถูกต้อง" }, 400);
      const rows = await sql`SELECT kiosk_checkin(${await digest()},${station()},${body.requestKey}::uuid,${body.code.trim().toUpperCase()}) AS result`;
      return json(rows[0].result);
    }
    return json({ error: "ไม่พบคำสั่ง" }, 404);
  } catch { return json({ error: "ระบบไม่พร้อมใช้งาน กรุณาลองคำขอเดิมอีกครั้ง" }, 503); }
}
