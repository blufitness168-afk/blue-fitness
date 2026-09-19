export interface DashboardMonth {
  period: string;
  newMembers: number;
  renewals: number;
  expired: number;
  income: number;
  expense: number;
  expiringSoon: number;
}

export interface DashboardDay {
  date: string;
  newMembers: number;
  renewals: number;
  expired: number;
  income: number;
  expense: number;
}

export const dashboardMonths: DashboardMonth[] = [
  { period: "2025-10", newMembers: 9, renewals: 5, expired: 4, income: 42_500, expense: 31_200, expiringSoon: 14 },
  { period: "2025-11", newMembers: 11, renewals: 6, expired: 5, income: 48_900, expense: 36_400, expiringSoon: 15 },
  { period: "2025-12", newMembers: 13, renewals: 7, expired: 6, income: 56_700, expense: 49_800, expiringSoon: 17 },
  { period: "2026-01", newMembers: 14, renewals: 7, expired: 6, income: 62_400, expense: 44_100, expiringSoon: 18 },
  { period: "2026-02", newMembers: 18, renewals: 9, expired: 8, income: 71_800, expense: 52_600, expiringSoon: 20 },
  { period: "2026-03", newMembers: 15, renewals: 11, expired: 10, income: 68_300, expense: 61_500, expiringSoon: 19 },
  { period: "2026-04", newMembers: 24, renewals: 13, expired: 12, income: 84_900, expense: 59_700, expiringSoon: 23 },
  { period: "2026-05", newMembers: 31, renewals: 17, expired: 16, income: 103_600, expense: 72_400, expiringSoon: 25 },
  { period: "2026-06", newMembers: 27, renewals: 20, expired: 18, income: 96_200, expense: 69_800, expiringSoon: 24 },
  { period: "2026-07", newMembers: 38, renewals: 24, expired: 22, income: 128_500, expense: 83_900, expiringSoon: 29 },
  { period: "2026-08", newMembers: 34, renewals: 28, expired: 30, income: 117_400, expense: 91_600, expiringSoon: 31 },
  { period: "2026-09", newMembers: 12, renewals: 10, expired: 9, income: 54_800, expense: 38_500, expiringSoon: 27 },
];

const septemberDays = [
  [1, 1, 0, 0, 6_900, 0],
  [2, 0, 1, 0, 1_000, 0],
  [3, 1, 0, 1, 2_700, 0],
  [4, 2, 1, 0, 4_800, 1_200],
  [5, 0, 1, 1, 900, 0],
  [6, 1, 2, 0, 3_800, 0],
  [7, 1, 0, 1, 1_000, 0],
  [8, 0, 1, 0, 2_400, 0],
  [9, 2, 1, 1, 8_600, 0],
  [10, 1, 2, 1, 9_200, 0],
  [11, 0, 0, 1, 0, 38_500],
  [12, 1, 0, 0, 2_700, 0],
  [13, 0, 1, 1, 1_000, 0],
  [14, 1, 0, 0, 3_000, 0],
  [15, 0, 0, 1, 0, 0],
  [16, 0, 0, 0, 0, 0],
  [17, 0, 0, 1, 0, 0],
  [18, 1, 0, 0, 2_700, 0],
  [19, 0, 0, 0, 0, 0],
  [20, 0, 0, 0, 0, 0],
  [21, 0, 0, 0, 0, 0],
  [22, 0, 0, 1, 0, 0],
  [23, 0, 0, 0, 0, 0],
  [24, 0, 0, 0, 0, 0],
  [25, 0, 0, 0, 0, 0],
  [26, 0, 0, 0, 0, 0],
  [27, 0, 0, 0, 0, 0],
  [28, 0, 0, 0, 0, 0],
  [29, 0, 0, 0, 0, 0],
  [30, 0, 0, 0, 0, 0],
] as const;

export const dashboardDays: DashboardDay[] = septemberDays.map(
  ([day, newMembers, renewals, expired, income, expense]) => ({
    date: `2026-09-${String(day).padStart(2, "0")}`,
    newMembers,
    renewals,
    expired,
    income,
    expense,
  }),
);

export const dashboardOpening = {
  totalMembers: 106,
  activeMembers: 82,
  expiredMembers: 24,
  renewals: 18,
  income: 186_000,
  expense: 149_500,
};
