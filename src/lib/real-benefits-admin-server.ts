import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, readBody } from "./auth/http";

const id = z.number().int().min(1).max(2147483647);
const expiry = z.iso.datetime({ offset: true });
const promoSubtotal = z.number().int().min(0).max(100000000);
const eligiblePackages = z.array(id).min(1).max(100).refine(ids => new Set(ids).size === ids.length);
const create = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("COUPON"), title: z.string().trim().min(1).max(120), couponType: z.enum(["FRIEND_PASS", "EXTRA_DAYS"]), quota: z.number().int().min(1).max(100), bonusDays: z.number().int().min(0).max(365), activationDurationMinutes: z.number().int().min(0).max(2147483647).nullable().optional(), expiresAt: expiry }).strict().refine(p => p.couponType === "EXTRA_DAYS" ? p.quota === 1 && p.bonusDays > 0 : p.bonusDays === 0),
  z.object({ promoDescription: z.string().trim().min(1).max(500).optional(), promoRecipientLimit: z.number().int().min(1).max(1000000).nullable().optional(), kind: z.literal("PROMO"), title: z.string().trim().min(1).max(120), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/), discountType: z.enum(["FIXED", "PERCENT"]), discountValue: z.number().int().min(1).max(100000000), minSatang: promoSubtotal, maxSatang: promoSubtotal.nullable().optional(), eligiblePackageIds: eligiblePackages.nullable().optional(), maxDiscountSatang: z.number().int().min(1).max(100000000).nullable(), usageLimit: z.number().int().min(1).max(1000000), expiresAt: expiry }).strict().refine(p => p.discountType !== "PERCENT" || p.discountValue <= 100).refine(p => p.maxSatang == null || p.maxSatang >= p.minSatang),
]);
const recipientGroup = z.enum(["ALL", "1", "30", "90", "180", "365"]);
const memberCode = z.string().trim().regex(/^BLU-[0-9]{1,12}$/);
const grantProof = z.string().regex(/^[a-f0-9]{64}$/);
const grantPreview = z.object({ definitionId: id, memberCode: z.string().trim().regex(/^(BLU-[0-9]{1,12}|CARD-[0-9]{1,95})$/), recipientGroup }).strict();
const previewResult = z.object({ definitionId: id, definitionTitle: z.string(), memberCode, fullName: z.string(), recipientGroup, durationDays: z.number().int().min(1).max(3660), packageExpiresAt: expiry, proof: grantProof });
const campaign = z.object({
  title: z.string().trim().min(1).max(120), campaignCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/),
  campaignKind: z.enum(["FRIEND_PASS", "EXTRA_DAYS", "GIFT", "FREEBIE", "OTHER"]), description: z.string().trim().min(1).max(500),
  usesPerCoupon: z.number().int().min(1).max(100), bonusDays: z.number().int().min(0).max(365),
  perMember: z.number().int().min(1).max(100), total: z.number().int().min(1).max(1000000),
  activationDurationMinutes: z.number().int().min(0).max(2147483647).nullable(), expiresAt: expiry,
}).strict().refine(p => p.total >= p.perMember && (p.campaignKind === "EXTRA_DAYS" ? p.usesPerCoupon === 1 && p.bonusDays > 0 : p.bonusDays === 0));
const payloads = {
  create,
  "create-campaign": campaign,
  deactivate: z.object({ definitionId: id }).strict(),
  "grant-preview": grantPreview,
  grant: z.object({ definitionId: id, memberCode, recipientGroup, proof: grantProof }).strict(),
  cancel: z.object({ assignmentId: id }).strict(),
  consume: z.object({ couponId: id, guestReference: z.string().trim().max(120).default("") }).strict(),
};
export function benefitPayload(action: string, body: Record<string, unknown>) {
  if (action === "grant-preview") {
    const parsed = grantPreview.safeParse(body);
    return parsed.success ? parsed.data : null;
  }
  const schema = payloads[action as keyof typeof payloads];
  if (!schema) return null;
  const { requestKey: ignored, ...input } = body;
  void ignored;
  const parsed = schema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

const definitionFields = ["id", "kind", "title", "coupon_type", "quota", "bonus_days", "code", "discount_type", "discount_value", "min_satang", "max_discount_satang", "usage_limit", "expires_at", "active", "created_by", "created_at", "requires_activation", "activation_duration_minutes", "campaign_code", "campaign_kind", "campaign_description", "campaign_per_member", "campaign_total", "campaign_issued", "checkout_unit", "checkout_value", "checkout_cap"];
const assignmentFields = ["id", "definition_id", "member_id", "coupon_id", "cancelled_at", "granted_by", "created_at", "member_code", "full_name", "type", "title", "status", "used_count", "total_quota", "expire_date"];
const couponFields = ["id", "member_id", "type", "source", "title", "status", "total_quota", "used_count", "bonus_days_value", "created_at", "expire_date", "member_code", "full_name", "campaign_expires_at", "activated_at", "activation_status"];

function pickScalars(value: unknown, fields: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  return Object.fromEntries(fields.filter(field => Object.hasOwn(row, field) && (row[field] === null || ["string", "number", "boolean"].includes(typeof row[field]))).map(field => [field, row[field]]));
}

function pickDefinition(value: unknown) {
  const row = pickScalars(value, definitionFields);
  if (row.kind === "PROMO" && value && typeof value === "object") {
    Object.assign(row, pickScalars(value, ["max_discount_satang", "promo_description", "promo_recipient_limit"]));
    const source = value as Record<string, unknown>;
    if (source.max_satang === null || promoSubtotal.safeParse(source.max_satang).success) row.max_satang = source.max_satang;
    const ids = eligiblePackages.nullable().safeParse(source.eligible_package_ids);
    if (ids.success) row.eligible_package_ids = ids.data;
  }
  return row;
}

function responseForRole(value: unknown, role: string, action: string) {
  if (role === "OWNER") return value;
  if (action === "list") {
    const data = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const rows = (field: string, fields: string[]) => Array.isArray(data[field]) ? data[field].map(row => pickScalars(row, fields)) : [];
    // Keep the caller's array contract without exposing payment history or opaque audit JSON.
    return { definitions: Array.isArray(data.definitions) ? data.definitions.map(pickDefinition) : [], assignments: rows("assignments", assignmentFields), coupons: rows("coupons", couponFields), promoOrders: [], audit: [],
      ...(data.couponActivationReady === true ? { couponActivationReady: true } : {}),
      ...(data.grantTargetingReady === true ? { grantTargetingReady: true } : {}),
      ...(data.couponCampaignReady === true ? { couponCampaignReady: true } : {}),
      ...(data.checkoutCampaignReady === true ? { checkoutCampaignReady: true } : {}) };
  }
  if (action === "create" || action === "create-campaign") return pickDefinition(value);
  const fields: Record<string, string[]> = {
    deactivate: ["definitionId", "active"],
    grant: assignmentFields,
    cancel: ["assignmentId", "cancelled"],
    consume: ["couponId", "usedCount", "status", "membershipExpiresAt"],
  };
  return pickScalars(value, fields[action] ?? []);
}

async function execute(action: string, key: string | null, payload: object) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !process.env.DATABASE_URL) throw Error("Session/database unavailable");
  const digest = createHash("sha256").update(token).digest("hex");
  const sql = neon(process.env.DATABASE_URL);
  for (let attempt = 0; ; attempt++) {
    try {
      if (action === "list" && process.env.R6_CHECKOUT_COUPONS_ENABLED === "true") {
        const [row] = await sql`SELECT real_benefits_admin_action(${digest}, 'list', NULL, '{}'::jsonb) AS result,
          to_regprocedure('public.r6_create_checkout_coupon_order(uuid,integer,text,uuid,jsonb,jsonb)') IS NOT NULL AS checkout_installed`;
        return { ...row.result, checkoutCampaignReady: row.checkout_installed === true };
      }
      const rows = action === "create_r6_promo"
        ? await sql`SELECT r6_create_scoped_promo(${digest}, ${key}::uuid, ${JSON.stringify(payload)}::jsonb) AS result`
        : await sql`SELECT real_benefits_admin_action(${digest}, ${action}, ${key}::uuid, ${JSON.stringify(payload)}::jsonb) AS result`;
      return rows[0].result;
    } catch (error) {
      if (attempt >= 2 || !["40001", "40P01"].includes((error as { code?: string }).code ?? "")) throw error;
    }
  }
}

export async function benefitsAdminAction(request: Request, action: string) {
  if (action !== "list" && !Object.hasOwn(payloads, action)) return json({ error: "ไม่พบคำสั่ง" }, 404);
  if (request.method !== (action === "list" ? "GET" : "POST")) return json({ error: "Method not allowed" }, 405);
  try {
    const member = await getCurrentMember();
    if (!member || member.status === "SUSPENDED") return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (!["ADMIN", "OWNER"].includes(member.role)) return json({ error: "ไม่มีสิทธิ์" }, 403);
    if (action === "list") return json({ data: responseForRole(await execute(action, null, {}), member.role, action) });
    const body = await readBody(request);
    if (!body) return json({ error: "ต้องระบุ JSON" }, 400);
    const payload = benefitPayload(action, body);
    if (!payload) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    if (action === "grant-preview") {
      return json({ data: previewResult.parse(await execute("grant_preview", null, payload)) });
    }
    if (!z.uuid().safeParse(body.requestKey).success) return json({ error: "ต้องระบุ requestKey UUID" }, 400);
    const sqlAction = action === "create-campaign" ? "create_r6_campaign" : action === "grant" ? "grant_targeted"
      : action === "create" && ["maxSatang", "eligiblePackageIds", "promoDescription", "promoRecipientLimit"].some(field => Object.hasOwn(payload, field)) ? "create_r6_promo"
      : action === "create" && Object.hasOwn(payload, "activationDurationMinutes") ? "create_r6_coupon" : action;
    return json({ data: responseForRole(await execute(sqlAction, String(body.requestKey).toLowerCase(), payload), member.role, action) });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "ต้องใช้เซสชันปกติ ADMIN/OWNER" }, 403);
    if (code === "P6001") return json({ error: "โควตาจำนวนผู้รับหรือจำนวนใบของแคมเปญเต็มแล้ว" }, 409);
    if (["22023", "22007", "22003", "23514", "23505", "P0001"].includes(code ?? "")) return json({ error: "ทำรายการไม่ได้: สิทธิ์หมดอายุ/ถูกใช้/ถูกจอง/ข้อมูลซ้ำ หรือสมาชิกไม่เข้าเงื่อนไข กรุณาโหลดใหม่" }, 409);
    console.error("[benefits-admin] operation failed", { code: code ?? "unknown" });
    return json({ error: "ยังยืนยันผลไม่ได้ ให้ลองคำขอเดิมอีกครั้ง (อาจยังไม่ได้ติดตั้ง migration)" }, 503);
  }
}
