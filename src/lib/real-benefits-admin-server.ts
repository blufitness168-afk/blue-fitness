import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, readBody } from "./auth/http";

const id = z.number().int().min(1).max(2147483647);
const expiry = z.iso.datetime({ offset: true });
const create = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("COUPON"), title: z.string().trim().min(1).max(120), couponType: z.enum(["FRIEND_PASS", "EXTRA_DAYS"]), quota: z.number().int().min(1).max(100), bonusDays: z.number().int().min(0).max(365), expiresAt: expiry }).strict().refine(p => p.couponType === "EXTRA_DAYS" ? p.quota === 1 && p.bonusDays > 0 : p.bonusDays === 0),
  z.object({ kind: z.literal("PROMO"), title: z.string().trim().min(1).max(120), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/), discountType: z.enum(["FIXED", "PERCENT"]), discountValue: z.number().int().min(1).max(100000000), minSatang: z.number().int().min(0).max(100000000), maxDiscountSatang: z.number().int().min(1).max(100000000).nullable(), usageLimit: z.number().int().min(1).max(1000000), expiresAt: expiry }).strict().refine(p => p.discountType !== "PERCENT" || p.discountValue <= 100),
]);
const payloads = {
  create,
  deactivate: z.object({ definitionId: id }).strict(),
  grant: z.object({ definitionId: id, memberCode: z.string().trim().min(1).max(50) }).strict(),
  cancel: z.object({ assignmentId: id }).strict(),
  consume: z.object({ couponId: id, guestReference: z.string().trim().max(120).default("") }).strict(),
};
export function benefitPayload(action: string, body: Record<string, unknown>) {
  const schema = payloads[action as keyof typeof payloads];
  if (!schema) return null;
  const { requestKey: ignored, ...input } = body;
  void ignored;
  const parsed = schema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

const definitionFields = ["id", "kind", "title", "coupon_type", "quota", "bonus_days", "code", "discount_type", "discount_value", "min_satang", "max_discount_satang", "usage_limit", "expires_at", "active", "created_by", "created_at"];
const assignmentFields = ["id", "definition_id", "member_id", "coupon_id", "cancelled_at", "granted_by", "created_at", "member_code", "full_name", "type", "title", "status", "used_count", "total_quota", "expire_date"];
const couponFields = ["id", "member_id", "type", "source", "title", "status", "total_quota", "used_count", "bonus_days_value", "created_at", "expire_date", "member_code", "full_name"];

function pickScalars(value: unknown, fields: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  return Object.fromEntries(fields.filter(field => Object.hasOwn(row, field) && (row[field] === null || ["string", "number", "boolean"].includes(typeof row[field]))).map(field => [field, row[field]]));
}

function responseForRole(value: unknown, role: string, action: string) {
  if (role === "OWNER") return value;
  if (action === "list") {
    const data = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const rows = (field: string, fields: string[]) => Array.isArray(data[field]) ? data[field].map(row => pickScalars(row, fields)) : [];
    // Keep the caller's array contract without exposing payment history or opaque audit JSON.
    return { definitions: rows("definitions", definitionFields), assignments: rows("assignments", assignmentFields), coupons: rows("coupons", couponFields), promoOrders: [], audit: [] };
  }
  const fields: Record<string, string[]> = {
    create: definitionFields,
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
      const rows = await sql`SELECT real_benefits_admin_action(${digest}, ${action}, ${key}::uuid, ${JSON.stringify(payload)}::jsonb) AS result`;
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
    if (!body || !z.uuid().safeParse(body.requestKey).success) return json({ error: "ต้องระบุ JSON และ requestKey UUID" }, 400);
    const payload = benefitPayload(action, body);
    if (!payload) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    return json({ data: responseForRole(await execute(action, String(body.requestKey).toLowerCase(), payload), member.role, action) });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "ต้องใช้เซสชันปกติ ADMIN/OWNER" }, 403);
    if (["22023", "22007", "23514", "23505", "P0001"].includes(code ?? "")) return json({ error: "ทำรายการไม่ได้: สิทธิ์หมดอายุ/ถูกใช้/ถูกจอง/ข้อมูลซ้ำ หรือสมาชิกไม่เข้าเงื่อนไข กรุณาโหลดใหม่" }, 409);
    console.error("[benefits-admin] operation failed", { code: code ?? "unknown" });
    return json({ error: "ยังยืนยันผลไม่ได้ ให้ลองคำขอเดิมอีกครั้ง (อาจยังไม่ได้ติดตั้ง migration)" }, 503);
  }
}
