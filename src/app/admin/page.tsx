"use client";

import { useMemo, useState } from "react";
import {
  AlarmClock,
  ArrowRight,
  CalendarRange,
  DollarSign,
  ScanLine,
  Users,
} from "lucide-react";
import AdminDashboardChart, {
  type ChartDatum,
  type ChartSeries,
} from "@/components/AdminDashboardCharts";
import { useLanguage } from "@/context/LanguageContext";
import {
  dashboardDays,
  dashboardMonths,
  dashboardOpening,
  type DashboardDay,
  type DashboardMonth,
} from "@/lib/admin-dashboard-mock";
import {
  mockExpiringMembers,
  mockRecentSales,
  mockTodayCheckins,
} from "@/lib/admin-mock";

type ViewMode = "day" | "month" | "year";
interface DashboardFilter {
  mode: ViewMode;
  value: string;
}

const initialFilter: DashboardFilter = { mode: "month", value: "2026-09" };
const defaultValues: Record<ViewMode, string> = {
  day: "2026-09-19",
  month: "2026-09",
  year: "2026",
};

const memberTrendSeries: ChartSeries[] = [
  { key: "active", label: "สมาชิกปัจจุบัน", color: "#00a86b" },
  { key: "expiredTotal", label: "สมาชิกที่พ้นสภาพ", color: "#e05545" },
  { key: "renewalTotal", label: "สมาชิกเก่าที่ต่ออายุ", color: "#3a728e" },
];
const memberPeriodSeries: ChartSeries[] = [
  { key: "renewals", label: "ต่ออายุ", color: "#3a728e" },
  { key: "newMembers", label: "สมาชิกใหม่", color: "#00a86b" },
  { key: "expired", label: "พ้นสภาพ", color: "#e05545" },
];
const financeSeries: ChartSeries[] = [
  { key: "income", label: "รายได้", color: "#00a86b" },
  { key: "expense", label: "รายจ่าย", color: "#e05545" },
  { key: "net", label: "คงเหลือสุทธิ", color: "#3a728e" },
];

function sum<T>(items: T[], pick: (item: T) => number) {
  return items.reduce((total, item) => total + pick(item), 0);
}

function formatMoney(value: number) {
  return value.toLocaleString("th-TH");
}

function monthLabel(period: string) {
  const [year, month] = period.split("-");
  return `${month}/${year.slice(2)}`;
}

function filterEnd(filter: DashboardFilter) {
  if (filter.mode === "day") return filter.value;
  if (filter.mode === "month") return `${filter.value}-31`;
  return `${filter.value}-12-31`;
}

function filterMonth(filter: DashboardFilter) {
  if (filter.mode === "year") return `${filter.value}-12`;
  return filter.value.slice(0, 7);
}

function periodLabel(filter: DashboardFilter) {
  if (filter.mode === "day") {
    return new Date(`${filter.value}T00:00:00`).toLocaleDateString("th-TH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }
  if (filter.mode === "month") {
    return new Date(`${filter.value}-01T00:00:00`).toLocaleDateString("th-TH", {
      month: "long",
      year: "numeric",
    });
  }
  return `ปี ${Number(filter.value) + 543}`;
}

function monthsThrough(filter: DashboardFilter) {
  const endMonth = filterMonth(filter);
  if (filter.mode === "day") return dashboardMonths.filter((item) => item.period < endMonth);
  return dashboardMonths.filter((item) => item.period <= endMonth);
}

function daysThrough(filter: DashboardFilter) {
  if (filter.mode !== "day") return [];
  return dashboardDays.filter((item) => item.date <= filterEnd(filter));
}

function snapshot(months: DashboardMonth[], days: DashboardDay[] = []) {
  const newMembers = sum(months, (item) => item.newMembers) + sum(days, (item) => item.newMembers);
  const expired = sum(months, (item) => item.expired) + sum(days, (item) => item.expired);
  const renewals = sum(months, (item) => item.renewals) + sum(days, (item) => item.renewals);
  const income = sum(months, (item) => item.income) + sum(days, (item) => item.income);
  const expense = sum(months, (item) => item.expense) + sum(days, (item) => item.expense);
  return {
    totalMembers: dashboardOpening.totalMembers + newMembers,
    activeMembers: dashboardOpening.activeMembers + newMembers - expired,
    expiredMembers: dashboardOpening.expiredMembers + expired,
    renewals: dashboardOpening.renewals + renewals,
    income: dashboardOpening.income + income,
    expense: dashboardOpening.expense + expense,
  };
}

function periodTotals(filter: DashboardFilter) {
  if (filter.mode === "day") {
    const rows = dashboardDays.filter((item) => item.date === filter.value);
    return aggregateRows(rows);
  }
  const rows = dashboardMonths.filter((item) =>
    filter.mode === "month" ? item.period === filter.value : item.period.startsWith(`${filter.value}-`),
  );
  return aggregateRows(rows);
}

function aggregateRows(rows: Array<DashboardMonth | DashboardDay>) {
  const income = sum(rows, (item) => item.income);
  const expense = sum(rows, (item) => item.expense);
  return {
    newMembers: sum(rows, (item) => item.newMembers),
    renewals: sum(rows, (item) => item.renewals),
    expired: sum(rows, (item) => item.expired),
    income,
    expense,
    net: income - expense,
  };
}

function memberTrendData(filter: DashboardFilter): ChartDatum[] {
  if (filter.mode === "day") {
    const currentMonth = filter.value.slice(0, 7);
    const baseMonths = dashboardMonths.filter((item) => item.period < currentMonth);
    const rows = dashboardDays.filter((item) => item.date.startsWith(currentMonth) && item.date <= filter.value);
    return rows.map((row, index) => {
      const state = snapshot(baseMonths, rows.slice(0, index + 1));
      return {
        label: row.date.slice(8),
        values: { active: state.activeMembers, expiredTotal: state.expiredMembers, renewalTotal: state.renewals },
      };
    });
  }
  const rows = dashboardMonths.filter((item) =>
    filter.mode === "month" ? item.period <= filter.value : item.period.startsWith(`${filter.value}-`),
  );
  const visible = filter.mode === "month" ? rows.slice(-6) : rows;
  return visible.map((row) => {
    const state = snapshot(dashboardMonths.filter((item) => item.period <= row.period));
    return {
      label: monthLabel(row.period),
      values: { active: state.activeMembers, expiredTotal: state.expiredMembers, renewalTotal: state.renewals },
    };
  });
}

function memberPeriodData(filter: DashboardFilter): ChartDatum[] {
  if (filter.mode === "day") {
    return dashboardDays
      .filter((item) => item.date.startsWith(filter.value.slice(0, 7)) && item.date <= filter.value)
      .map((item) => ({
        label: item.date.slice(8),
        values: { renewals: item.renewals, newMembers: item.newMembers, expired: item.expired },
      }));
  }
  const rows = dashboardMonths.filter((item) =>
    filter.mode === "month" ? item.period <= filter.value : item.period.startsWith(`${filter.value}-`),
  );
  return (filter.mode === "month" ? rows.slice(-6) : rows).map((item) => ({
    label: monthLabel(item.period),
    values: { renewals: item.renewals, newMembers: item.newMembers, expired: item.expired },
  }));
}

function monthlyFinanceData(filter: DashboardFilter): ChartDatum[] {
  const year = filter.mode === "year" ? filter.value : filter.value.slice(0, 4);
  const maxMonth = filter.mode === "year" ? `${year}-12` : filter.value.slice(0, 7);
  return dashboardMonths
    .filter((item) => item.period.startsWith(`${year}-`) && item.period <= maxMonth)
    .map((item) => ({
      label: item.period.slice(5),
      values: { income: item.income, expense: item.expense, net: item.income - item.expense },
    }));
}

function dailyFinanceMonth(filter: DashboardFilter) {
  if (filter.mode !== "year") return filter.value.slice(0, 7);
  return [...dashboardDays].reverse().find((item) => item.date.startsWith(`${filter.value}-`))?.date.slice(0, 7) ?? `${filter.value}-01`;
}

function dailyFinanceData(filter: DashboardFilter): ChartDatum[] {
  const month = dailyFinanceMonth(filter);
  return dashboardDays
    .filter((item) => item.date.startsWith(month) && (filter.mode !== "day" || item.date <= filter.value))
    .map((item) => ({
      label: item.date.slice(8),
      values: { income: item.income, expense: item.expense, net: item.income - item.expense },
    }));
}

export default function AdminDashboardPage() {
  const { lang } = useLanguage();
  const [draft, setDraft] = useState<DashboardFilter>(initialFilter);
  const [applied, setApplied] = useState<DashboardFilter>(initialFilter);

  const view = useMemo(() => {
    const cumulative = snapshot(monthsThrough(applied), daysThrough(applied));
    const current = periodTotals(applied);
    const selectedMonth = dashboardMonths.find((item) => item.period === filterMonth(applied));
    return {
      cumulative,
      current,
      expiringSoon: selectedMonth?.expiringSoon ?? 0,
      memberTrend: memberTrendData(applied),
      memberPeriod: memberPeriodData(applied),
      monthlyFinance: monthlyFinanceData(applied),
      dailyFinance: dailyFinanceData(applied),
    };
  }, [applied]);

  const inputType = draft.mode === "year" ? "number" : draft.mode;
  const inputBounds = draft.mode === "day"
    ? { min: "2026-09-01", max: "2026-09-30" }
    : draft.mode === "month"
      ? { min: "2025-10", max: "2026-09" }
      : { min: "2025", max: "2026" };
  const period = periodLabel(applied);

  const memberCards = [
    { label: "สมาชิกทั้งหมด (สะสม)", value: view.cumulative.totalMembers, tone: "text-blu-dark" },
    { label: "สมาชิกปัจจุบัน", value: view.cumulative.activeMembers, tone: "text-emerald-600" },
    { label: "สมาชิกที่พ้นสภาพ (สะสม)", value: view.cumulative.expiredMembers, tone: "text-rose-500" },
    { label: "สมาชิกเก่าที่ต่ออายุ (สะสม)", value: view.cumulative.renewals, tone: "text-blu-slate" },
    { label: `สมาชิกเก่าที่ต่ออายุ (${period})`, value: view.current.renewals, tone: "text-blu-slate" },
    { label: `สมาชิกใหม่ (${period})`, value: view.current.newMembers, tone: "text-emerald-600" },
    { label: `สมาชิกที่พ้นสภาพ (${period})`, value: view.current.expired, tone: "text-rose-500" },
    { label: "สมาชิกใกล้หมดอายุ (30 วัน)", value: view.expiringSoon, tone: "text-amber-500" },
  ];
  const financeCards = [
    { label: "รายได้สะสมทั้งหมด", value: view.cumulative.income, tone: "text-emerald-600" },
    { label: "รายจ่ายสะสมทั้งหมด", value: view.cumulative.expense, tone: "text-rose-500" },
    { label: "คงเหลือสุทธิสะสม", value: view.cumulative.income - view.cumulative.expense, tone: "text-blu-slate" },
    { label: `รายได้ (${period})`, value: view.current.income, tone: "text-emerald-600" },
    { label: `รายจ่าย (${period})`, value: view.current.expense, tone: "text-rose-500" },
    { label: `คงเหลือสุทธิ (${period})`, value: view.current.net, tone: view.current.net >= 0 ? "text-blu-slate" : "text-rose-500" },
  ];

  return (
    <div className="mx-auto max-w-375 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight text-blu-dark sm:text-2xl">
            {lang === "th" ? "ภาพรวมธุรกิจ" : "Business Overview"}
          </h1>
          <p className="mt-1 text-xs text-blu-steel">ข้อมูลจำลองสำหรับระบบหลังบ้าน</p>
        </div>
        <div className="hidden items-center gap-2 rounded-xl border border-blu-sky/40 bg-white px-3 py-2 text-[11px] font-semibold text-blu-steel sm:flex">
          <span className="h-2 w-2 rounded-full bg-blu-yellow" />
          ช่วงที่แสดง: {period}
        </div>
      </header>

      <section className="rounded-2xl border border-blu-sky/40 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1.5">
            <span className="block text-[10px] font-semibold text-blu-steel">มุมมอง</span>
            <select
              value={draft.mode}
              onChange={(event) => {
                const mode = event.target.value as ViewMode;
                setDraft({ mode, value: defaultValues[mode] });
              }}
              className="h-10 rounded-xl border border-blu-sky/50 bg-white px-3 text-xs font-semibold outline-none focus:border-blu-slate"
            >
              <option value="day">รายวัน</option>
              <option value="month">รายเดือน</option>
              <option value="year">รายปี</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="block text-[10px] font-semibold text-blu-steel">ช่วงเวลา</span>
            <input
              type={inputType}
              value={draft.value}
              min={inputBounds.min}
              max={inputBounds.max}
              onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
              className="h-10 rounded-xl border border-blu-sky/50 bg-white px-3 text-xs font-semibold outline-none focus:border-blu-slate"
            />
          </label>
          <button
            type="button"
            disabled={!draft.value}
            onClick={() => setApplied(draft)}
            className="btn-blue inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CalendarRange className="h-4 w-4" /> กรองข้อมูล
          </button>
          <p className="ml-auto text-[10px] text-blu-steel">ข้อมูลสะสมคำนวณถึงวันสิ้นสุดของช่วงที่เลือก</p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-blu-slate" />
          <h2 className="text-base font-black text-blu-dark">สมาชิก</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {memberCards.map((card) => <MetricCard key={card.label} {...card} />)}
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <AdminDashboardChart title="กราฟ 1 — สมาชิกปัจจุบัน / พ้นสภาพ / ต่ออายุสะสม" data={view.memberTrend} series={memberTrendSeries} type="line" />
          <AdminDashboardChart title="กราฟ 2 — ต่ออายุ / สมาชิกใหม่ / พ้นสภาพ" data={view.memberPeriod} series={memberPeriodSeries} type="bar" />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-blu-slate" />
          <h2 className="text-base font-black text-blu-dark">การเงิน</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {financeCards.map((card) => <MetricCard key={card.label} {...card} money />)}
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <AdminDashboardChart title={`กราฟ 3 — รายได้ / รายจ่าย / คงเหลือสุทธิ รายเดือน (${applied.mode === "year" ? applied.value : applied.value.slice(0, 4)})`} data={view.monthlyFinance} series={financeSeries} type="bar" valueFormatter={formatMoney} />
          <AdminDashboardChart title={`กราฟ 4 — รายได้ / รายจ่าย / คงเหลือสุทธิ รายวัน (${dailyFinanceMonth(applied)})`} data={view.dailyFinance} series={financeSeries} type="line" valueFormatter={formatMoney} />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-blu-sky/40 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-blu-sky/30 px-4 py-3.5 sm:px-5">
            <h2 className="text-sm font-black text-blu-dark">สมาชิกใกล้หมดอายุ</h2>
            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-500">{mockExpiringMembers.length} รายล่าสุด</span>
          </div>
          <ul className="divide-y divide-blu-sky/20">
            {mockExpiringMembers.map((member) => (
              <li key={member.id} className="flex items-center justify-between px-4 py-3 sm:px-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blu-navy to-blu-dark text-xs font-bold text-white">{member.fullName.slice(0, 1)}</div>
                  <div>
                    <div className="text-xs font-bold text-blu-dark">{member.fullName}</div>
                    <div className="font-mono text-[10px] text-blu-steel">{member.memberCode}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-xs font-black ${member.daysLeft <= 7 ? "text-rose-500" : "text-amber-500"}`}>{member.daysLeft} วัน</div>
                  <div className="text-[9px] text-blu-steel">คงเหลือ</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="overflow-hidden rounded-2xl border border-blu-sky/40 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-blu-sky/30 px-4 py-3.5 sm:px-5">
            <h2 className="text-sm font-black text-blu-dark">เช็คอินวันนี้</h2>
            <span className="rounded-full bg-blu-ice px-2 py-0.5 text-[10px] font-bold text-blu-slate">{mockTodayCheckins.length} ครั้ง</span>
          </div>
          <ul className="divide-y divide-blu-sky/20">
            {mockTodayCheckins.map((checkin) => (
              <li key={checkin.id} className="flex items-center justify-between px-4 py-3 sm:px-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-blu-sky/40 bg-blu-ice"><ScanLine className="h-3.5 w-3.5 text-blu-slate" /></div>
                  <div>
                    <div className="text-xs font-bold text-blu-dark">{checkin.fullName}</div>
                    <div className="font-mono text-[10px] text-blu-steel">{checkin.memberCode}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xs font-black text-blu-dark">{checkin.time}</div>
                  <div className="text-[9px] text-blu-slate">{checkin.scanner === "WEB_CAMERA" ? "กล้อง" : "เคาน์เตอร์"}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-blu-sky/40 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-blu-sky/30 px-4 py-3.5 sm:px-5">
          <h2 className="text-sm font-black text-blu-dark">ยอดขาย / ชำระเงินล่าสุด</h2>
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blu-slate">ดูทั้งหมด <ArrowRight className="h-3.5 w-3.5" /></span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-162.5 text-left">
            <thead><tr className="bg-blu-ice/50 text-[10px] uppercase tracking-wider text-blu-steel">
              <th className="px-5 py-2.5 font-semibold">สมาชิก</th><th className="px-4 py-2.5 font-semibold">แพ็กเกจ</th><th className="px-4 py-2.5 text-right font-semibold">ยอด</th><th className="px-4 py-2.5 text-right font-semibold">เวลา</th><th className="px-5 py-2.5 text-right font-semibold">สถานะ</th>
            </tr></thead>
            <tbody className="divide-y divide-blu-sky/20">
              {mockRecentSales.map((sale) => (
                <tr key={sale.id} className="text-xs">
                  <td className="px-5 py-3"><div className="font-bold text-blu-dark">{sale.memberName}</div><div className="font-mono text-[10px] text-blu-steel">{sale.memberCode}</div></td>
                  <td className="px-4 py-3 text-blu-steel">{sale.package}</td>
                  <td className="px-4 py-3 text-right font-black text-blu-dark">฿{formatMoney(sale.amount)}</td>
                  <td className="px-4 py-3 text-right font-mono text-blu-steel">{sale.time}</td>
                  <td className="px-5 py-3 text-right"><span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${sale.status === "APPROVED" ? "bg-emerald-500/10 text-emerald-600" : "bg-orange-500/10 text-orange-500"}`}>{sale.status === "APPROVED" ? "อนุมัติ" : "รอตรวจ"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, tone, money = false }: { label: string; value: number; tone: string; money?: boolean }) {
  return (
    <div className="rounded-2xl border border-blu-sky/40 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold leading-relaxed text-blu-steel sm:text-[11px]">{label}</p>
        {label.includes("หมดอายุ") && <AlarmClock className="h-4 w-4 shrink-0 text-amber-500" />}
      </div>
      <p className={`mt-2 text-xl font-black sm:text-2xl ${tone}`}>{money ? `${formatMoney(value)} ฿` : value.toLocaleString("th-TH")}</p>
    </div>
  );
}
