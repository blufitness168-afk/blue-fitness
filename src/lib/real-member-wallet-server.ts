import "server-only";
import { neon } from "@neondatabase/serverless";
import { getCurrentMember } from "./auth/server";
import { json } from "./auth/http";

export type MemberWallet = {
  points: number; status: string; expiresAt: string | null;
  purchases: { id: string; packageName: string | null; amountSatang: number; pointsEarned: number; paidAt: string | null; membershipExpiresAt: string | null }[];
  checkins: { id: number; checkedAt: string; scannerDeviceId: string }[];
  coupons: { id: number; title: string; type: string; source: string | null; status: string; totalQuota: number; usedCount: number; expiresAt: string | null; createdAt: string }[];
  pointLedger: { id: string; description: string; delta: number; balanceAfter: number; createdAt: string }[];
};

export async function getRealMemberWallet() {
  try {
    const member = await getCurrentMember();
    if (!member) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (!process.env.DATABASE_URL) throw new Error("Database unavailable");
    const sql = neon(process.env.DATABASE_URL);
    // One statement keeps the balance and all histories on the same database snapshot.
    const rows = await sql`
      SELECT jsonb_build_object(
        'points', m.points, 'status', CASE WHEN m.status = 'ACTIVE' AND (m.expire_date IS NULL OR m.expire_date <= now()) THEN 'EXPIRED' ELSE m.status::text END, 'expiresAt', m.expire_date,
        'purchases', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."paidAt" DESC NULLS LAST, p.id) FROM (
          SELECT id, package_snapshot->>'name' AS "packageName", amount_satang AS "amountSatang",
            points_earned AS "pointsEarned", paid_at AS "paidAt", membership_expires_at AS "membershipExpiresAt"
          FROM package_payment_orders WHERE member_id = m.id AND status = 'PAID'
          ORDER BY paid_at DESC NULLS LAST, id LIMIT 100
        ) p), '[]'::jsonb),
        'checkins', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c."checkedAt" DESC, c.id DESC) FROM (
          SELECT id, checkin_time AS "checkedAt", scanner_device_id AS "scannerDeviceId"
          FROM checkins WHERE member_id = m.id ORDER BY checkin_time DESC, id DESC LIMIT 100
        ) c), '[]'::jsonb),
        'coupons', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c."createdAt" DESC, c.id DESC) FROM (
          SELECT id, title, type, source, status, total_quota AS "totalQuota", used_count AS "usedCount",
            expire_date AS "expiresAt", created_at AS "createdAt"
          FROM coupons WHERE member_id = m.id ORDER BY created_at DESC, id DESC LIMIT 100
        ) c), '[]'::jsonb),
        'pointLedger', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l."createdAt" DESC, l.id) FROM (
          SELECT * FROM (
            SELECT 'payment:' || order_id::text AS id, 'ซื้อแพ็กเกจ' AS description,
              delta, balance_after AS "balanceAfter", created_at AS "createdAt"
            FROM package_payment_point_ledger WHERE member_id = m.id
            UNION ALL
            SELECT 'reward:' || redemption_id::text AS id, 'แลกรางวัล' AS description,
              delta, balance_after AS "balanceAfter", created_at AS "createdAt"
            FROM reward_point_spend_ledger WHERE member_id = m.id
          ) entries ORDER BY "createdAt" DESC, id LIMIT 100
        ) l), '[]'::jsonb)
      ) AS data FROM members m WHERE m.id = ${member.id} AND m.status <> 'SUSPENDED'
    `;
    if (!rows[0]?.data) return json({ error: "ไม่พบข้อมูลสมาชิกที่เข้าถึงได้" }, 401);
    return json({ data: rows[0].data });
  } catch {
    return json({ error: "โหลดกระเป๋าสมาชิกไม่สำเร็จ ระบบฐานข้อมูลอาจยังไม่พร้อม กรุณาลองใหม่หรือติดต่อเจ้าหน้าที่" }, 503);
  }
}
