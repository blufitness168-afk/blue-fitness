import type { ChartDatum } from "@/components/AdminDashboardCharts";
import {
  financeChart,
  type FinanceData,
  type FinanceRecord,
} from "@/app/admin/finance/types";

export type DashboardPeriodMode = "day" | "month" | "year";

export type DashboardPeriodInput =
  | string
  | {
      mode?: string | string[];
      date?: string | string[];
      month?: string | string[];
      year?: string | string[];
    };

export interface DashboardPeriod {
  mode: DashboardPeriodMode;
  date: string;
  month: string;
  year: string;
  startDate: string;
  endDateInclusive: string;
  start: string;
  end: string;
  asOf: string;
  isLiveSnapshot: boolean;
  label: string;
  financeYear: string;
  financeDailyMonth: string;
}

export interface DashboardMemberInput {
  id: number;
  memberCode: string;
  fullName: string;
  status: string;
  expireDate: string | null;
}

export interface DashboardTermInput {
  termId: string;
  memberId: number;
  purchasedAt: string;
  expiresAt: string;
  cancelledAt: string | null;
  sourceKind: string;
}

export interface DashboardExpiringMember {
  memberCode: string;
  fullName: string;
  expireDate: string;
}

export interface DashboardMembershipSummary {
  totalPurchasedMembers: number;
  currentActiveMembers: number;
  expiredGraceMembers: number;
  lapsedMembers: number;
  everRenewedMembers: number;
  newInPeriod: number;
  renewedInPeriod: number;
  lapsedInPeriod: number;
  expiringIn30Days: number;
}

export interface DashboardFinanceTotals {
  income: number;
  expense: number;
  net: number;
}

export interface DashboardFinanceRecentRecord {
  id: string;
  date: string;
  type: "INCOME" | "EXPENSE";
  category: string;
  amount: number;
  memberCode: string | null;
  memberName: string | null;
  note: string;
  source: FinanceRecord["source"];
}

export interface DashboardFinanceSummary {
  cumulative: DashboardFinanceTotals;
  period: DashboardFinanceTotals;
  monthlyChart: ChartDatum[];
  dailyChart: ChartDatum[];
  dailyChartMonth: string;
  unconfirmedPaidCount: number;
  recentRecords: DashboardFinanceRecentRecord[];
}

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const LAPSE_MS = 30 * DAY_MS;
const RENEWAL_WINDOW_MS = 90 * DAY_MS;
const NEAR_EXPIRY_MS = 30 * DAY_MS;

function singleParam(value?: string | string[]): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function validDay(value?: string): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function validMonth(value?: string): value is string {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2100;
}

function validYear(value?: string): value is string {
  if (!value || !/^\d{4}$/.test(value)) return false;
  const year = Number(value);
  return year >= 2000 && year <= 2100;
}

function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function addMonths(month: string, delta: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}

export function lastDayOfMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function bangkokToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toBangkokDay(ms: number): string {
  return new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

function toBangkokMonth(ms: number): string {
  return new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 7);
}

export function resolveDashboardPeriod(
  input?: DashboardPeriodInput,
  now = new Date(),
): DashboardPeriod {
  const todayDay = bangkokToday(now);
  const todayMonth = todayDay.slice(0, 7);
  const todayYear = todayDay.slice(0, 4);

  const normalized =
    typeof input === "string" ? { mode: "month", month: input } : (input ?? {});

  const rawMode = singleParam(normalized.mode);
  const mode: DashboardPeriodMode =
    rawMode === "day" || rawMode === "year" || rawMode === "month"
      ? rawMode
      : "month";

  if (mode === "day") {
    const rawDate = singleParam(normalized.date);
    const targetDate = validDay(rawDate) ? rawDate : todayDay;
    const start = `${targetDate}T00:00:00+07:00`;
    const end = `${addDays(targetDate, 1)}T00:00:00+07:00`;
    const isLiveSnapshot = targetDate === todayDay;
    return {
      mode: "day",
      date: targetDate,
      month: targetDate.slice(0, 7),
      year: targetDate.slice(0, 4),
      startDate: targetDate,
      endDateInclusive: targetDate,
      start,
      end,
      asOf: isLiveSnapshot ? now.toISOString() : end,
      isLiveSnapshot,
      label: targetDate,
      financeYear: targetDate.slice(0, 4),
      financeDailyMonth: targetDate.slice(0, 7),
    };
  }

  if (mode === "year") {
    const rawYear = singleParam(normalized.year);
    const targetYear = validYear(rawYear) ? rawYear : todayYear;
    const startDate = `${targetYear}-01-01`;
    const endDateInclusive = `${targetYear}-12-31`;
    const start = `${startDate}T00:00:00+07:00`;
    const end = `${Number(targetYear) + 1}-01-01T00:00:00+07:00`;
    const isLiveSnapshot = targetYear === todayYear;
    const dailyMonth = isLiveSnapshot ? todayMonth : `${targetYear}-12`;
    return {
      mode: "year",
      date: isLiveSnapshot ? todayDay : startDate,
      month: dailyMonth,
      year: targetYear,
      startDate,
      endDateInclusive,
      start,
      end,
      asOf: isLiveSnapshot ? now.toISOString() : end,
      isLiveSnapshot,
      label: targetYear,
      financeYear: targetYear,
      financeDailyMonth: dailyMonth,
    };
  }

  const rawMonth = singleParam(normalized.month);
  const targetMonth = validMonth(rawMonth) ? rawMonth : todayMonth;
  const startDate = `${targetMonth}-01`;
  const endDateInclusive = lastDayOfMonth(targetMonth);
  const start = `${startDate}T00:00:00+07:00`;
  const end = `${addMonths(targetMonth, 1)}-01T00:00:00+07:00`;
  const isLiveSnapshot = targetMonth === todayMonth;
  return {
    mode: "month",
    date: isLiveSnapshot ? todayDay : startDate,
    month: targetMonth,
    year: targetMonth.slice(0, 4),
    startDate,
    endDateInclusive,
    start,
    end,
    asOf: isLiveSnapshot ? now.toISOString() : end,
    isLiveSnapshot,
    label: targetMonth,
    financeYear: targetMonth.slice(0, 4),
    financeDailyMonth: targetMonth,
  };
}

export function computeDashboardMembershipMetrics(
  members: DashboardMemberInput[],
  terms: DashboardTermInput[],
  period: DashboardPeriod,
): {
  summary: DashboardMembershipSummary;
  statusChart: ChartDatum[];
  activityChart: ChartDatum[];
  expiring: DashboardExpiringMember[];
} {
  const periodStartMs = Date.parse(period.start);
  const periodEndMs = Date.parse(period.end);
  const asOfMs = Date.parse(period.asOf);

  const memberById = new Map<number, DashboardMemberInput>();
  for (const member of members) {
    memberById.set(member.id, member);
  }

  // Group valid, non-cancelled terms (as of asOfMs) per member.
  const termsByMember = new Map<
    number,
    { termId: string; purchaseMs: number; expiryMs: number }[]
  >();
  for (const term of terms) {
    const purchaseMs = Date.parse(term.purchasedAt);
    const expiryMs = Date.parse(term.expiresAt);
    if (!Number.isFinite(purchaseMs) || !Number.isFinite(expiryMs)) continue;
    if (purchaseMs > asOfMs) continue;
    if (term.cancelledAt !== null) {
      const cancelledMs = Date.parse(term.cancelledAt);
      if (Number.isFinite(cancelledMs) && cancelledMs <= asOfMs) continue;
    }
    const list = termsByMember.get(term.memberId);
    const item = { termId: term.termId, purchaseMs, expiryMs };
    if (list) list.push(item);
    else termsByMember.set(term.memberId, [item]);
  }

  // Prepare activity chart buckets.
  const bucketKeys: string[] = [];
  if (period.mode === "year") {
    for (let monthNum = 1; monthNum <= 12; monthNum++) {
      bucketKeys.push(`${period.year}-${String(monthNum).padStart(2, "0")}`);
    }
  } else if (period.mode === "month") {
    for (let offset = -5; offset <= 0; offset++) {
      bucketKeys.push(addMonths(period.month, offset));
    }
  } else {
    bucketKeys.push(period.date);
  }

  const bucketSets = new Map<
    string,
    { new: Set<number>; renewed: Set<number>; lapsed: Set<number> }
  >();
  for (const key of bucketKeys) {
    bucketSets.set(key, {
      new: new Set<number>(),
      renewed: new Set<number>(),
      lapsed: new Set<number>(),
    });
  }

  const recordBucketEvent = (
    eventMs: number,
    kind: "new" | "renewed" | "lapsed",
    memberId: number,
  ) => {
    const key =
      period.mode === "day" ? toBangkokDay(eventMs) : toBangkokMonth(eventMs);
    const sets = bucketSets.get(key);
    if (sets) {
      sets[kind].add(memberId);
    }
  };

  let totalPurchasedMembers = 0;
  let currentActiveMembers = 0;
  let expiredGraceMembers = 0;
  let lapsedMembers = 0;
  const everRenewedSet = new Set<number>();
  const newInPeriodSet = new Set<number>();
  const renewedInPeriodSet = new Set<number>();
  const lapsedInPeriodSet = new Set<number>();
  const expiringList: { memberCode: string; fullName: string; expireMs: number }[] =
    [];

  for (const [memberId, memberTerms] of termsByMember.entries()) {
    const member = memberById.get(memberId);
    if (!member || memberTerms.length === 0) continue;

    memberTerms.sort(
      (a, b) =>
        a.purchaseMs - b.purchaseMs ||
        a.expiryMs - b.expiryMs ||
        a.termId.localeCompare(b.termId),
    );

    totalPurchasedMembers++;
    let runningMaxExpiry: number | null = null;

    for (const term of memberTerms) {
      if (runningMaxExpiry !== null) {
        const lapseMs = runningMaxExpiry + LAPSE_MS;
        if (term.purchaseMs > lapseMs && lapseMs < asOfMs) {
          if (lapseMs >= periodStartMs && lapseMs < periodEndMs) {
            lapsedInPeriodSet.add(memberId);
          }
          recordBucketEvent(lapseMs, "lapsed", memberId);
        }
      }

      const isNew =
        runningMaxExpiry === null ||
        term.purchaseMs > runningMaxExpiry + RENEWAL_WINDOW_MS;
      if (!isNew) {
        everRenewedSet.add(memberId);
      }

      if (term.purchaseMs >= periodStartMs && term.purchaseMs < periodEndMs) {
        if (isNew) newInPeriodSet.add(memberId);
        else renewedInPeriodSet.add(memberId);
      }
      recordBucketEvent(
        term.purchaseMs,
        isNew ? "new" : "renewed",
        memberId,
      );

      runningMaxExpiry =
        runningMaxExpiry === null
          ? term.expiryMs
          : Math.max(runningMaxExpiry, term.expiryMs);
    }

    if (runningMaxExpiry === null) continue;

    const finalLapseMs = runningMaxExpiry + LAPSE_MS;
    if (finalLapseMs < asOfMs) {
      if (finalLapseMs >= periodStartMs && finalLapseMs < periodEndMs) {
        lapsedInPeriodSet.add(memberId);
      }
      recordBucketEvent(finalLapseMs, "lapsed", memberId);
    }

    const isActive =
      member.status !== "SUSPENDED" &&
      (!period.isLiveSnapshot || member.status === "ACTIVE") &&
      runningMaxExpiry > asOfMs;

    if (isActive) {
      currentActiveMembers++;
      if (runningMaxExpiry <= asOfMs + NEAR_EXPIRY_MS) {
        expiringList.push({
          memberCode: member.memberCode,
          fullName: member.fullName,
          expireMs: runningMaxExpiry,
        });
      }
    } else if (member.status !== "SUSPENDED") {
      if (finalLapseMs < asOfMs) {
        lapsedMembers++;
      } else {
        expiredGraceMembers++;
      }
    }
  }

  expiringList.sort(
    (a, b) =>
      a.expireMs - b.expireMs || a.memberCode.localeCompare(b.memberCode),
  );

  const expiring: DashboardExpiringMember[] = expiringList.map((item) => ({
    memberCode: item.memberCode,
    fullName: item.fullName,
    expireDate: new Date(item.expireMs).toISOString(),
  }));

  const summary: DashboardMembershipSummary = {
    totalPurchasedMembers,
    currentActiveMembers,
    expiredGraceMembers,
    lapsedMembers,
    everRenewedMembers: everRenewedSet.size,
    newInPeriod: newInPeriodSet.size,
    renewedInPeriod: renewedInPeriodSet.size,
    lapsedInPeriod: lapsedInPeriodSet.size,
    expiringIn30Days: expiring.length,
  };

  const statusChart: ChartDatum[] = [
    {
      label: "สถานะ ณ วันที่รายงาน",
      values: {
        active: summary.currentActiveMembers,
        grace: summary.expiredGraceMembers,
        lapsed: summary.lapsedMembers,
        everRenewed: summary.everRenewedMembers,
      },
    },
  ];

  const activityChart: ChartDatum[] = bucketKeys.map((key) => {
    const sets = bucketSets.get(key)!;
    return {
      label: key,
      values: {
        new: sets.new.size,
        renewed: sets.renewed.size,
        lapsed: sets.lapsed.size,
      },
    };
  });

  return { summary, statusChart, activityChart, expiring };
}

function sumSatangTotals(records: FinanceRecord[]): DashboardFinanceTotals {
  let incomeSatang = 0;
  let expenseSatang = 0;
  for (const record of records) {
    const satang = Math.round(record.amount * 100);
    if (record.type === "INCOME") incomeSatang += satang;
    else expenseSatang += satang;
  }
  return {
    income: incomeSatang / 100,
    expense: expenseSatang / 100,
    net: (incomeSatang - expenseSatang) / 100,
  };
}

export function computeDashboardFinanceSummary(
  financeData: FinanceData,
  period: DashboardPeriod,
): DashboardFinanceSummary {
  const periodRecords = financeData.records.filter(
    (record) =>
      record.date >= period.startDate && record.date <= period.endDateInclusive,
  );

  const cumulative = sumSatangTotals(financeData.records);
  const periodTotals = sumSatangTotals(periodRecords);

  const monthlyChart = financeChart(
    financeData.records,
    "month",
    `${period.financeYear}-01-01`,
    `${period.financeYear}-12-31`,
  );
  const dailyChart = financeChart(
    financeData.records,
    "day",
    `${period.financeDailyMonth}-01`,
    lastDayOfMonth(period.financeDailyMonth),
  );

  const recentRecords: DashboardFinanceRecentRecord[] = [...periodRecords]
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    )
    .slice(0, 10)
    .map((record) => ({
      id: record.id,
      date: record.date,
      type: record.type,
      category: record.category,
      amount: record.amount,
      memberCode: record.memberCode ?? null,
      memberName: record.memberName ?? null,
      note: record.note,
      source: record.source,
    }));

  return {
    cumulative,
    period: periodTotals,
    monthlyChart,
    dailyChart,
    dailyChartMonth: period.financeDailyMonth,
    unconfirmedPaidCount: financeData.unconfirmedPaidCount ?? 0,
    recentRecords,
  };
}
