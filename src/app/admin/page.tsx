"use client";

import {
  Users,
  ScanLine,
  DollarSign,
  AlarmClock,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
} from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import {
  mockKpis,
  mockExpiringMembers,
  mockTodayCheckins,
  mockRecentSales,
} from "@/lib/admin-mock";

const iconMap = {
  members: Users,
  checkin: ScanLine,
  sales: DollarSign,
  expiring: AlarmClock,
} as const;

function formatMoney(n: number) {
  return n.toLocaleString("th-TH");
}

export default function AdminDashboardPage() {
  const { lang } = useLanguage();

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-blu-dark tracking-tight">
            {lang === "th" ? "ภาพรวมระบบ" : "System Overview"}
          </h1>
          <p className="text-xs text-blu-steel mt-1">
            {lang === "th"
              ? "สรุปสถานะฟิตเนสแบบเรียลไทม์"
              : "Real-time fitness status summary"}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[11px] font-semibold text-blu-steel bg-white border border-blu-sky/40 px-3 py-2 rounded-xl">
          <span className="w-2 h-2 rounded-full bg-blu-yellow animate-pulse" />
          {lang === "th" ? "Live" : "Live"}
        </div>
      </header>

      {/* KPI Cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {mockKpis.map((kpi) => {
          const Icon = iconMap[kpi.icon];
          const label = lang === "th" ? kpi.label : kpi.labelEn;
          const value =
            kpi.unit === "฿"
              ? `฿${formatMoney(kpi.value)}`
              : kpi.value.toLocaleString();
          const up = kpi.trend === "up";

          return (
            <div
              key={kpi.id}
              className="rounded-2xl bg-white border border-blu-sky/40 shadow-sm p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="w-9 h-9 rounded-xl bg-blu-ice border border-blu-sky/40 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-blu-slate" />
                </div>
                <span
                  className={
                    "inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full " +
                    (up
                      ? "text-blu-yellow bg-blu-yellow/10"
                      : "text-rose-500 bg-rose-500/10")
                  }
                >
                  {up ? (
                    <ArrowUpRight className="w-3 h-3" />
                  ) : (
                    <ArrowDownRight className="w-3 h-3" />
                  )}
                  {kpi.delta}
                </span>
              </div>

              <div className="mt-3">
                <div className="text-xl sm:text-2xl font-black text-blu-dark leading-none truncate">
                  {value}
                </div>
                <div className="text-[10px] sm:text-[11px] text-blu-steel font-medium mt-1.5 leading-tight">
                  {label}
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* Expiring Soon + Today Check-ins */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Expiring Soon Members */}
        <div className="rounded-2xl bg-white border border-blu-sky/40 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-blu-sky/30 flex items-center justify-between">
            <h2 className="text-sm font-black text-blu-dark">
              {lang === "th" ? "สมาชิกใกล้หมดอายุ" : "Expiring Soon"}
            </h2>
            <span className="text-[10px] font-bold text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-full">
              {mockExpiringMembers.length} {lang === "th" ? "ราย" : "people"}
            </span>
          </div>
          <ul className="divide-y divide-blu-sky/20">
            {mockExpiringMembers.map((m) => {
              const daysLeft = m.daysLeft;
              return (
                <li
                  key={m.id}
                  className="px-4 sm:px-5 py-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blu-navy to-blu-dark text-white flex items-center justify-center text-xs font-bold shrink-0">
                      {m.fullName.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-blu-dark truncate">
                        {m.fullName}
                      </div>
                      <div className="text-[10px] text-blu-steel font-mono">
                        {m.memberCode}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={
                        "text-xs font-black " +
                        (daysLeft <= 7
                          ? "text-rose-500"
                          : "text-blu-yellow")
                      }
                    >
                      {daysLeft} {lang === "th" ? "วัน" : "d"}
                    </div>
                    <div className="text-[9px] text-blu-steel">
                      {lang === "th" ? "เหลือ" : "left"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Today Check-ins */}
        <div className="rounded-2xl bg-white border border-blu-sky/40 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-blu-sky/30 flex items-center justify-between">
            <h2 className="text-sm font-black text-blu-dark">
              {lang === "th" ? "เช็คอินวันนี้" : "Today's Check-ins"}
            </h2>
            <span className="text-[10px] font-bold text-blu-slate bg-blu-ice px-2 py-0.5 rounded-full">
              {mockTodayCheckins.length} {lang === "th" ? "ครั้ง" : "times"}
            </span>
          </div>
          <ul className="divide-y divide-blu-sky/20">
            {mockTodayCheckins.map((c) => (
              <li
                key={c.id}
                className="px-4 sm:px-5 py-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blu-ice border border-blu-sky/40 flex items-center justify-center">
                    <ScanLine className="w-3.5 h-3.5 text-blu-slate" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-blu-dark truncate">
                      {c.fullName}
                    </div>
                    <div className="text-[10px] text-blu-steel font-mono">
                      {c.memberCode}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-black text-blu-dark font-mono">
                    {c.time}
                  </div>
                  <div className="text-[9px] text-blu-slate">
                    +{c.points} pt
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Recent Sales */}
      <section className="rounded-2xl bg-white border border-blu-sky/40 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-blu-sky/30 flex items-center justify-between">
          <h2 className="text-sm font-black text-blu-dark">
            {lang === "th" ? "ยอดขาย / ชำระเงินล่าสุด" : "Recent Sales / Payments"}
          </h2>
          <LinkGo />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[560px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-blu-steel bg-blu-ice/50">
                <th className="px-4 sm:px-5 py-2.5 font-semibold">
                  {lang === "th" ? "สมาชิก" : "Member"}
                </th>
                <th className="px-4 py-2.5 font-semibold">
                  {lang === "th" ? "แพ็กเกจ" : "Package"}
                </th>
                <th className="px-4 py-2.5 font-semibold text-right">
                  {lang === "th" ? "ยอด" : "Amount"}
                </th>
                <th className="px-4 py-2.5 font-semibold text-right">
                  {lang === "th" ? "เวลา" : "Time"}
                </th>
                <th className="px-4 sm:px-5 py-2.5 font-semibold text-right">
                  {lang === "th" ? "สถานะ" : "Status"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blu-sky/20">
              {mockRecentSales.map((s) => (
                <tr key={s.id} className="text-xs">
                  <td className="px-4 sm:px-5 py-3">
                    <div className="font-bold text-blu-dark">{s.memberName}</div>
                    <div className="text-[10px] text-blu-steel font-mono">
                      {s.memberCode}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-blu-steel">{s.package}</td>
                  <td className="px-4 py-3 text-right font-black text-blu-dark">
                    ฿{formatMoney(s.amount)}
                  </td>
                  <td className="px-4 py-3 text-right text-blu-steel font-mono">
                    {s.time}
                  </td>
                  <td className="px-4 sm:px-5 py-3 text-right">
                    <span
                      className={
                        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold " +
                        (s.status === "APPROVED"
                          ? "bg-blu-yellow/15 text-blu-yellow"
                          : "bg-orange-500/10 text-orange-500")
                      }
                    >
                      {s.status === "APPROVED"
                        ? lang === "th"
                          ? "อนุมัติ"
                          : "Approved"
                        : lang === "th"
                        ? "รอตรวจ"
                        : "Pending"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function LinkGo() {
  const { lang } = useLanguage();
  return (
    <a className="inline-flex items-center gap-1 text-[11px] font-bold text-blu-slate hover:text-blu-dark transition-colors">
      {lang === "th" ? "ดูทั้งหมด" : "View all"}
      <ArrowRight className="w-3.5 h-3.5" />
    </a>
  );
}
