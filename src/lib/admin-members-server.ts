import "server-only";
import { neon } from "@neondatabase/serverless";
import { requireAdminPage } from "./admin-permissions-server";

export interface MemberRow {
  memberCode: string; fullName: string; nickname: string | null; phone: string;
  gender: string; role: string; status: string; expireDate: string | null;
  createdAt: string; points: number;
}
export interface OrderRow {
  id: string; packageName: string; amountSatang: number; status: string;
  createdAt: string; paidAt: string | null; membershipExpiresAt: string | null;
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
  await requireAdminPage("/admin/members");
  const sql = client();
  const q = query.trim().slice(0, 100);
  // Escape LIKE metacharacters so search terms are literal, not wildcard expressions.
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const [count] = await sql`SELECT count(*)::int AS total FROM members WHERE full_name ILIKE ${pattern} OR member_code ILIKE ${pattern} OR phone ILIKE ${pattern}`;
  const total = Number(count.total);
  const pages = Math.max(1, Math.ceil(total / 50));
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(Number(pageInput)) ? Number(pageInput) : 1));
  const rows = await sql`SELECT member_code AS "memberCode", full_name AS "fullName", nickname, phone, gender, role, status,
    expire_date AS "expireDate", created_at AS "createdAt", points FROM members
    WHERE full_name ILIKE ${pattern} OR member_code ILIKE ${pattern} OR phone ILIKE ${pattern}
    ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`;
  return { members: rows as MemberRow[], total, page, pages, query: q, asOf: Date.now() };
}
export async function getAdminMember(memberCode: string) {
  await requireAdminPage("/admin/members");
  const sql = client();
  const [member] = await sql`SELECT id, member_code AS "memberCode", full_name AS "fullName", nickname, phone, gender, role, status,
    expire_date AS "expireDate", created_at AS "createdAt", points, birth_day AS "birthDay", birth_month AS "birthMonth",
    emergency_name AS "emergencyName", emergency_phone AS "emergencyPhone", emergency_relation AS "emergencyRelation"
    FROM members WHERE member_code = ${memberCode} LIMIT 1`;
  if (!member) return null;
  const [orders, checkins, coupons] = await Promise.all([
    sql`SELECT id, package_snapshot->>'name' AS "packageName", amount_satang AS "amountSatang", status,
      created_at AS "createdAt", paid_at AS "paidAt", membership_expires_at AS "membershipExpiresAt"
      FROM package_payment_orders WHERE member_id = ${member.id} ORDER BY created_at DESC, id DESC LIMIT 100`,
    sql`SELECT id, checkin_time AS "checkinTime", scanner_type AS "scannerType" FROM checkins
      WHERE member_id = ${member.id} ORDER BY checkin_time DESC, id DESC LIMIT 100`,
    sql`SELECT id, title, type, status, total_quota AS "totalQuota", used_count AS "usedCount", expire_date AS "expireDate"
      FROM coupons WHERE member_id = ${member.id} ORDER BY created_at DESC, id DESC LIMIT 100`,
  ]);
  // Never serialize the internal ID, authentication fields or payment verification payloads.
  const { id: internalId, ...profile } = member;
  void internalId;
  return { member: profile as unknown as MemberDetail, orders: orders as OrderRow[], checkins: checkins as CheckinRow[], coupons: coupons as CouponRow[], asOf: Date.now() };
}
export async function getAdminDashboard(monthInput?: string) {
  await requireAdminPage("/admin");
  const sql = client();
  const range = monthRange(monthInput);
  const [summary, sales, visits, expiring] = await Promise.all([
    sql`SELECT
      (SELECT count(*)::int FROM members) AS "totalMembers",
      (SELECT count(*)::int FROM members WHERE status = 'ACTIVE' AND expire_date > now()) AS "activeMembers",
      (SELECT count(*)::int FROM members WHERE created_at >= ${range.start}::timestamptz AND created_at < ${range.end}::timestamptz) AS "newMembers",
      (SELECT count(*)::int FROM checkins WHERE checkin_time >= ${range.start}::timestamptz AND checkin_time < ${range.end}::timestamptz) AS "checkins",
      (SELECT count(*)::int FROM package_payment_orders WHERE status = 'PAID' AND paid_at >= ${range.start}::timestamptz AND paid_at < ${range.end}::timestamptz) AS "paidOrders",
      (SELECT coalesce(sum(amount_satang), 0)::text FROM package_payment_orders WHERE status = 'PAID' AND paid_at >= ${range.start}::timestamptz AND paid_at < ${range.end}::timestamptz) AS "paidSatang"`,
    sql`SELECT o.id, m.member_code AS "memberCode", m.full_name AS "fullName", o.package_snapshot->>'name' AS "packageName",
      o.amount_satang AS "amountSatang", o.paid_at AS "paidAt" FROM package_payment_orders o JOIN members m ON m.id = o.member_id
      WHERE o.status = 'PAID' AND o.paid_at >= ${range.start}::timestamptz AND o.paid_at < ${range.end}::timestamptz ORDER BY o.paid_at DESC, o.id DESC LIMIT 10`,
    sql`SELECT c.id, m.member_code AS "memberCode", m.full_name AS "fullName", c.checkin_time AS "checkinTime"
      FROM checkins c JOIN members m ON m.id = c.member_id
      WHERE c.checkin_time >= ${range.start}::timestamptz AND c.checkin_time < ${range.end}::timestamptz ORDER BY c.checkin_time DESC, c.id DESC LIMIT 10`,
    sql`SELECT member_code AS "memberCode", full_name AS "fullName", expire_date AS "expireDate" FROM members
      WHERE status = 'ACTIVE' AND expire_date > now() AND expire_date <= now() + interval '7 days' ORDER BY expire_date, id LIMIT 10`,
  ]);
  return {
    month: range.month,
    summary: summary[0] as { totalMembers: number; activeMembers: number; newMembers: number; checkins: number; paidOrders: number; paidSatang: string },
    sales: sales as { id: string; memberCode: string; fullName: string; packageName: string | null; amountSatang: number; paidAt: string }[],
    visits: visits as { id: number; memberCode: string; fullName: string; checkinTime: string }[],
    expiring: expiring as { memberCode: string; fullName: string; expireDate: string }[],
  };
}
