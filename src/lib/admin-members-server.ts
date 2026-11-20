import "server-only";
import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./auth/server";
import { requireAdminPage } from "./admin-permissions-server";
import { onlineCancellationReads } from "./online-cancellation-rollout-server";
import { staffPaidReadsEnabled } from "./staff-paid-rollout-server";

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
export interface CheckinRow { id: number; checkinTime: string; scannerType: string; }
export interface CouponRow {
  id: number; title: string; type: string; status: string;
  totalQuota: number; usedCount: number; expireDate: string | null;
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
export async function getAdminMembers(query = "", pageInput = "1") {
  const { sql, fragment, callerRole } = await memberReader();
  const expiry = staffPaidReadsEnabled() ? fragment`COALESCE(r4_staff_private.paid_active_expiry(id, now()), expire_date)` : fragment`expire_date`;
  const q = query.trim().slice(0, 100);
  // Escape LIKE metacharacters so search terms are literal, not wildcard expressions.
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const [count] = await sql`SELECT count(*)::int AS total FROM members WHERE full_name ILIKE ${pattern} OR member_code ILIKE ${pattern} OR phone ILIKE ${pattern}`;
  if (!count) throw new Error("Forbidden");
  const total = Number(count.total);
  const pages = Math.max(1, Math.ceil(total / 50));
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(Number(pageInput)) ? Number(pageInput) : 1));
  const rows = await sql`SELECT member_code AS "memberCode", full_name AS "fullName", nickname, phone, gender, role, status,
    ${expiry} AS "expireDate", created_at AS "createdAt", points FROM members
    WHERE full_name ILIKE ${pattern} OR member_code ILIKE ${pattern} OR phone ILIKE ${pattern}
    ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`;
  return { members: rows.map(memberProfile), callerRole, total, page, pages, query: q, asOf: Date.now() };
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
  const onlineReads = await onlineCancellationReads(fragment);
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
    sql`SELECT id, checkin_time AS "checkinTime", scanner_type AS "scannerType" FROM checkins
      WHERE member_id = ${member.id} ORDER BY checkin_time DESC, id DESC LIMIT 101 OFFSET ${(pages.checkins - 1) * 100}`,
    sql`SELECT id, title, type, status, total_quota AS "totalQuota", used_count AS "usedCount", expire_date AS "expireDate"
      FROM coupons WHERE member_id = ${member.id} ORDER BY created_at DESC, id DESC LIMIT 101 OFFSET ${(pages.coupons - 1) * 100}`,
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
    checkins: historyResult(checkins.map(row => ({ id: row.id, checkinTime: row.checkinTime, scannerType: row.scannerType })) as CheckinRow[], pages.checkins),
    coupons: historyResult(coupons.map(row => ({ id: row.id, title: row.title, type: row.type, status: row.status,
      totalQuota: row.totalQuota, usedCount: row.usedCount, expireDate: row.expireDate })) as CouponRow[], pages.coupons), asOf: Date.now() };
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
