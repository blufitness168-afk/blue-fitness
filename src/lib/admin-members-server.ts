import "server-only";
import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { requireAdminPage } from "./admin-permissions-server";
import { onlineCancellationReads } from "./online-cancellation-rollout-server";
import { staffPaidReadsEnabled } from "./staff-paid-rollout-server";
import { packageCatalogDailySlot } from "./package-catalog";
import { readRealFinance } from "./real-finance-server";
import { XLSX_MAX_ROWS, XlsxLimitError } from "./xlsx";
import {
  computeDashboardFinanceSummary,
  computeDashboardMembershipMetrics,
  resolveDashboardPeriod,
  type DashboardMemberInput,
  type DashboardPeriodInput,
  type DashboardTermInput,
} from "./admin-dashboard-metrics";

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
  id: number; checkinTime: string; scannerType: string; exitedAt: string | null;
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
function createAuthorizedSql(caller: { id: number; role: string }, token: string) {
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
  return { sql, fragment: database };
}

type AuthorizedReader = ReturnType<typeof createAuthorizedSql>;

// Bind each read to the same persisted role and normal session as the page guard.
async function memberReader(path = "/admin/members") {
  const caller = await requireAdminPage(path);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !["ADMIN", "OWNER"].includes(caller.role)) throw new Error("Forbidden");
  const { sql, fragment } = createAuthorizedSql(caller, token);
  return { sql, fragment, callerRole: caller.role };
}

async function authorizedMemberSession() {
  const caller = await getCurrentMember();
  if (!caller || caller.status === "SUSPENDED") return { status: 401 as const, error: "กรุณาเข้าสู่ระบบ" };
  if (!["ADMIN", "OWNER"].includes(caller.role)) return { status: 403 as const, error: "ไม่มีสิทธิ์เข้าถึง" };
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return { status: 401 as const, error: "กรุณาเข้าสู่ระบบ" };
  const { sql, fragment } = createAuthorizedSql(caller, token);
  return { status: 200 as const, sql, fragment, callerRole: caller.role };
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
export const currentPackageDurations = { "1": "รายวัน", "30": "1 เดือน", "90": "3 เดือน", "180": "6 เดือน", "365": "12 เดือน" } as const;
type MemberListFilters = Record<"q" | "name" | "gender" | "code" | "phone" | "from" | "to" | "month" | "reportMonth" | "packageLabel" | "slot" | "currentDuration" | "currentSlot", string>;
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
    reportMonth: checked("reportMonth", value => /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)),
    packageLabel: text("packageLabel", 100), slot: checked("slot", value => !!packageCatalogDailySlot(value)),
    currentDuration: checked("currentDuration", value => Object.hasOwn(currentPackageDurations, value)),
    currentSlot: checked("currentSlot", value => !!packageCatalogDailySlot(value)),
  };
  if (filters.from && filters.to && filters.from > filters.to) invalid = true;
  return { filters, invalid };
}

async function buildMemberListQueryParts(
  sql: AuthorizedReader["sql"],
  fragment: AuthorizedReader["fragment"],
  filters: MemberListFilters,
  invalid: boolean,
  asOf: number,
  includeReport: boolean,
) {
  const { q, name, code, phone, gender, from, to, month, reportMonth, packageLabel, slot, currentDuration, currentSlot } = filters;
  const current = !!(currentDuration || currentSlot);
  const currentReport = includeReport && !!reportMonth && reportMonth === monthRange(undefined, new Date(asOf)).month;
  const instant = new Date(asOf).toISOString();
  let termJoin = fragment``;
  let currentUnavailable = false;
  let nearExpiryAvailable = false;
  if ((current || currentReport) && !invalid) {
    const [sources] = await sql`SELECT
      CASE WHEN p.oid IS NULL THEN 'absent'
        WHEN p.proretset AND p.prorettype = 'pg_catalog.record'::regtype
          AND p.proargmodes = ARRAY['i','i','t','t','t','t']::"char"[]
          AND p.proargnames[3:6] = ARRAY['order_id','sale_id','package_snapshot','main_end']
          AND p.proallargtypes[3:6] = ARRAY['pg_catalog.uuid'::regtype,'pg_catalog.uuid'::regtype,
            'pg_catalog.jsonb'::regtype,'pg_catalog.timestamptz'::regtype]::oid[] THEN 'combined'
        WHEN p.proretset AND p.prorettype = pg_catalog.to_regtype('public.package_payment_orders') AND p.proallargtypes IS NULL THEN 'standalone'
        ELSE 'unsupported' END AS term_contract,
      to_regprocedure('public.r3_override_current_order(integer,timestamptz)') IS NOT NULL AS standalone,
      to_regnamespace('r4_staff_private') IS NOT NULL AS staff_schema,
      to_regclass('r4_staff_private.free_sales') IS NOT NULL AS staff_sales,
      to_regprocedure('r4_staff_private.admission_term(integer,timestamptz,uuid)') IS NOT NULL AS staff_term,
      to_regclass('r4_online_private.active_paid_orders') IS NOT NULL AS online_active,
      to_regclass('r4_online_private.cancellations') IS NOT NULL AS online_cancellations
      FROM (SELECT pg_catalog.to_regprocedure('public.time_supplement_main(integer,timestamptz)') AS main_proc) f
      LEFT JOIN pg_catalog.pg_proc p ON p.oid = f.main_proc`;
    if (!sources) throw new Error("Forbidden");
    const combined = sources.term_contract === "combined";
    const legacy = sources.term_contract === "absent" || sources.term_contract === "standalone";
    const termAvailable = combined || (legacy && sources.standalone
      && (!(sources.staff_schema || sources.staff_sales || sources.staff_term || staffPaidReadsEnabled()) || (sources.staff_sales && sources.staff_term))
      && sources.online_active === sources.online_cancellations);
    currentUnavailable = current && !termAvailable;
    // Only the combined authority covers R4 sales, revocations and proven renewals.
    // It reads present member state, so it cannot be used for past/future report months.
    nearExpiryAvailable = currentReport && combined;
    if ((current && termAvailable) || nearExpiryAvailable) {
      let candidates;
      if (combined) {
        // The standalone supplement helper has the same inputs but returns orders. An empty combined result is authoritative.
        candidates = fragment`SELECT CASE WHEN (o.order_id IS NULL) <> (o.sale_id IS NULL)
            AND jsonb_typeof(o.package_snapshot->'durationDays') = 'number'
            THEN o.package_snapshot->>'durationDays' END AS duration, o.package_snapshot->>'timeSlot' AS daily_slot,
          o.main_end AS ends_at
        FROM public.time_supplement_main(members.id, ${instant}::timestamptz) o`;
      } else {
        const paid = sources.online_active ? fragment`r4_online_private.active_paid_orders` : fragment`public.package_payment_orders`;
        // Latest is only a routing input to R4, never proof of an online term.
        const staffTerm = sources.staff_term ? fragment`SELECT a.* FROM r4_staff_private.admission_term(members.id, ${instant}::timestamptz, (
          SELECT o.id FROM ${paid} o WHERE o.member_id = members.id AND o.status = 'PAID'
          ORDER BY o.paid_at DESC NULLS LAST, o.created_at DESC, o.id DESC LIMIT 1
        )) a` : fragment`SELECT NULL::text AS source_kind, NULL::uuid AS source_id WHERE FALSE`;
        const staffCandidate = sources.staff_term ? fragment`UNION ALL
          SELECT s.duration_days::text, s.daily_slot, s.ends_at
          FROM staff_term a JOIN r4_staff_private.free_sales s ON s.sale_id = a.source_id AND s.member_id = members.id
          JOIN ${paid} predecessor ON predecessor.id = s.predecessor_order_id AND predecessor.member_id = members.id AND predecessor.status = 'PAID'
          WHERE a.source_kind IN ('STAFF_FREE', 'STAFF_TRANSFER') AND a.source_kind = s.method
            AND s.recorded_at <= ${instant}::timestamptz` : fragment``;
        candidates = fragment`WITH staff_term AS (${staffTerm})
          SELECT CASE WHEN jsonb_typeof(o.package_snapshot->'durationDays') = 'number'
            THEN o.package_snapshot->>'durationDays' END AS duration, o.package_snapshot->>'timeSlot' AS daily_slot,
            o.membership_expires_at AS ends_at
          FROM public.r3_override_current_order(members.id, ${instant}::timestamptz) o
          JOIN ${paid} live ON live.id = o.id AND live.status = 'PAID'
          WHERE NOT EXISTS (SELECT FROM staff_term a WHERE (a.source_kind = 'ONLINE_PAID' AND a.source_id = o.id) IS NOT TRUE)
          ${staffCandidate}`;
      }
      termJoin = fragment`JOIN LATERAL (
        WITH candidates AS (${candidates})
        SELECT ends_at FROM (SELECT candidates.*, count(*) OVER () AS candidate_count FROM candidates) term
        WHERE candidate_count = 1 AND isfinite(ends_at) AND ends_at > ${instant}::timestamptz
          AND duration ~ '^[1-9][0-9]{0,3}$' AND public.package_catalog_daily_slot_valid(daily_slot)
          ${currentDuration ? fragment`AND duration = ${currentDuration}` : fragment``}
          ${currentSlot ? fragment`AND daily_slot = ${currentSlot}` : fragment``}
      ) current_term ON members.role = 'MEMBER' AND members.status = 'ACTIVE'
        AND NOT EXISTS (SELECT FROM package_payment_orders p WHERE p.member_id = members.id AND p.status = 'PENDING')`;
    }
  }
  const currentJoin = current ? termJoin : fragment``;
  const expiry = current && !invalid && !currentUnavailable ? fragment`current_term.ends_at`
    : !current && staffPaidReadsEnabled() ? fragment`COALESCE(r4_staff_private.paid_active_expiry(id, now()), expire_date)` : fragment`expire_date`;
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
    ${purchase} ${invalid || currentUnavailable ? fragment`AND FALSE` : fragment``}`;
  return { termJoin, currentJoin, currentUnavailable, nearExpiryAvailable, expiry, where, instant };
}

export async function getAdminMembers(input: MemberListInput = {}) {
  const { sql, fragment, callerRole } = await memberReader();
  const asOf = Date.now();
  const { filters, invalid } = memberListFilters(input);
  const { termJoin, currentJoin, currentUnavailable, nearExpiryAvailable, expiry, where, instant } =
    await buildMemberListQueryParts(sql, fragment, filters, invalid, asOf, true);
  const [count] = await sql`WITH monthly AS (
    SELECT to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') AS month, count(*)::int AS total
    FROM members ${currentJoin} WHERE ${where} GROUP BY 1
  ) SELECT coalesce(sum(total), 0)::int AS total,
    (SELECT coalesce(json_agg(json_build_object('month', month, 'total', total) ORDER BY month DESC), '[]'::json)
      FROM (SELECT month, total FROM monthly ORDER BY month DESC LIMIT 12) recent) AS monthly
    ${nearExpiryAvailable ? fragment`, (SELECT count(DISTINCT members.id)::int FROM members ${termJoin}
      WHERE ${where} AND current_term.ends_at <= ${instant}::timestamptz + interval '720 hours') AS "nearExpiry"` : fragment``}
    FROM monthly`;
  if (!count) throw new Error("Forbidden");
  const total = Number(count.total);
  const pages = Math.max(1, Math.ceil(total / 50));
  const pageInput = typeof input.page === "string" ? Number(input.page) : 1;
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(pageInput) ? pageInput : 1));
  const rows = await sql`SELECT member_code AS "memberCode", full_name AS "fullName", nickname, phone, gender, role, status,
    ${expiry} AS "expireDate", created_at AS "createdAt", points FROM members ${currentJoin}
    WHERE ${where}
    ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`;
  const monthly = (count.monthly as { month: string; total: number }[] | undefined ?? []).map(({ month, total }) => ({ month, total }));
  const lifecycle = filters.reportMonth && !invalid ? {
    month: filters.reportMonth,
    nearExpiry: nearExpiryAvailable ? Number(count.nearExpiry) : null,
    nearExpiryAsOf: nearExpiryAvailable ? instant : null,
  } : null;
  return { members: rows.map(memberProfile), callerRole, total, page, pages, filters, invalid, currentUnavailable, monthly, lifecycle, asOf };
}

export async function getAdminMembersForExport(input: MemberListInput = {}) {
  const auth = await authorizedMemberSession();
  if (auth.status !== 200) return auth;
  const asOf = Date.now();
  const { filters, invalid } = memberListFilters(input);
  if (invalid) return { status: 400 as const, error: "ตัวกรองไม่ถูกต้อง" };
  let parts;
  try {
    parts = await buildMemberListQueryParts(auth.sql, auth.fragment, filters, invalid, asOf, false);
  } catch (error) {
    if (error instanceof Error && error.message === "Forbidden") {
      return { status: 403 as const, error: "เซสชันหมดอายุหรือไม่มีสิทธิ์" };
    }
    throw error;
  }
  if (parts.currentUnavailable) {
    return { status: 422 as const, error: "ยังตรวจสอบแพ็กเกจที่มีสิทธิ์ปัจจุบันไม่ได้" };
  }
  const [result] = await auth.sql`SELECT true AS "authOk",
    coalesce((
      SELECT json_agg(row_data ORDER BY row_data."createdAt" DESC, row_data."rowId" DESC)
      FROM (
        SELECT members.id AS "rowId", member_code AS "memberCode", full_name AS "fullName",
          gender::text AS gender, phone, created_at AS "createdAt", role::text AS role, status::text AS status,
          ${parts.expiry} AS "expireDate"
        FROM members ${parts.currentJoin}
        WHERE ${parts.where}
        ORDER BY created_at DESC, id DESC
        LIMIT ${XLSX_MAX_ROWS + 1}
      ) row_data
    ), '[]'::json) AS rows`;
  if (!result) return { status: 403 as const, error: "เซสชันหมดอายุหรือไม่มีสิทธิ์" };
  const rawRows = (result.rows as Record<string, unknown>[] | undefined) ?? [];
  if (rawRows.length > XLSX_MAX_ROWS) {
    throw new XlsxLimitError("เกิน 10,000 รายการ กรุณาลดช่วงตัวกรอง");
  }
  return {
    status: 200 as const,
    asOf,
    rows: rawRows.map((row) => ({
      memberCode: String(row.memberCode),
      fullName: String(row.fullName),
      gender: String(row.gender ?? ""),
      phone: String(row.phone ?? ""),
      createdAt: String(row.createdAt),
      role: String(row.role),
      status: String(row.status),
      expireDate: row.expireDate == null ? null : String(row.expireDate),
    })),
  };
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
  const visitFields = historySources?.visits ? fragment`v.exited_at AS "exitedAt",
    CASE WHEN jsonb_typeof(v.snapshot #> '{package,name}') = 'string' THEN NULLIF(btrim(v.snapshot #>> '{package,name}'), '') END AS "packageName",
    CASE WHEN jsonb_typeof(v.snapshot->'usedTimeSlot') = 'string' THEN NULLIF(btrim(v.snapshot->>'usedTimeSlot'), '') END AS "usedTimeSlot"`
    : fragment`NULL::timestamptz AS "exitedAt", NULL::text AS "packageName", NULL::text AS "usedTimeSlot"`;
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
    sql`SELECT c.id, c.checkin_time AS "checkinTime", c.scanner_type AS "scannerType", ${visitFields}
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
      exitedAt: row.exitedAt ?? null, packageName: row.packageName ?? null, usedTimeSlot: row.usedTimeSlot ?? null })), pages.checkins),
    coupons: historyResult(coupons.map((row): CouponRow => ({ id: row.id, title: row.title, type: row.type, status: row.status,
      totalQuota: row.totalQuota, usedCount: row.usedCount, expireDate: row.expireDate, lastRecordedUsedAt: row.lastRecordedUsedAt ?? null })), pages.coupons), asOf: Date.now() };
}
export async function getAdminDashboard(input?: DashboardPeriodInput, now = new Date()) {
  const { sql, fragment, callerRole } = await memberReader("/admin");
  const period = resolveDashboardPeriod(input, now);
  const [meta] = await sql`SELECT
    (SELECT count(*)::int FROM checkins WHERE checkin_time >= ${period.start}::timestamptz AND checkin_time < ${period.end}::timestamptz) AS "checkins",
    to_regclass('r4_online_private.cancellations') IS NOT NULL AS "hasOnlineCancel",
    to_regclass('r4_staff_private.free_sales') IS NOT NULL AS "hasStaffSales",
    to_regclass('r4_staff_private.free_sale_cancellations') IS NOT NULL AS "hasStaffFreeCancel",
    to_regclass('r4_staff_private.paid_transfer_cancellations') IS NOT NULL AS "hasStaffPaidCancel"`;
  if (!meta) throw new Error("Forbidden");

  const hasOnlineCancel = Boolean(meta.hasOnlineCancel);
  const hasStaffSales = Boolean(meta.hasStaffSales);
  const hasStaffFreeCancel = Boolean(meta.hasStaffFreeCancel);
  const hasStaffPaidCancel = Boolean(meta.hasStaffPaidCancel);

  const staffCancelJoins = hasStaffSales
    ? fragment`${hasStaffFreeCancel ? fragment`LEFT JOIN r4_staff_private.free_sale_cancellations fc ON fc.sale_id = s.sale_id` : fragment``}
      ${hasStaffPaidCancel ? fragment`LEFT JOIN r4_staff_private.paid_transfer_cancellations pc ON pc.sale_id = s.sale_id` : fragment``}`
    : fragment``;
  const staffCancelledAtExpr = hasStaffFreeCancel && hasStaffPaidCancel
    ? fragment`COALESCE(fc.cancelled_at, pc.cancelled_at)`
    : hasStaffFreeCancel
      ? fragment`fc.cancelled_at`
      : hasStaffPaidCancel
        ? fragment`pc.cancelled_at`
        : fragment`NULL::timestamptz`;

  const [[membersRow], [termsRow], [visitsRow], financeData] = await Promise.all([
    sql`SELECT true AS "authOk",
      coalesce((
        SELECT json_agg(json_build_object(
          'id', m.id,
          'memberCode', m.member_code,
          'fullName', m.full_name,
          'status', m.status::text,
          'expireDate', m.expire_date
        ) ORDER BY m.id)
        FROM members m
      ), '[]'::json) AS rows`,
    sql`SELECT true AS "authOk",
      coalesce((
        SELECT json_agg(t)
        FROM (
          SELECT
            'online:' || o.id::text AS "termId",
            o.member_id AS "memberId",
            COALESCE(o.confirmed_at, o.created_at) AS "purchasedAt",
            o.membership_expires_at AS "expiresAt",
            ${hasOnlineCancel ? fragment`oc.cancelled_at` : fragment`NULL::timestamptz`} AS "cancelledAt",
            'ONLINE_PAID'::text AS "sourceKind"
          FROM package_payment_orders o
          ${hasOnlineCancel ? fragment`LEFT JOIN r4_online_private.cancellations oc ON oc.order_id = o.id` : fragment``}
          WHERE o.status = 'PAID' AND o.membership_expires_at IS NOT NULL
          ${hasStaffSales ? fragment`UNION ALL
          SELECT
            'staff:' || s.sale_id::text AS "termId",
            s.member_id AS "memberId",
            COALESCE(s.occurred_at, s.recorded_at) AS "purchasedAt",
            s.ends_at AS "expiresAt",
            ${staffCancelledAtExpr} AS "cancelledAt",
            s.method::text AS "sourceKind"
          FROM r4_staff_private.free_sales s
          ${staffCancelJoins}` : fragment``}
        ) t
      ), '[]'::json) AS rows`,
    sql`SELECT true AS "authOk",
      coalesce((
        SELECT json_agg(v ORDER BY v."checkinTime" DESC, v.id DESC)
        FROM (
          SELECT c.id, m.member_code AS "memberCode", m.full_name AS "fullName", c.checkin_time AS "checkinTime"
          FROM checkins c JOIN members m ON m.id = c.member_id
          WHERE c.checkin_time >= ${period.start}::timestamptz AND c.checkin_time < ${period.end}::timestamptz
          ORDER BY c.checkin_time DESC, c.id DESC LIMIT 10
        ) v
      ), '[]'::json) AS rows`,
    callerRole === "OWNER" ? readRealFinance() : Promise.resolve(null),
  ]);

  if (!membersRow || !termsRow || !visitsRow) throw new Error("Forbidden");

  const memberInputs = ((membersRow.rows as Record<string, unknown>[] | undefined) ?? []).map((row): DashboardMemberInput => ({
    id: Number(row.id),
    memberCode: String(row.memberCode),
    fullName: String(row.fullName),
    status: String(row.status),
    expireDate: row.expireDate == null ? null : String(row.expireDate),
  }));
  const termInputs = ((termsRow.rows as Record<string, unknown>[] | undefined) ?? []).map((row): DashboardTermInput => ({
    termId: String(row.termId),
    memberId: Number(row.memberId),
    purchasedAt: String(row.purchasedAt),
    expiresAt: String(row.expiresAt),
    cancelledAt: row.cancelledAt == null ? null : String(row.cancelledAt),
    sourceKind: String(row.sourceKind),
  }));
  const visits = ((visitsRow.rows as Record<string, unknown>[] | undefined) ?? []).map((row) => ({
    id: Number(row.id),
    memberCode: String(row.memberCode),
    fullName: String(row.fullName),
    checkinTime: String(row.checkinTime),
  }));

  const { summary: membershipSummary, statusChart, activityChart, expiring } = computeDashboardMembershipMetrics(
    memberInputs,
    termInputs,
    period,
  );

  const common = {
    month: period.month,
    period,
    summary: {
      ...membershipSummary,
      checkins: Number(meta.checkins),
      totalAccounts: memberInputs.length,
    },
    statusChart,
    activityChart,
    visits,
    expiring,
  };

  if (callerRole !== "OWNER" || !financeData) return { ...common, callerRole: "ADMIN" as const };
  return {
    ...common,
    callerRole: "OWNER" as const,
    finance: computeDashboardFinanceSummary(financeData, period),
  };
}
