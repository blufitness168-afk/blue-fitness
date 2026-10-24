import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { neon } from "@neondatabase/serverless";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, readBody } from "./auth/http";

export async function realCheckinAction(request: Request, action: string) {
  const body = await readBody(request);
  if (!body) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  try {
    const member = await getCurrentMember();
    if (!member || !["ADMIN", "OWNER"].includes(member.role) || member.status === "SUSPENDED") return json({ error: "ต้องใช้เซสชันพนักงานปกติ" }, 403);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "กรุณาเข้าสู่ระบบใหม่" }, 401);
    if (!process.env.DATABASE_URL) throw Error("Database unavailable");
    const sql = neon(process.env.DATABASE_URL);
    const session = createHash("sha256").update(token).digest("hex");
    if (action === "scan") {
      if (typeof body.code !== "string" || !/^BLU-\d{1,12}$/i.test(body.code.trim()) || typeof body.requestKey !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.requestKey)) return json({ error: "รหัสสแกนไม่ถูกต้อง" }, 400);
      const rows = await sql`SELECT real_frontdesk_checkin(${session},${process.env.KIOSK_STATION_ID || "LOCAL_FRONT_DESK"},${body.requestKey}::uuid,${body.code.trim().toUpperCase()}) AS result`;
      return json(rows[0].result);
    }
    if (action !== "history" && action !== "members") return json({ error: "ไม่พบคำสั่ง" }, 404);
    if (typeof body.query !== "string" || body.query.length > 100) return json({ error: "คำค้นไม่ถูกต้อง" }, 400);
    const pattern = `%${body.query.trim().replace(/[\\%_]/g, "\\$&")}%`;
    // Recheck current DB authorization in the same statement as each read.
    if (action === "members") {
      const rows = await sql`SELECT m.member_code AS "memberCode", m.full_name AS "fullName" FROM members m
        WHERE EXISTS (SELECT 1 FROM auth_sessions s JOIN members staff ON staff.id=s.member_id WHERE s.token_hash=${session} AND s.mode='NORMAL' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND staff.role IN ('ADMIN','OWNER') AND staff.status<>'SUSPENDED')
        AND (m.member_code ILIKE ${pattern} OR m.full_name ILIKE ${pattern} OR m.phone ILIKE ${pattern}) ORDER BY m.member_code LIMIT 30`;
      return json({ members: rows });
    }
    const page = body.page === undefined ? 1 : Number(body.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return json({ error: "หน้าไม่ถูกต้อง" }, 400);
    const rows = await sql`SELECT c.id, m.member_code AS "memberCode", m.full_name AS "fullName", c.checkin_time AS "checkedAt", c.scanner_type AS "scannerType", c.points_awarded AS "pointsAwarded", c.notes
      FROM checkins c JOIN members m ON m.id=c.member_id
      WHERE EXISTS (SELECT 1 FROM auth_sessions s JOIN members staff ON staff.id=s.member_id WHERE s.token_hash=${session} AND s.mode='NORMAL' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND staff.role IN ('ADMIN','OWNER') AND staff.status<>'SUSPENDED')
      AND (m.member_code ILIKE ${pattern} OR m.full_name ILIKE ${pattern}) ORDER BY c.checkin_time DESC,c.id DESC LIMIT 51 OFFSET ${(page - 1) * 50}`;
    return json({ records: rows.slice(0, 50), hasMore: rows.length > 50 });
  } catch { return json({ error: "ระบบไม่พร้อมใช้งาน กรุณาลองคำขอเดิมอีกครั้ง" }, 503); }
}
