import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { coupons } from "@/db/schema";
import { SESSION_COOKIE } from "@/lib/auth/server";

export async function readWelcomeCoupons(memberId: number) {
  const rows = await db.select().from(coupons).where(and(eq(coupons.memberId, memberId), eq(coupons.source, "WELCOME_REGISTRATION"), eq(coupons.type, "FREE_ENTRY")));
  return rows.map(c => ({ id: c.id, title: c.title, status: c.status, usedCount: c.usedCount, totalQuota: c.totalQuota,
      expired: c.expireDate === null || c.status === "EXPIRED" || Math.min(c.expireDate?.getTime() ?? Infinity, c.createdAt.getTime() + 30 * 86400000) <= Date.now(),
    expiresAt: new Date(Math.min(c.expireDate?.getTime() ?? Infinity, c.createdAt.getTime() + 30 * 86400000)).toISOString() }));
}
export type WelcomeCoupon = Awaited<ReturnType<typeof readWelcomeCoupons>>[number];

export async function redeemWelcomeEntry(couponId: number) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const digest = createHash("sha256").update(token).digest("hex");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
  const sql = neon(process.env.DATABASE_URL);
  // Consumption and the single-visit audit are inseparable; a failed insert rolls back consumption.
  const [rows] = await sql.transaction([sql`
    WITH consumed AS (
      UPDATE coupons c SET used_count = 1, status = 'USED'
      WHERE c.id = ${couponId} AND c.source = 'WELCOME_REGISTRATION' AND c.type = 'FREE_ENTRY'
        AND c.status = 'AVAILABLE' AND c.total_quota = 1 AND c.used_count = 0
        AND c.created_at <= now() AND c.created_at + interval '30 days' > now()
        AND c.expire_date IS NOT NULL AND c.expire_date > now()
        AND EXISTS (SELECT 1 FROM auth_sessions s JOIN members m ON m.id = s.member_id
          WHERE s.token_hash = ${digest} AND s.member_id = c.member_id
            AND s.revoked_at IS NULL AND s.expires_at > now() AND m.status <> 'SUSPENDED')
      RETURNING c.id, c.member_id
    )
    INSERT INTO checkins (member_id, scanner_type, scanner_device_id, points_awarded, notes)
    SELECT member_id, 'WEB_CAMERA', 'MEMBER_COUPON_SELF_SERVICE', 0,
      'สิทธิ์เข้าฟรี 1 ครั้ง: WELCOME_REGISTRATION coupon=' || id || '; สมาชิกยืนยันเอง ไม่ใช่การสแกนหน้าร้าน'
    FROM consumed RETURNING id, checkin_time
  `], { isolationLevel: "Serializable" });
  return rows[0] ? { checkinId: rows[0].id, checkedAt: rows[0].checkin_time } : null;
}
