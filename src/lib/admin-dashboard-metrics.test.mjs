import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

function loadModule(relPath, mocks = {}) {
  const filename = new URL(relPath, import.meta.url).pathname;
  const mod = new Module(filename);
  mod.filename = filename;
  mod.require = (name) => {
    if (name in mocks) return mocks[name];
    return require(name);
  };
  const source = readFileSync(new URL(relPath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  mod._compile(compiled, filename);
  return mod.exports;
}

const financeTypes = loadModule("../app/admin/finance/types.ts");
const metrics = loadModule("./admin-dashboard-metrics.ts", {
  "@/app/admin/finance/types": financeTypes,
  "@/components/AdminDashboardCharts": {},
});

const {
  resolveDashboardPeriod,
  computeDashboardMembershipMetrics,
  computeDashboardFinanceSummary,
} = metrics;

const DAY_MS = 86_400_000;

test("resolveDashboardPeriod handles day, month, year, string input, rollovers, leap days and invalid fallback", () => {
  const now = new Date("2026-11-21T08:00:00Z"); // 2026-11-21 15:00 Bangkok

  const liveMonth = resolveDashboardPeriod(undefined, now);
  assert.equal(liveMonth.mode, "month");
  assert.equal(liveMonth.month, "2026-11");
  assert.equal(liveMonth.start, "2026-11-01T00:00:00+07:00");
  assert.equal(liveMonth.end, "2026-12-01T00:00:00+07:00");
  assert.equal(liveMonth.isLiveSnapshot, true);
  assert.equal(liveMonth.asOf, now.toISOString());

  const compatRollover = resolveDashboardPeriod("2026-12", now);
  assert.equal(compatRollover.mode, "month");
  assert.equal(compatRollover.start, "2026-12-01T00:00:00+07:00");
  assert.equal(compatRollover.end, "2027-01-01T00:00:00+07:00");
  assert.equal(compatRollover.endDateInclusive, "2026-12-31");
  assert.equal(compatRollover.isLiveSnapshot, false);
  assert.equal(compatRollover.asOf, "2027-01-01T00:00:00+07:00");

  const leapDay = resolveDashboardPeriod({ mode: "day", date: "2028-02-29" }, now);
  assert.equal(leapDay.mode, "day");
  assert.equal(leapDay.date, "2028-02-29");
  assert.equal(leapDay.start, "2028-02-29T00:00:00+07:00");
  assert.equal(leapDay.end, "2028-03-01T00:00:00+07:00");
  assert.equal(leapDay.financeYear, "2028");
  assert.equal(leapDay.financeDailyMonth, "2028-02");

  const invalidDay = resolveDashboardPeriod({ mode: "day", date: "2026-02-29" }, now);
  assert.equal(invalidDay.date, "2026-11-21");
  assert.equal(invalidDay.isLiveSnapshot, true);

  const pastYear = resolveDashboardPeriod({ mode: "year", year: "2025" }, now);
  assert.equal(pastYear.mode, "year");
  assert.equal(pastYear.startDate, "2025-01-01");
  assert.equal(pastYear.endDateInclusive, "2025-12-31");
  assert.equal(pastYear.end, "2026-01-01T00:00:00+07:00");
  assert.equal(pastYear.financeDailyMonth, "2025-12");

  const liveYear = resolveDashboardPeriod({ mode: "year", year: "2026" }, now);
  assert.equal(liveYear.isLiveSnapshot, true);
  assert.equal(liveYear.financeDailyMonth, "2026-11");

  const dayRange = resolveDashboardPeriod({ mode: "day", dateFrom: "2026-01-15", dateTo: "2026-01-01" }, now);
  assert.equal(dayRange.mode, "day");
  assert.equal(dayRange.startDate, "2026-01-01");
  assert.equal(dayRange.endDateInclusive, "2026-01-15");
  assert.equal(dayRange.daySpan, 15);
  assert.equal(dayRange.showDailyFinanceChart, true);
  assert.equal(dayRange.isLiveSnapshot, false);
  assert.equal(dayRange.asOf, "2026-01-16T00:00:00+07:00");

  const monthRange = resolveDashboardPeriod({ mode: "month", monthFrom: "2026-01", monthTo: "2026-03" }, now);
  assert.equal(monthRange.mode, "month");
  assert.equal(monthRange.startDate, "2026-01-01");
  assert.equal(monthRange.endDateInclusive, "2026-03-31");
  assert.equal(monthRange.daySpan, 90);
  assert.equal(monthRange.showDailyFinanceChart, false);
  assert.equal(monthRange.asOf, "2026-04-01T00:00:00+07:00");
});

test("computeDashboardMembershipMetrics handles empty database across day, month and year views", () => {
  const now = new Date("2026-01-15T05:00:00Z");
  for (const input of [
    { mode: "day", date: "2026-01-15" },
    { mode: "month", month: "2026-01" },
    { mode: "year", year: "2026" },
  ]) {
    const period = resolveDashboardPeriod(input, now);
    const result = computeDashboardMembershipMetrics([], [], period);
    assert.deepEqual(result.summary, {
      totalPurchasedMembers: 0,
      currentActiveMembers: 0,
      expiredGraceMembers: 0,
      lapsedMembers: 0,
      everRenewedMembers: 0,
      newInPeriod: 0,
      renewedInPeriod: 0,
      lapsedInPeriod: 0,
      expiringIn30Days: 0,
    });
    assert.deepEqual(result.expiring, []);
    assert.equal(result.statusChart.length, 1);
    const expectedBuckets = input.mode === "year" ? 12 : input.mode === "month" ? 6 : 1;
    assert.equal(result.activityChart.length, expectedBuckets);
    if (input.mode === "month") {
      assert.deepEqual(
        result.activityChart.map((d) => d.label),
        ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"],
      );
    }
  }
});

test("computeDashboardMembershipMetrics applies exact 30d lapse, 90d renewal window, deduplication, cancellations and suspension", () => {
  // Report timestamp: 2026-11-21 15:00 Bangkok (live snapshot)
  const now = new Date("2026-11-21T08:00:00Z");
  const period = resolveDashboardPeriod({ mode: "month", month: "2026-11" }, now);
  const t = (isoBangkok) => isoBangkok;

  const members = [
    { id: 1, memberCode: "BLU-1", fullName: "Never Bought", status: "PENDING", expireDate: null },
    { id: 2, memberCode: "BLU-2", fullName: "Multi Buy Same Month", status: "ACTIVE", expireDate: t("2026-12-10T00:00:00+07:00") },
    { id: 3, memberCode: "BLU-3", fullName: "Renew Day 30", status: "ACTIVE", expireDate: t("2026-12-15T00:00:00+07:00") },
    { id: 4, memberCode: "BLU-4", fullName: "Lapse 31 Then Renew Day 35", status: "ACTIVE", expireDate: t("2026-12-05T00:00:00+07:00") },
    { id: 5, memberCode: "BLU-5", fullName: "Renew Day 90", status: "ACTIVE", expireDate: t("2026-12-30T00:00:00+07:00") },
    { id: 6, memberCode: "BLU-6", fullName: "Rejoin Day 91", status: "ACTIVE", expireDate: t("2027-01-10T00:00:00+07:00") },
    { id: 7, memberCode: "BLU-7", fullName: "Lapsed Nov", status: "EXPIRED", expireDate: t("2026-10-15T00:00:00+07:00") },
    { id: 8, memberCode: "BLU-8", fullName: "Grace Nov", status: "EXPIRED", expireDate: t("2026-11-05T00:00:00+07:00") },
    { id: 9, memberCode: "BLU-9", fullName: "Cancelled & Suspended", status: "SUSPENDED", expireDate: t("2026-12-20T00:00:00+07:00") },
    { id: 10, memberCode: "BLU-10", fullName: "Cancelled Term Ignored", status: "EXPIRED", expireDate: null },
  ];

  // Exact offsets relative to a base timestamp
  const base4Expiry = Date.parse("2026-10-05T10:00:00+07:00");
  const base5Expiry = Date.parse("2026-08-10T10:00:00+07:00");
  const base6Expiry = Date.parse("2026-08-10T10:00:00+07:00");

  const terms = [
    // BLU-2: Two purchases in 2026-11 -> 1st is NEW, 2nd is RENEWAL; counted once in each group!
    { termId: "t2-a", memberId: 2, purchasedAt: t("2026-11-02T10:00:00+07:00"), expiresAt: t("2026-11-10T10:00:00+07:00"), cancelledAt: null, sourceKind: "ONLINE_PAID" },
    { termId: "t2-b", memberId: 2, purchasedAt: t("2026-11-12T10:00:00+07:00"), expiresAt: t("2026-12-10T10:00:00+07:00"), cancelledAt: null, sourceKind: "ONLINE_PAID" },

    // BLU-3: First bought in Oct, expired Oct 15, renewed exactly 30 days later (Nov 14) -> NOT lapsed, IS renewal
    { termId: "t3-a", memberId: 3, purchasedAt: t("2026-10-01T10:00:00+07:00"), expiresAt: t("2026-10-15T10:00:00+07:00"), cancelledAt: null, sourceKind: "ONLINE_PAID" },
    { termId: "t3-b", memberId: 3, purchasedAt: new Date(Date.parse("2026-10-15T10:00:00+07:00") + 30 * DAY_MS).toISOString(), expiresAt: t("2026-12-15T00:00:00+07:00"), cancelledAt: null, sourceKind: "STAFF_TRANSFER" },

    // BLU-4: Expired 2026-10-05, lapsed at +30d (2026-11-04), renewed at +35d (2026-11-09 <= 90d) -> counts in BOTH lapsedInPeriod and renewedInPeriod!
    { termId: "t4-a", memberId: 4, purchasedAt: t("2026-09-05T10:00:00+07:00"), expiresAt: new Date(base4Expiry).toISOString(), cancelledAt: null, sourceKind: "ONLINE_PAID" },
    { termId: "t4-b", memberId: 4, purchasedAt: new Date(base4Expiry + 35 * DAY_MS).toISOString(), expiresAt: t("2026-12-05T00:00:00+07:00"), cancelledAt: null, sourceKind: "ONLINE_PAID" },

    // BLU-5: Expired 2026-08-10, renewed exactly at +90 days (2026-11-08) -> lapsed in Sep, renewed in Nov!
    { termId: "t5-a", memberId: 5, purchasedAt: t("2026-07-10T10:00:00+07:00"), expiresAt: new Date(base5Expiry).toISOString(), cancelledAt: null, sourceKind: "ONLINE_PAID" },
    { termId: "t5-b", memberId: 5, purchasedAt: new Date(base5Expiry + 90 * DAY_MS).toISOString(), expiresAt: t("2026-12-30T00:00:00+07:00"), cancelledAt: null, sourceKind: "ONLINE_PAID" },

    // BLU-6: Expired 2026-08-10, bought again at +91 days (2026-11-09) -> >90d, treated as NEW in Nov!
    { termId: "t6-a", memberId: 6, purchasedAt: t("2026-07-10T10:00:00+07:00"), expiresAt: new Date(base6Expiry).toISOString(), cancelledAt: null, sourceKind: "ONLINE_PAID" },
    { termId: "t6-b", memberId: 6, purchasedAt: new Date(base6Expiry + 91 * DAY_MS).toISOString(), expiresAt: t("2027-01-10T00:00:00+07:00"), cancelledAt: null, sourceKind: "ONLINE_PAID" },

    // BLU-7: Expired 2026-10-15 -> lapsed on 2026-11-14 -> lapsedMembers & lapsedInPeriod
    { termId: "t7-a", memberId: 7, purchasedAt: t("2026-09-15T10:00:00+07:00"), expiresAt: t("2026-10-15T10:00:00+07:00"), cancelledAt: null, sourceKind: "ONLINE_PAID" },

    // BLU-8: Expired 2026-11-05 -> within 30d grace on Nov 21 -> expiredGraceMembers
    { termId: "t8-a", memberId: 8, purchasedAt: t("2026-10-06T10:00:00+07:00"), expiresAt: t("2026-11-05T10:00:00+07:00"), cancelledAt: null, sourceKind: "ONLINE_PAID" },

    // BLU-9: Suspended member with active-date term in Nov -> counts purchase, NOT active or expiring
    { termId: "t9-a", memberId: 9, purchasedAt: t("2026-11-15T10:00:00+07:00"), expiresAt: t("2026-12-20T00:00:00+07:00"), cancelledAt: null, sourceKind: "ONLINE_PAID" },

    // BLU-10: Single cancelled term -> ignored completely
    { termId: "t10-a", memberId: 10, purchasedAt: t("2026-11-18T10:00:00+07:00"), expiresAt: t("2026-12-18T10:00:00+07:00"), cancelledAt: t("2026-11-19T10:00:00+07:00"), sourceKind: "ONLINE_PAID" },
  ];

  const { summary, statusChart, activityChart, expiring } = computeDashboardMembershipMetrics(
    members,
    terms,
    period,
  );

  // Members 2,3,4,5,6,7,8,9 purchased (1 never bought, 10 cancelled) = 8
  assert.equal(summary.totalPurchasedMembers, 8);
  // Active as of Nov 21: BLU-2 (Dec 10), BLU-3 (Dec 15), BLU-4 (Dec 5), BLU-5 (Dec 30), BLU-6 (Jan 10) = 5 (BLU-9 suspended)
  assert.equal(summary.currentActiveMembers, 5);
  // Expiring within 30 days of Nov 21 (<= Dec 21): BLU-4 (Dec 5), BLU-2 (Dec 10), BLU-3 (Dec 15) = 3 (BLU-5 is Dec 30, BLU-6 is Jan 10)
  assert.equal(summary.expiringIn30Days, 3);
  assert.deepEqual(expiring.map((e) => e.memberCode), ["BLU-4", "BLU-2", "BLU-3"]);
  assert.equal(summary.lapsedMembers, 1); // BLU-7
  assert.equal(summary.expiredGraceMembers, 1); // BLU-8
  assert.equal(summary.everRenewedMembers, 4); // BLU-2, BLU-3, BLU-4, BLU-5
  assert.equal(summary.newInPeriod, 3); // BLU-2 (first), BLU-6 (>90d), BLU-9
  assert.equal(summary.renewedInPeriod, 4); // BLU-2, BLU-3, BLU-4, BLU-5
  assert.equal(summary.lapsedInPeriod, 2); // BLU-4 (Nov 4), BLU-7 (Nov 14)

  // Chart alignment checks
  assert.deepEqual(statusChart[0].values, {
    active: summary.currentActiveMembers,
    grace: summary.expiredGraceMembers,
    lapsed: summary.lapsedMembers,
    everRenewed: summary.everRenewedMembers,
  });
  const novBucket = activityChart.at(-1);
  assert.equal(novBucket.label, "2026-11");
  assert.deepEqual(novBucket.values, {
    new: summary.newInPeriod,
    renewed: summary.renewedInPeriod,
    lapsed: summary.lapsedInPeriod,
  });
  // BLU-5 & BLU-6 lapsed in 2026-09 (Aug 10 + 30d = Sep 9)
  const sepBucket = activityChart.find((d) => d.label === "2026-09");
  assert.equal(sepBucket.values.lapsed, 2);
});

test("computeDashboardFinanceSummary computes exact satang totals matching charts", () => {
  const now = new Date("2028-02-20T05:00:00Z"); // leap year Feb
  const period = resolveDashboardPeriod({ mode: "month", month: "2028-02" }, now);
  const financeData = {
    records: [
      { id: "1", date: "2028-02-01", type: "INCOME", category: "สมัครใหม่", amount: 0.1, note: "a", source: "MEMBERSHIP", createdAt: "2028-02-01T00:00:00Z", version: 1, memberCode: "BLU-1", memberName: "One" },
      { id: "2", date: "2028-02-01", type: "INCOME", category: "ต่อสมาชิก", amount: 0.2, note: "b", source: "STAFF_TRANSFER", createdAt: "2028-02-01T01:00:00Z", version: 1 },
      { id: "3", date: "2028-02-15", type: "EXPENSE", category: "เงินเดือน", amount: 0.15, note: "c", source: "MANUAL", createdAt: "2028-02-15T00:00:00Z", version: 1 },
      { id: "4", date: "2028-01-10", type: "INCOME", category: "รายได้อื่น (ไม่ใช่แพ็กเกจ)", amount: 500, note: "jan", source: "MANUAL", createdAt: "2028-01-10T00:00:00Z", version: 1 },
    ],
    audit: [{ id: 1, secret: "MUST_NOT_LEAK" }],
    unconfirmedPaidCount: 2,
  };

  const result = computeDashboardFinanceSummary(financeData, period);
  assert.deepEqual(result.period, { income: 0.3, expense: 0.15, net: 0.15 });
  assert.deepEqual(result.cumulative, { income: 500.3, expense: 0.15, net: 500.15 });
  assert.equal(result.monthlyChart.length, 12);
  assert.equal(result.dailyChart.length, 29); // Leap year Feb 2028 has 29 days!
  assert.deepEqual(result.dailyChart[0].values, { income: 0.3, expense: 0, net: 0.3 });
  assert.equal(result.unconfirmedPaidCount, 2);
  assert.equal(result.recentRecords.length, 3);
  assert.doesNotMatch(JSON.stringify(result), /MUST_NOT_LEAK|audit/);
});
