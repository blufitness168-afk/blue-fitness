import "server-only";
import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./auth/server";
import { requireAdminPage } from "./admin-permissions-server";
import { onlineCancellationReads } from "./online-cancellation-rollout-server";
import { staffPaidReadsEnabled } from "./staff-paid-rollout-server";
import { packageCatalogDailySlot } from "./package-catalog";

export interface MemberRow {
  memberCode: string; fullName: string; nickname: string | null; phone: string;
  gender: string; role: string; status: string; expireDate: string | null;
  createdAt: string; points: number;
}
export interface OrderRow {
  id: string; packageName: string; amountSatang?: number | null; status: string;
  timeSlot: string | null; membershipStartsAt: string | null;
  createdAt: string; paidAt?: string | null; membershipExpiresAt: string | null; cancelledAt: string | null;
}
export interface CheckinRow {
  id: number; checkinTime: string; scannerType: string;
  packageName: string | null; usedTimeSlot: string | null;
}
export interface CouponRow {
  id: number; title: string; type: string; status: string;
  totalQuota: number; usedCount: number; expireDate: string | null;
  lastRecordedUsedAt: string | null;
}
export interface MemberDetail extends MemberRow {
  birthDay: number | null; birthMonth: number | null;
  emergencyName: string | null; emergencyPhone: string | null; emergencyRelation: string | null;
}
// Bind each read to the same persisted role and normal session as the page guard.
async function memberReader(path = "/admin/members") {
  const caller = await requireAdminPage(path);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !["ADMIN", "OWNER"].includes(caller.role)) throw new Error("Forbidden");
  const digest = createHash("sha256").update(token).digest("hex");
  const database = client();
  const sql = (parts: TemplateStringsArray, ...values: unknown[]) => {
    const prefix = `WITH authorized AS (SELECT 1 FROM auth_sessions s JOIN members actor ON actor.id = s.member_id
      WHERE s.token_hash = `;
    const strings = [prefix, ` AND actor.id = `, ` AND actor.role::text = `,
      ` AND actor.role IN ('ADMIN', 'OWNER') AND actor.status <> 'SUSPENDED'
      AND s.revoked_at IS NULL AND s.expires_at > now() AND s.mode = 'NORMAL')
      SELECT result.* FROM authorized CROSS JOIN LATERAL (${parts[0]}`, ...parts.slice(1)];
    strings[strings.length - 1] += ") AS result";
    return database(Object.assign(strings, { raw: strings.slice() }) as unknown as TemplateStringsArray, digest, caller.id, caller.role, ...values);
  };
  return { sql, fragment: database, callerRole: caller.role };
}
function memberProfile(row: Record<string, unknown>): MemberRow {
  return { memberCode: row.memberCode, fullName: row.fullName, nickname: row.nickname, phone: row.phone,
    gender: row.gender, role: row.role, status: row.status, expireDate: row.expireDate,
    createdAt: row.createdAt, points: row.points } as MemberRow;
}
function client() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
  return neon(process.env.DATABASE_URL);
}
export function currentStatus(member: Pick<MemberRow, "status" | "expireDate">, now = Date.now()) {
  if (member.status === "SUSPENDED") return "SUSPENDED";
  if (member.expireDate && Date.parse(member.expireDate) <= now) return "EXPIRED";
  return member.status;
}
export function monthRange(input?: string, now = new Date()) {
  const month = input && /^\d{4}-(0[1-9]|1[0-2])$/.test(input) && Number(input.slice(0, 4)) >= 2000 && Number(input.slice(0, 4)) <= 9998
    ? input : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" }).format(now);
  const [year, number] = month.split("-").map(Number);
  return { month, start: `${month}-01T00:00:00+07:00`, end: `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, "0")}-01T00:00:00+07:00` };
}
export const memberListGenders = { MALE: "ชาย", FEMALE: "หญิง", OTHER: "อื่น ๆ" } as const;
type MemberListFilters = Record<"q" | "name" | "gender" | "code" | "phone" | "from" | "to" | "month" | "packageLabel" | "slot", string>;
export type MemberListInput = Partial<Record<keyof MemberListFilters | "page", string | string[]>>;

function validMemberListDay(day: string) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(day)) return false;
  const timestamp = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day;
}

function memberListFilters(input: MemberListInput) {
  let invalid = false;
  const text = (key: keyof MemberListFilters, limit: number) => {
    const value = input[key];
    if (Array.isArray(value) && key !== "q") invalid = true;
    return typeof value === "string" ? value.trim().slice(0, limit) : "";
  };
  const checked = (key: keyof MemberListFilters, validate: (value: string) => boolean) => {
    const value = input[key];
    if (value === undefined || value === "") return "";
    if (typeof value === "string" && validate(value)) return value;
    invalid = true;
    return "";
  };
  const filters: MemberListFilters = {
    q: text("q", 100), name: text("name", 100), code: text("code", 50), phone: text("phone", 20),
    gender: checked("gender", value => Object.hasOwn(memberListGenders, value)),
    from: checked("from", validMemberListDay), to: checked("to", validMemberListDay),
    month: checked("month", value => /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)),
    packageLabel: text("packageLabel", 100), slot: checked("slot", value => !!packageCatalogDailySlot(value)),
  };
  if (filters.from && filters.to && filters.from > filters.to) invalid = true;
  return { filters, invalid };
}

export async function getAdminMembers(input: MemberListInput = {}) {
  const { sql, fragment, callerRole } = await memberReader();
  const expiry = staffPaidReadsEnabled() ? fragment`COALESCE(r4_staff_private.paid_active_expiry(id, now()), expire_date)` : fragment`expire_date`;
  const { filters, invalid } = memberListFilters(input);
  const { q, name, code, phone, gender, from, to, month, packageLabel, slot } = filters;
  const literal = (value: string) => value.replace(/[\\%_]/g, "\\$&");
  const contains = (value: string) => `%${literal(value)}%`;
  const pattern = contains(q);
  const monthStart = `${month}-01`;
  // Historical evidence only: PAID snapshots are immutable even if later refunded.
  const purchase = packageLabel || slot ? fragment`AND EXISTS (
    SELECT 1 FROM package_payment_orders o WHERE o.member_id = members.id AND o.status = 'PAID'
    ${packageLabel ? fragment`AND o.package_snapshot->>'label' ILIKE ${literal(packageLabel)}` : fragment``}
    ${slot ? fragment`AND o.package_snapshot->>'timeSlot' = ${slot}` : fragment``}
  )` : fragment``;
  const where = fragment`(full_name ILIKE ${pattern} OR member_code ILIKE ${pattern} OR phone ILIKE ${pattern})
    ${name ? fragment`AND full_name ILIKE ${contains(name)}` : fragment``}
    ${code ? fragment`AND member_code ILIKE ${contains(code)}` : fragment``}
    ${phone ? fragment`AND phone ILIKE ${contains(phone)}` : fragment``}
    ${gender ? fragment`AND gender = ${gender}::profile_gender` : fragment``}
    ${from ? fragment`AND created_at >= (${from}::date::timestamp AT TIME ZONE 'Asia/Bangkok')` : fragment``}
    ${to ? fragment`AND created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')` : fragment``}
    ${month ? fragment`AND created_at >= (${monthStart}::date::timestamp AT TIME ZONE 'Asia/Bangkok')
      AND created_at < ((${monthStart}::date + interval '1 month') AT TIME ZONE 'Asia/Bangkok')` : fragment``}
    ${purchase} ${invalid ? fragment`AND FALSE` : fragment``}`;
  const [count] = await sql`WITH monthly AS (
    SELECT to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') AS month, count(*)::int AS total
    FROM members WHERE ${where} GROUP BY 1
  ) SELECT coalesce(sum(total), 0)::int AS total,
    (SELECT coalesce(json_agg(json_build_object('month', month, 'total', total) ORDER BY month DESC), '[]'::json)
      FROM (SELECT month, total FROM monthly ORDER BY month DESC LIMIT 12) recent) AS monthly
    FROM monthly`;
  if (!count) throw new Error("Forbidden");
  const total = Number(count.total);
  const pages = Math.max(1, Math.ceil(total / 50));
  const pageInput = typeof input.page === "string" ? Number(input.page) : 1;
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(pageInput) ? pageInput : 1));
  const rows = await sql`SELECT member_code AS "memberCode", full_name AS "fullName", nickname, phone, gender, role, status,
    ${expiry} AS "expireDate", created_at AS "createdAt", points FROM members
    WHERE ${where}
    ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`;
  const monthly = (count.monthly as { month: string; total: number }[] | undefined ?? []).map(({ month, total }) => ({ month, total }));
  return { members: rows.map(memberProfile), callerRole, total, page, pages, filters, invalid, monthly, asOf: Date.now() };
}
export type MemberHistoryInput = { ordersPage?: string | string[]; checkinsPage?: string | string[]; couponsPage?: string | string[] };
export function historyPage(input?: string | string[]) {
  const page = typeof input === "string" && /^[1-9]\d{0,13}$/.test(input) ? Number(input) : 1;
  return Number.isSafeInteger(page * 100) ? page : 1;
}
function historyResult<T>(rows: T[], page: number) {
  return { rows: rows.slice(0, 100), page, hasNext: rows.length > 100 };
}
export async function getAdminMember(memberCode: string, input: MemberHistoryInput = {}) {
  const { sql, fragment, callerRole } = await memberReader();
  const r4Reads = staffPaidReadsEnabled();
  const expiry = r4Reads ? fragment`COALESCE(r4_staff_private.paid_active_expiry(id, now()), expire_date)` : fragment`expire_date`;
  const [member] = await sql`SELECT id, member_code AS "memberCode", full_name AS "fullName", nickname, phone, gender, role, status,
    ${expiry} AS "expireDate", created_at AS "createdAt", points, birth_day AS "birthDay", birth_month AS "birthMonth",
    emergency_name AS "emergencyName", emergency_phone AS "emergencyPhone", emergency_relation AS "emergencyRelation"
    FROM members WHERE member_code = ${memberCode} LIMIT 1`;
  if (!member) return null;
  const [onlineReads, [historySources]] = await Promise.all([
    onlineCancellationReads(fragment),
    sql`SELECT to_regclass('public.r7_visits') IS NOT NULL AS visits,
      to_regclass('public.benefit_consumptions') IS NOT NULL AS consumptions,
      to_regclass('public.time_supplement_activations') IS NOT NULL AS supplements`,
  ]);
  // Do not mention an absent relation in SQL; errors from installed sources must surface.
  const visitSnapshot = historySources?.visits ? fragment`
    CASE WHEN jsonb_typeof(v.snapshot #> '{package,name}') = 'string' THEN NULLIF(btrim(v.snapshot #>> '{package,name}'), '') END AS "packageName",
    CASE WHEN jsonb_typeof(v.snapshot->'usedTimeSlot') = 'string' THEN NULLIF(btrim(v.snapshot->>'usedTimeSlot'), '') END AS "usedTimeSlot"`
    : fragment`NULL::text AS "packageName", NULL::text AS "usedTimeSlot"`;
  const visitJoin = historySources?.visits ? fragment`LEFT JOIN public.r7_visits v ON v.checkin_id = c.id AND v.member_id = c.member_id` : fragment``;
  // These timestamps come from writers that record the coupon ID in the same transaction as consumption.
  // A campaign activation alone is not consumption, and legacy checkin notes are not used as evidence.
  const recordedConsumption = historySources?.consumptions ? fragment`(
    SELECT max(b.created_at) FROM public.benefit_consumptions b WHERE b.coupon_id = c.id AND b.member_id = c.member_id
  )` : fragment`NULL::timestamptz`;
  const supplementUse = historySources?.supplements ? fragment`(
    SELECT a.activated_at FROM public.time_supplement_activations a
    WHERE a.coupon_id = c.id AND a.member_id = c.member_id AND c.type = 'CUSTOM' AND c.source = 'TIME_SUPPLEMENT:' || c.id
  )` : fragment`NULL::timestamptz`;
  const welcomeUse = historySources?.visits ? fragment`(
    SELECT min(v.entered_at) FROM public.r7_visits v
    WHERE v.member_id = c.member_id AND c.type = 'FREE_ENTRY' AND c.source = 'WELCOME_REGISTRATION'
      AND v.snapshot->>'reason' = 'FREE_ENTRY' AND v.snapshot->'welcomeCouponId' = to_jsonb(c.id)
    HAVING count(*) = 1
  )` : fragment`NULL::timestamptz`;
  // The staff view needs only the cancellation date. Neither projection reads refund money.
  const onlineHistorySource = onlineReads ? fragment`package_payment_orders o LEFT JOIN (
    SELECT order_id, cancelled_at FROM r4_online_private.cancellations
  ) c ON c.order_id = o.id` : fragment`package_payment_orders`;
  const pages = { orders: historyPage(input.ordersPage), checkins: historyPage(input.checkinsPage), coupons: historyPage(input.couponsPage) };
  const [orders, checkins, coupons] = await Promise.all([
    callerRole === "OWNER"
      ? sql`SELECT id, "packageName", "timeSlot", "amountSatang", status, "createdAt", "paidAt", "membershipStartsAt", "membershipExpiresAt", "cancelledAt" FROM (
        SELECT id::text AS id, package_snapshot->>'name' AS "packageName", package_snapshot->>'timeSlot' AS "timeSlot",
          amount_satang AS "amountSatang", status::text AS status, created_at AS "createdAt", paid_at AS "paidAt",
          NULL::timestamptz AS "membershipStartsAt", membership_expires_at AS "membershipExpiresAt", ${onlineReads ? fragment`c.cancelled_at` : fragment`NULL::timestamptz`} AS "cancelledAt"
        FROM ${onlineHistorySource} WHERE member_id = ${member.id}
        ${r4Reads ? fragment`UNION ALL
        SELECT 'staff-transfer:' || sale_id, package_name, daily_slot, amount_satang, 'STAFF_TRANSFER', recorded_at, occurred_at, starts_at, ends_at, cancelled_at
        FROM r4_staff_private.paid_history WHERE member_id = ${member.id}` : fragment``}
      ) history ORDER BY "createdAt" DESC, id DESC LIMIT 101 OFFSET ${(pages.orders - 1) * 100}`
      : sql`SELECT id, "packageName", "timeSlot", status, "createdAt", "membershipStartsAt", "membershipExpiresAt", "cancelledAt" FROM (
        SELECT id::text AS id, package_snapshot->>'name' AS "packageName", package_snapshot->>'timeSlot' AS "timeSlot",
          status::text AS status, created_at AS "createdAt",
          NULL::timestamptz AS "membershipStartsAt", membership_expires_at AS "membershipExpiresAt", ${onlineReads ? fragment`c.cancelled_at` : fragment`NULL::timestamptz`} AS "cancelledAt"
        FROM ${onlineHistorySource} WHERE member_id = ${member.id}
        ${r4Reads ? fragment`UNION ALL
        SELECT 'staff-transfer:' || sale_id, package_name, daily_slot, 'STAFF_TRANSFER', recorded_at, starts_at, ends_at, cancelled_at
        FROM r4_staff_private.paid_history WHERE member_id = ${member.id}` : fragment``}
      ) history ORDER BY "createdAt" DESC, id DESC LIMIT 101 OFFSET ${(pages.orders - 1) * 100}`,
    sql`SELECT c.id, c.checkin_time AS "checkinTime", c.scanner_type AS "scannerType", ${visitSnapshot}
      FROM (SELECT id, member_id, checkin_time, scanner_type FROM checkins
        WHERE member_id = ${member.id} ORDER BY checkin_time DESC, id DESC LIMIT 101 OFFSET ${(pages.checkins - 1) * 100}) c
      ${visitJoin} ORDER BY c.checkin_time DESC, c.id DESC`,
    sql`SELECT c.id, c.title, c.type, c.status, c.total_quota AS "totalQuota", c.used_count AS "usedCount", c.expire_date AS "expireDate",
      CASE WHEN c.used_count > 0 THEN greatest(${recordedConsumption}, ${supplementUse}, ${welcomeUse}) END AS "lastRecordedUsedAt"
      FROM (SELECT id, member_id, title, type, status, total_quota, used_count, expire_date, created_at, source
        FROM coupons WHERE member_id = ${member.id} ORDER BY created_at DESC, id DESC LIMIT 101 OFFSET ${(pages.coupons - 1) * 100}) c
      ORDER BY c.created_at DESC, c.id DESC`,
  ]);
  // All payloads are allowlisted, independently of SQL projection and caller input.
  const profile: MemberDetail = { ...memberProfile(member), birthDay: member.birthDay, birthMonth: member.birthMonth,
    emergencyName: member.emergencyName, emergencyPhone: member.emergencyPhone, emergencyRelation: member.emergencyRelation };
  return { member: profile, callerRole,
    orders: historyResult(orders.map(row => ({ id: row.id, packageName: row.packageName, status: row.status,
      createdAt: row.createdAt, timeSlot: row.timeSlot ?? null,
      // Legacy orders do not record the actual entitlement start; do not infer it from payment time.
      membershipStartsAt: row.status === "STAFF_TRANSFER" ? row.membershipStartsAt : null,
      membershipExpiresAt: row.membershipExpiresAt,
      cancelledAt: row.status === "STAFF_TRANSFER" || (onlineReads && row.status === "PAID") ? row.cancelledAt ?? null : null,
      ...(callerRole === "OWNER" ? { amountSatang: row.amountSatang, paidAt: row.paidAt } : {})
    })) as OrderRow[], pages.orders),
    checkins: historyResult(checkins.map((row): CheckinRow => ({ id: row.id, checkinTime: row.checkinTime, scannerType: row.scannerType,
      packageName: row.packageName ?? null, usedTimeSlot: row.usedTimeSlot ?? null })), pages.checkins),
    coupons: historyResult(coupons.map((row): CouponRow => ({ id: row.id, title: row.title, type: row.type, status: row.status,
      totalQuota: row.totalQuota, usedCount: row.usedCount, expireDate: row.expireDate, lastRecordedUsedAt: row.lastRecordedUsedAt ?? null })), pages.coupons), asOf: Date.now() };
}
export async function getAdminDashboard(monthInput?: string) {
  const { sql, callerRole } = await memberReader("/admin");
  const range = monthRange(monthInput);
  const [summary, sales, visits, expiring] = await Promise.all([
    callerRole === "OWNER" ? sql`SELECT
      (SELECT count(*)::int FROM members) AS "totalMembers",
      (SELECT count(*)::int FROM members WHERE status = 'ACTIVE' AND expire_date > now()) AS "activeMembers",
      (SELECT count(*)::int FROM members WHERE created_at >= ${range.start}::timestamptz AND created_at < ${range.end}::timestamptz) AS "newMembers",
      (SELECT count(*)::int FROM checkins WHERE checkin_time >= ${range.start}::timestamptz AND checkin_time < ${range.end}::timestamptz) AS "checkins",
      (SELECT count(*)::int FROM package_payment_orders WHERE status = 'PAID' AND paid_at >= ${range.start}::timestamptz AND paid_at < ${range.end}::timestamptz) AS "paidOrders",
      (SELECT coalesce(sum(amount_satang), 0)::text FROM package_payment_orders WHERE status = 'PAID' AND paid_at >= ${range.start}::timestamptz AND paid_at < ${range.end}::timestamptz) AS "paidSatang"`
      : sql`SELECT
        (SELECT count(*)::int FROM members) AS "totalMembers",
        (SELECT count(*)::int FROM members WHERE status = 'ACTIVE' AND expire_date > now()) AS "activeMembers",
        (SELECT count(*)::int FROM members WHERE created_at >= ${range.start}::timestamptz AND created_at < ${range.end}::timestamptz) AS "newMembers",
        (SELECT count(*)::int FROM checkins WHERE checkin_time >= ${range.start}::timestamptz AND checkin_time < ${range.end}::timestamptz) AS "checkins"`,
    callerRole === "OWNER" ? sql`SELECT o.id, m.member_code AS "memberCode", m.full_name AS "fullName", o.package_snapshot->>'name' AS "packageName",
      o.amount_satang AS "amountSatang", o.paid_at AS "paidAt" FROM package_payment_orders o JOIN members m ON m.id = o.member_id
      WHERE o.status = 'PAID' AND o.paid_at >= ${range.start}::timestamptz AND o.paid_at < ${range.end}::timestamptz ORDER BY o.paid_at DESC, o.id DESC LIMIT 10` : Promise.resolve([]),
    sql`SELECT c.id, m.member_code AS "memberCode", m.full_name AS "fullName", c.checkin_time AS "checkinTime"
      FROM checkins c JOIN members m ON m.id = c.member_id
      WHERE c.checkin_time >= ${range.start}::timestamptz AND c.checkin_time < ${range.end}::timestamptz ORDER BY c.checkin_time DESC, c.id DESC LIMIT 10`,
    sql`SELECT member_code AS "memberCode", full_name AS "fullName", expire_date AS "expireDate" FROM members
      WHERE status = 'ACTIVE' AND expire_date > now() AND expire_date <= now() + interval '7 days' ORDER BY expire_date, id LIMIT 10`,
  ]);
  if (!summary[0]) throw new Error("Forbidden");
  const row = summary[0];
  const common = {
    month: range.month,
    summary: { totalMembers: Number(row.totalMembers), activeMembers: Number(row.activeMembers),
      newMembers: Number(row.newMembers), checkins: Number(row.checkins) },
    visits: visits.map(row => ({ id: Number(row.id), memberCode: String(row.memberCode), fullName: String(row.fullName), checkinTime: String(row.checkinTime) })),
    expiring: expiring.map(row => ({ memberCode: String(row.memberCode), fullName: String(row.fullName), expireDate: String(row.expireDate) })),
  };
  if (callerRole !== "OWNER") return { ...common, callerRole: "ADMIN" as const };
  return { ...common, callerRole: "OWNER" as const,
    summary: { ...common.summary, paidOrders: Number(row.paidOrders), paidSatang: String(row.paidSatang) },
    sales: sales.map(row => ({ id: String(row.id), memberCode: String(row.memberCode), fullName: String(row.fullName),
      packageName: row.packageName == null ? null : String(row.packageName), amountSatang: Number(row.amountSatang), paidAt: String(row.paidAt) })),
  };
}
