import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, readBody } from "./auth/http";

export type RealReward = { id: number; title: string; description: string | null; imageUrl: string | null; pointCost: number; stock: number; isActive: boolean };
export type RealRedemption = { id: number; rewardId: number; rewardTitle: string; rewardCode: string | null; pointsSpent: number; status: string; redeemedAt: string; completedAt: string | null; memberCode: string; memberName: string };
export type RewardsData = { points: number; memberCode: string; fullName: string; rewards: RealReward[]; redemptions: RealRedemption[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const integer = (value: unknown, min: number, max = 1000000) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const memberCodePattern = /^BLU-\d{1,12}$/;
const cardCodePattern = /^CARD-\d{1,95}$/;
const historyPageSize = 50;
export type AdminRewardsHistory = { rewards: RealReward[]; redemptions: RealRedemption[]; nextBeforeId: number | null; cardSearchAvailable: boolean };

type HistoryFilters = {
  status: "ALL" | "PENDING" | "COMPLETED";
  memberCode: string | null; memberName: string | null; rewardTitle: string | null; rewardCode: string | null; cardCode: string | null;
  packageDays: number | "UNKNOWN" | null; beforeId: number | null;
};

function canonicalRewardCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^BLU-RW-/i, "");
  return uuid.test(normalized) ? normalized.toLowerCase() : null;
}

export function rewardHistoryFilters(body: Record<string, unknown>): HistoryFilters | null {
  if (Object.keys(body).some(key => !["status", "memberCode", "memberName", "rewardTitle", "rewardCode", "scan", "packageDays", "beforeId"].includes(key))) return null;
  const { status = "PENDING", memberCode = "", memberName = "", rewardTitle = "", rewardCode = "", scan = "", packageDays = null, beforeId = null } = body;
  if (status !== "ALL" && status !== "PENDING" && status !== "COMPLETED") return null;
  if (beforeId !== null && (typeof beforeId !== "number" || !integer(beforeId, 1, 2147483647))) return null;
  if (packageDays !== null && packageDays !== "UNKNOWN" && (typeof packageDays !== "number" || !integer(packageDays, 1, 3660))) return null;
  if (typeof memberCode !== "string" || memberCode.length > 50 || typeof memberName !== "string" || memberName.length > 120 || /[\u0000-\u001f\u007f]/.test(memberName) ||
    typeof rewardTitle !== "string" || rewardTitle.length > 120 || /[\u0000-\u001f\u007f]/.test(rewardTitle) ||
    typeof rewardCode !== "string" || rewardCode.length > 50 || typeof scan !== "string" || scan.length > 100) return null;
  const member = memberCode.trim().toUpperCase();
  const reward = canonicalRewardCode(rewardCode);
  if ((member && !memberCodePattern.test(member)) || (rewardCode.trim() && !reward)) return null;
  const scanned = scan.trim().toUpperCase();
  const scannedReward = canonicalRewardCode(scanned);
  const scannedMember = memberCodePattern.test(scanned) ? scanned : null;
  const cardCode = cardCodePattern.test(scanned) ? scanned : null;
  if (scanned && !scannedReward && !scannedMember && !cardCode) return null;
  if ((scannedMember && member && member !== scannedMember) || (scannedReward && reward && reward !== scannedReward)) return null;
  return { status, memberCode: scannedMember ?? (member || null), memberName: memberName.trim() || null,
    rewardTitle: rewardTitle.trim() || null, rewardCode: scannedReward ?? reward, cardCode, packageDays, beforeId };
}

export function rewardPayload(action: string, body: Record<string, unknown>): Record<string, unknown> | null {
  if (action === "redeem") return integer(body.rewardId, 1, 2147483647) ? { rewardId: body.rewardId } : null;
  if (action === "deliver") {
    const rewardCode = canonicalRewardCode(body.rewardCode);
    return rewardCode ? { rewardCode } : null;
  }
  if (action !== "save" || typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 120 ||
    !integer(body.pointCost, 1) || !integer(body.stock, 0) || typeof body.isActive !== "boolean" ||
    (body.description !== null && (typeof body.description !== "string" || body.description.length > 2000)) ||
    (body.imageUrl !== null && (typeof body.imageUrl !== "string" || body.imageUrl.length > 2000 || !/^https:\/\/\S+$/.test(body.imageUrl)))) return null;
  if (body.id !== undefined && (!integer(body.id, 1, 2147483647) || !body.expected || typeof body.expected !== "object" || Array.isArray(body.expected))) return null;
  return { ...(body.id === undefined ? {} : { id: body.id, expected: body.expected }), title: body.title.trim(), description: body.description, imageUrl: body.imageUrl, pointCost: body.pointCost, stock: body.stock, isActive: body.isActive };
}

async function rewardConnection() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Unauthorized");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
  const sql = neon(process.env.DATABASE_URL);
  const digest = createHash("sha256").update(token).digest("hex");
  return { sql, digest };
}

async function execute(action: string, key: string | null, payload: Record<string, unknown>) {
  const { sql, digest } = await rewardConnection();
  for (let attempt = 0; ; attempt++) {
    try {
      const rows = await sql`SELECT real_rewards_action(${digest}, ${action}, ${key}::uuid, ${JSON.stringify(payload)}::jsonb) AS result`;
      return rows[0].result;
    } catch (error) {
      if (attempt >= 2 || !["40001", "40P01"].includes((error as { code?: string }).code ?? "")) throw error;
    }
  }
}

async function readAdminHistory(filters: HistoryFilters): Promise<AdminRewardsHistory | null> {
  const { sql, digest } = await rewardConnection();
  // Optional migrations: neither legacy card values nor purchase history substitute for evidence.
  const [capabilities] = await sql`SELECT pg_catalog.to_regclass('public.member_cards') IS NOT NULL AS cards,
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.redemptions'::regclass AND attname='package_days_at_redemption'
        AND attnum>0 AND NOT attisdropped) AS package_snapshot`;
  const cards = capabilities.cards === true;
  const cardMatch = !filters.cardCode ? sql`TRUE` : cards
    ? sql`EXISTS (SELECT 1 FROM public.member_cards c WHERE c.card_code=${filters.cardCode} AND c.member_id=h.member_id)`
    : sql`FALSE`;
  const packageMatch = filters.packageDays === null ? sql`TRUE`
    : capabilities.package_snapshot !== true ? sql`${filters.packageDays === "UNKNOWN"}::boolean`
    : filters.packageDays === "UNKNOWN" ? sql`h.package_days_at_redemption IS NULL`
    : sql`h.package_days_at_redemption=${filters.packageDays}::integer`;
  const [row] = await sql`
    WITH staff AS MATERIALIZED (
      SELECT m.id FROM public.auth_sessions s JOIN public.members m ON m.id=s.member_id
      WHERE s.token_hash=${digest} AND s.mode='NORMAL' AND s.revoked_at IS NULL
        AND s.expires_at>clock_timestamp() AND m.status<>'SUSPENDED' AND m.role IN ('ADMIN','OWNER')
    ), page AS MATERIALIZED (
      SELECT h.id, h.reward_id AS "rewardId", coalesce(h.reward_title,catalog.title) AS "rewardTitle",
        h.reward_code AS "rewardCode", h.points_spent AS "pointsSpent", h.status, h.redeemed_at AS "redeemedAt",
        h.completed_at AS "completedAt", m.member_code AS "memberCode", m.full_name AS "memberName"
      FROM staff CROSS JOIN public.redemptions h JOIN public.members m ON m.id=h.member_id
      JOIN public.rewards catalog ON catalog.id=h.reward_id
      WHERE (${filters.beforeId}::integer IS NULL OR h.id<${filters.beforeId}::integer)
        AND (${filters.status}::text='ALL' OR h.status=${filters.status})
        AND (${filters.memberCode}::text IS NULL OR m.member_code=${filters.memberCode})
        AND (${filters.memberName}::text IS NULL OR strpos(lower(m.full_name), lower(${filters.memberName}::text))>0)
        AND (${filters.rewardTitle}::text IS NULL OR strpos(lower(coalesce(h.reward_title,catalog.title)), lower(${filters.rewardTitle}::text))>0)
        AND (${filters.rewardCode}::uuid IS NULL OR h.reward_code=${filters.rewardCode}::uuid)
        AND ${cardMatch} AND ${packageMatch}
      ORDER BY h.id DESC LIMIT ${historyPageSize + 1}
    )
    SELECT coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id DESC) FROM page p),'[]'::jsonb) AS redemptions,
      coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM (
        SELECT id,title,description,image_url AS "imageUrl",point_cost AS "pointCost",stock,is_active AS "isActive" FROM public.rewards
      ) r),'[]'::jsonb) AS rewards
    FROM staff`;
  if (!row) return null;
  const redemptions = (row.redemptions as RealRedemption[]).slice(0, historyPageSize);
  return { rewards: row.rewards, redemptions, nextBeforeId: row.redemptions.length > historyPageSize ? redemptions[historyPageSize - 1].id : null, cardSearchAvailable: cards };
}

export async function readRealRewards(): Promise<RewardsData> {
  const member = await getCurrentMember();
  if (!member) throw new Error("Unauthorized");
  return execute("member", null, {});
}

export async function rewardsAction(request: Request, action: string) {
  if (!["member", "admin", "admin-history", "redeem", "deliver", "save"].includes(action)) return json({ error: "ไม่พบคำสั่ง" }, 404);
  const read = action === "member" || action === "admin";
  if (request.method !== (read ? "GET" : "POST")) return json({ error: "Method not allowed" }, 405);
  try {
    const member = await getCurrentMember();
    if (!member || member.status === "SUSPENDED") return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (["admin", "admin-history", "deliver", "save"].includes(action) && !["ADMIN", "OWNER"].includes(member.role)) return json({ error: "ไม่มีสิทธิ์" }, 403);
    if (read) return json({ data: await execute(action, null, {}) });
    const body = await readBody(request);
    if (action === "admin-history") {
      const filters = body && rewardHistoryFilters(body);
      if (!filters) return json({ error: "ตัวกรองหรือรหัสไม่ถูกต้อง" }, 400);
      const data = await readAdminHistory(filters);
      if (!data) return json({ error: "เซสชันหมดอายุหรือไม่มีสิทธิ์" }, 403);
      if (filters.cardCode && !data.cardSearchAvailable) return json({ error: "ฐานข้อมูลนี้ยังไม่รองรับการค้นด้วย CARD กรุณาใช้ BLU" }, 503);
      return json({ data });
    }
    if (!body || typeof body.requestKey !== "string" || !uuid.test(body.requestKey)) return json({ error: "ต้องระบุ requestKey UUID และ JSON จากเว็บไซต์เดียวกัน" }, 400);
    const payload = rewardPayload(action, body);
    if (!payload) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    return json({ data: await execute(action, body.requestKey.toLowerCase(), payload) });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "เซสชันหมดอายุหรือไม่มีสิทธิ์" }, 403);
    if (code === "22023") return json({ error: "ข้อมูลไม่ถูกต้อง หรือ requestKey ถูกใช้กับคำขออื่น" }, 409);
    if (code === "P0001") return json({ error: "ทำรายการไม่ได้: แต้ม/สต็อกไม่พอ ข้อมูลเปลี่ยน หรือผู้รับถูกระงับ กรุณาโหลดใหม่" }, 409);
    console.error("[rewards] operation failed", { code: code ?? "unknown" });
    return json({ error: "ยังยืนยันผลไม่ได้ กรุณาลองคำขอเดิมอีกครั้ง" }, 503);
  }
}
