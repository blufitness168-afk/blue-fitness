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
      if (Object.keys(body).some(key => !["code", "requestKey", "direction", "station", "points"].includes(key))) return json({ error: "ยังไม่รองรับย้อนหลังหรือ override" }, 400);
      if (typeof body.code !== "string" || !/^(?:BLU-\d{1,12}|CARD-[0-9]{1,95})$/i.test(body.code.trim()) || typeof body.requestKey !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.requestKey)) return json({ error: "รหัสสแกนไม่ถูกต้อง" }, 400);
      const direction = body.direction ?? "IN";
      if (direction !== "IN" && direction !== "OUT") return json({ error: "ประเภทเข้าออกไม่ถูกต้อง" }, 400);
      const rows = await sql`SELECT member_scan_admit(${session},${process.env.KIOSK_STATION_ID || "LOCAL_FRONT_DESK"},${body.requestKey}::uuid,${body.code.trim().toUpperCase()},${direction}) AS result`;
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
    // Require an explicit offset; datetime-local clients send Bangkok +07:00.
    const dateFilter = (value: unknown) => value === undefined || value === "" ? null :
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? value : false;
    const from = dateFilter(body.from), to = dateFilter(body.to);
    if (from === false || to === false || (from && to && Date.parse(from) >= Date.parse(to))) return json({ error: "ช่วงเวลาไม่ถูกต้อง" }, 400);
    const capability = await sql`SELECT to_regclass('public.r7_visits') IS NOT NULL AS visits,
      to_regprocedure('public.r7_visit_action(text,text,uuid,text,text)') IS NOT NULL AS "outSupported"`;
    if (typeof capability[0]?.visits !== "boolean" || typeof capability[0]?.outSupported !== "boolean") throw Error("Unknown admission capability");
    const rows = capability[0].visits ? await sql`WITH filtered AS (
      SELECT c.id, m.member_code AS "memberCode", m.full_name AS "fullName", coalesce(v.entered_at,c.checkin_time) AS "checkedAt", c.scanner_type AS "scannerType", c.points_awarded AS "pointsAwarded", c.notes,
        v.exited_at AS "exitedAt", v.snapshot, CASE WHEN v.exited_at IS NOT NULL THEN extract(epoch FROM v.exited_at-v.entered_at) END AS "durationSeconds",
        extract(hour FROM coalesce(v.entered_at,c.checkin_time) AT TIME ZONE 'Asia/Bangkok')::integer AS hour
      FROM checkins c JOIN members m ON m.id=c.member_id LEFT JOIN r7_visits v ON v.checkin_id=c.id
      WHERE EXISTS (SELECT 1 FROM auth_sessions s JOIN members staff ON staff.id=s.member_id WHERE s.token_hash=${session} AND s.mode='NORMAL' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND staff.role IN ('ADMIN','OWNER') AND staff.status<>'SUSPENDED')
      AND (m.member_code ILIKE ${pattern} OR m.full_name ILIKE ${pattern})
      AND (${from}::timestamptz IS NULL OR coalesce(v.entered_at,c.checkin_time)>=${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR coalesce(v.entered_at,c.checkin_time)<${to}::timestamptz)
    ) SELECT
      coalesce((SELECT jsonb_agg(r ORDER BY r."checkedAt" DESC,r.id DESC) FROM (SELECT * FROM filtered ORDER BY "checkedAt" DESC,id DESC LIMIT 51 OFFSET ${(page - 1) * 50}) r),'[]'::jsonb) AS records,
      (SELECT jsonb_agg(jsonb_build_object('hour',h,'entries',(SELECT count(*) FROM filtered WHERE hour=h)) ORDER BY h) FROM generate_series(0,23) h) AS hourly` : await sql`WITH filtered AS (
      SELECT c.id, m.member_code AS "memberCode", m.full_name AS "fullName", c.checkin_time AS "checkedAt",
        c.scanner_type AS "scannerType", c.points_awarded AS "pointsAwarded", c.notes,
        NULL::timestamptz AS "exitedAt", NULL::jsonb AS snapshot, NULL::numeric AS "durationSeconds",
        extract(hour FROM c.checkin_time AT TIME ZONE 'Asia/Bangkok')::integer AS hour
      FROM checkins c JOIN members m ON m.id=c.member_id
      WHERE EXISTS (SELECT 1 FROM auth_sessions s JOIN members staff ON staff.id=s.member_id WHERE s.token_hash=${session} AND s.mode='NORMAL' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND staff.role IN ('ADMIN','OWNER') AND staff.status<>'SUSPENDED')
      AND (m.member_code ILIKE ${pattern} OR m.full_name ILIKE ${pattern})
      AND (${from}::timestamptz IS NULL OR c.checkin_time>=${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR c.checkin_time<${to}::timestamptz)
    ) SELECT
      coalesce((SELECT jsonb_agg(r ORDER BY r."checkedAt" DESC,r.id DESC) FROM (SELECT * FROM filtered ORDER BY "checkedAt" DESC,id DESC LIMIT 51 OFFSET ${(page - 1) * 50}) r),'[]'::jsonb) AS records,
      (SELECT jsonb_agg(jsonb_build_object('hour',h,'entries',(SELECT count(*) FROM filtered WHERE hour=h)) ORDER BY h) FROM generate_series(0,23) h) AS hourly`;
    const records = rows[0]?.records ?? [];
    return json({ outSupported: capability[0].outSupported, records: records.slice(0, 50), hasMore: records.length > 50, hourly: rows[0]?.hourly ?? Array.from({ length: 24 }, (_, hour) => ({ hour, entries: 0 })) });
  } catch (error) {
    const databaseError = error as { code?: string; detail?: string };
    if (databaseError.code === "0A000" && databaseError.detail === "MEMBER_SCAN_OUT_UNSUPPORTED_BEFORE_WRITE") return json({ error: "ระบบเข้าใช้บริการปัจจุบันยังไม่รองรับ OUT — ยังไม่ได้บันทึกรายการ", reason: "OUT_UNSUPPORTED", operationUnavailable: true, outSupported: false }, 422);
    return json({ error: "ระบบไม่พร้อมใช้งาน กรุณาลองคำขอเดิมอีกครั้ง" }, 503);
  }
}
