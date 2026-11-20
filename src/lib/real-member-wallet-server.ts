import "server-only";
import { neon } from "@neondatabase/serverless";
import { getCurrentMember } from "./auth/server";
import { json } from "./auth/http";
import { onlineCancellationReads } from "./online-cancellation-rollout-server";
import { staffPaidReadsEnabled } from "./staff-paid-rollout-server";

export type MemberWallet = {
  points: number; status: string; expiresAt: string | null;
  purchases: { id: string; packageName: string | null; amountSatang: number; pointsEarned: number; paidAt: string | null; membershipExpiresAt: string | null; source?: "ONLINE_PAID" | "STAFF_TRANSFER"; startsAt?: string | null; cancelledAt?: string | null; refundSatang?: number | null }[];
  checkins: { id: number; checkedAt: string; scannerDeviceId: string }[];
  coupons: { id: number; title: string; type: string; source: string | null; status: string; totalQuota: number; usedCount: number; expiresAt: string | null; createdAt: string;
      campaignExpiresAt?: string | null; activatedAt?: string | null; activationDurationMinutes?: number | null }[];
  pointLedger: { id: string; description: string; delta: number; balanceAfter: number; createdAt: string }[];
};

export async function getRealMemberWallet() {
  try {
    const member = await getCurrentMember();
    if (!member) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (!process.env.DATABASE_URL) throw new Error("Database unavailable");
    const sql = neon(process.env.DATABASE_URL);
    const r4Reads = staffPaidReadsEnabled();
    const onlineReads = await onlineCancellationReads(sql);
    const extendedHistory = r4Reads || onlineReads;
    // One statement keeps the balance and all histories on the same database snapshot.
    const rows = await sql`
      SELECT jsonb_build_object(
        'points', m.points, 'status', CASE ${r4Reads ? sql`WHEN paid.expiry IS NOT NULL THEN 'ACTIVE'` : sql``}
          WHEN m.status = 'ACTIVE' AND (m.expire_date IS NULL OR m.expire_date <= now()) THEN 'EXPIRED' ELSE m.status::text END,
        'expiresAt', ${r4Reads ? sql`COALESCE(paid.expiry, m.expire_date)` : sql`m.expire_date`},
        'purchases', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."paidAt" DESC NULLS LAST, p.id) FROM (
          SELECT id, "packageName", "amountSatang", "pointsEarned", "paidAt", "membershipExpiresAt"
            ${extendedHistory ? sql`, source, "startsAt", "cancelledAt"` : sql``}
            ${onlineReads ? sql`, "refundSatang"` : sql``} FROM (
            SELECT id::text AS id, package_snapshot->>'name' AS "packageName", amount_satang AS "amountSatang",
              points_earned AS "pointsEarned", paid_at AS "paidAt", membership_expires_at AS "membershipExpiresAt"
              ${extendedHistory ? sql`, 'ONLINE_PAID' AS source, NULL::timestamptz AS "startsAt",
                ${onlineReads ? sql`c.cancelled_at` : sql`NULL::timestamptz`} AS "cancelledAt"` : sql``}
              ${onlineReads ? sql`, c.refund_satang AS "refundSatang"` : sql``}
            ${onlineReads ? sql`FROM package_payment_orders o LEFT JOIN r4_online_private.cancellations c ON c.order_id = o.id
              WHERE o.member_id = m.id AND o.status = 'PAID'` : sql`FROM package_payment_orders WHERE member_id = m.id AND status = 'PAID'`}
            ${r4Reads ? sql`UNION ALL
            SELECT 'staff-transfer:' || sale_id, package_name, amount_satang, points_delta, occurred_at, ends_at, 'STAFF_TRANSFER', starts_at, cancelled_at
              ${onlineReads ? sql`, NULL::integer` : sql``}
            FROM r4_staff_private.paid_history WHERE member_id = m.id` : sql``}
          ) history ORDER BY "paidAt" DESC NULLS LAST, id LIMIT 100
        ) p), '[]'::jsonb),
        'checkins', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c."checkedAt" DESC, c.id DESC) FROM (
          SELECT id, checkin_time AS "checkedAt", scanner_device_id AS "scannerDeviceId"
          FROM checkins WHERE member_id = m.id ORDER BY checkin_time DESC, id DESC LIMIT 100
        ) c), '[]'::jsonb),
        'coupons', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c."createdAt" DESC, c.id DESC) FROM (
          SELECT id, title, type, source,
            CASE WHEN r6.fields->>'campaign_expires_at' IS NOT NULL AND status = 'AVAILABLE' THEN
              CASE WHEN expire_date <= statement_timestamp() THEN 'EXPIRED'
                   WHEN r6.fields->>'activated_at' IS NULL THEN 'PENDING_ACTIVATION' ELSE 'AVAILABLE' END
            ELSE status::text END AS status,
            total_quota AS "totalQuota", used_count AS "usedCount", expire_date AS "expiresAt", created_at AS "createdAt",
            r6.fields->'campaign_expires_at' AS "campaignExpiresAt", r6.fields->'activated_at' AS "activatedAt",
            r6.fields->'activation_duration_minutes' AS "activationDurationMinutes"
          FROM coupons wallet
          -- JSON lookup keeps this statement compatible with the unmigrated table.
          CROSS JOIN LATERAL (SELECT to_jsonb(wallet) AS fields) r6
          WHERE member_id = m.id ORDER BY created_at DESC, id DESC LIMIT 100
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
            ${onlineReads ? sql`UNION ALL
            SELECT 'online-reversal:' || order_id, 'ถอนคะแนนจากการยกเลิกแพ็กเกจออนไลน์', delta, balance_after, created_at
            FROM r4_online_private.point_reversals WHERE member_id = m.id` : sql``}
            ${r4Reads ? sql`UNION ALL
            SELECT (CASE WHEN is_reversal THEN 'staff-transfer-reversal:' ELSE 'staff-transfer:' END) || sale_id,
              CASE WHEN is_reversal THEN 'ถอนคะแนนจากการยกเลิกแพ็กเกจโอน' ELSE 'ต่ออายุโดยเจ้าหน้าที่ (โอน)' END,
              delta, balance_after, created_at
            FROM r4_staff_private.paid_point_ledger WHERE member_id = m.id` : sql``}
          ) entries ORDER BY "createdAt" DESC, id LIMIT 100
        ) l), '[]'::jsonb)
      ) AS data FROM members m
      ${r4Reads ? sql`CROSS JOIN LATERAL (SELECT r4_staff_private.paid_active_expiry(m.id, now()) AS expiry) paid` : sql``}
      WHERE m.id = ${member.id} AND m.status <> 'SUSPENDED'
    `;
    if (!rows[0]?.data) return json({ error: "ไม่พบข้อมูลสมาชิกที่เข้าถึงได้" }, 401);
    return json({ data: rows[0].data });
  } catch {
    return json({ error: "โหลดกระเป๋าสมาชิกไม่สำเร็จ ระบบฐานข้อมูลอาจยังไม่พร้อม กรุณาลองใหม่หรือติดต่อเจ้าหน้าที่" }, 503);
  }
}
