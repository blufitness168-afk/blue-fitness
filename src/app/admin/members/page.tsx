"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Search, UserRound, Users } from "lucide-react";
import AdminDashboardChart, { type ChartDatum, type ChartSeries } from "@/components/AdminDashboardCharts";
import {
  ADMIN_MEMBERS_EVENT,
  ADMIN_MEMBERS_KEY,
  combinedMembershipHistory,
  membershipStatus,
  readAdminMembers,
  type AdminMember,
} from "@/lib/admin-members";
import { MEMBER_ACCOUNT_EVENT, MEMBER_ACCOUNT_KEY } from "@/lib/member-account";

interface PeriodFilter {
  mode: "DAY" | "MONTH" | "YEAR" | "RANGE";
  value: string;
  from: string;
  to: string;
}

const initialPeriod: PeriodFilter = { mode: "MONTH", value: "2026-09", from: "2026-09-01", to: "2026-09-30" };
const chartSeries: ChartSeries[] = [
  { key: "newMembers", label: "สมาชิกสมัครใหม่", color: "#00a86b" },
  { key: "renewals", label: "สมาชิกเก่าต่ออายุ", color: "#3a728e" },
  { key: "expired", label: "สมาชิกพ้นสภาพ", color: "#e05545" },
];

function rangeOf(filter: PeriodFilter) {
  if (filter.mode === "DAY") return { from: filter.value, to: filter.value };
  if (filter.mode === "MONTH") {
    const [year, month] = filter.value.split("-").map(Number);
    const last = new Date(year, month, 0).getDate();
    return { from: `${filter.value}-01`, to: `${filter.value}-${String(last).padStart(2, "0")}` };
  }
  if (filter.mode === "YEAR") return { from: `${filter.value}-01-01`, to: `${filter.value}-12-31` };
  return { from: filter.from, to: filter.to };
}

function monthKeys(endDate: string) {
  const date = new Date(`${endDate.slice(0, 7)}-01T00:00:00Z`);
  return Array.from({ length: 6 }, (_, index) => {
    const current = new Date(date);
    current.setUTCMonth(current.getUTCMonth() - (5 - index));
    return current.toISOString().slice(0, 7);
  });
}

function latestMembership(member: AdminMember) {
  return combinedMembershipHistory(member)[0];
}

function roleLabel(role: AdminMember["role"]) {
  return { MEMBER: "สมาชิก", TRAINER: "เทรนเนอร์", STAFF: "พนักงาน", OTHER: "อื่นๆ" }[role];
}

function genderLabel(gender: AdminMember["gender"]) {
  return { MALE: "ชาย", FEMALE: "หญิง", OTHER: "อื่นๆ" }[gender];
}

function dateText(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export default function AdminMembersPage() {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [draftPeriod, setDraftPeriod] = useState(initialPeriod);
  const [period, setPeriod] = useState(initialPeriod);
  const [search, setSearch] = useState({ firstName: "", lastName: "", gender: "ALL", memberCode: "", phone: "", memberType: "ALL" });
  const [error, setError] = useState("");

  const load = useCallback(() => {
    try { setMembers(readAdminMembers()); setError(""); }
    catch (cause) { setMembers([]); setError(cause instanceof Error ? cause.message : "อ่านข้อมูลสมาชิกไม่สำเร็จ"); }
  }, []);

  useEffect(() => {
    // Browser-only mock stores are loaded after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const storage = (event: StorageEvent) => { if ([null, ADMIN_MEMBERS_KEY, MEMBER_ACCOUNT_KEY].includes(event.key)) load(); };
    window.addEventListener("storage", storage);
    window.addEventListener(ADMIN_MEMBERS_EVENT, load);
    window.addEventListener(MEMBER_ACCOUNT_EVENT, load);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener(ADMIN_MEMBERS_EVENT, load); window.removeEventListener(MEMBER_ACCOUNT_EVENT, load); };
  }, [load]);

  const range = rangeOf(period);
  const summaries = useMemo(() => {
    const histories = members.map((member) => ({ member, rows: combinedMembershipHistory(member) }));
    const newMembers = members.filter((member) => member.registeredAt >= range.from && member.registeredAt <= range.to).length;
    const renewals = histories.reduce((count, item) => count + item.rows.filter((row) => row.kind === "RENEWAL" && row.startedAt >= range.from && row.startedAt <= range.to).length, 0);
    const expired = histories.filter(({ member, rows }) => membershipStatus(member, range.to) === "EXPIRED" && rows.some((row) => row.expiresAt >= range.from && row.expiresAt <= range.to)).length;
    const reference = Date.parse(`${range.to}T00:00:00Z`);
    const expiring = histories.filter(({ member, rows }) => {
      if (membershipStatus(member, range.to) !== "ACTIVE") return false;
      const expiry = Math.max(...rows.map((row) => Date.parse(`${row.expiresAt}T00:00:00Z`)));
      const days = Math.ceil((expiry - reference) / 86_400_000);
      return days >= 1 && days <= 30;
    }).length;
    return { newMembers, renewals, expired, expiring };
  }, [members, range.from, range.to]);

  const chartData = useMemo<ChartDatum[]>(() => monthKeys(range.to).map((month) => {
    const histories = members.map((member) => combinedMembershipHistory(member));
    return {
      label: `${month.slice(5)}/${month.slice(2, 4)}`,
      values: {
        newMembers: members.filter((member) => member.registeredAt.startsWith(month)).length,
        renewals: histories.reduce((count, rows) => count + rows.filter((row) => row.kind === "RENEWAL" && row.startedAt.startsWith(month)).length, 0),
        expired: histories.filter((rows) => rows.some((row) => row.expiresAt.startsWith(month))).length,
      },
    };
  }), [members, range.to]);

  const filtered = useMemo(() => members.filter((member) => {
    const latest = latestMembership(member);
    return member.firstName.toLowerCase().includes(search.firstName.trim().toLowerCase()) &&
      member.lastName.toLowerCase().includes(search.lastName.trim().toLowerCase()) &&
      member.memberCode.toLowerCase().includes(search.memberCode.trim().toLowerCase()) &&
      member.phone.includes(search.phone.trim()) &&
      (search.gender === "ALL" || member.gender === search.gender) &&
      (search.memberType === "ALL" || latest?.packageName.includes(search.memberType));
  }), [members, search]);

  const applyPeriod = () => {
    const next = rangeOf(draftPeriod);
    if (!next.from || !next.to || next.from > next.to) { setError("ช่วงวันที่ไม่ถูกต้อง"); return; }
    setPeriod(draftPeriod); setError("");
  };

  const exportCsv = () => {
    const rows = filtered.map((member) => {
      const latest = latestMembership(member);
      return [member.firstName, member.lastName, member.registeredAt, latest?.packageName ?? "", latest?.timeSlot ?? "", genderLabel(member.gender), member.memberCode, member.phone, roleLabel(member.role), membershipStatus(member, range.to)];
    });
    const header = ["ชื่อ", "นามสกุล", "วันที่เริ่มสมัคร", "ประเภทสมาชิก", "ประเภทช่วงเวลา", "เพศ", "หมายเลขสมาชิก", "โทรศัพท์", "บทบาท", "สถานะสมาชิก"];
    const csv = `\ufeff${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "members.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  const summaryCards = [
    ["สมาชิกสมัครใหม่", summaries.newMembers, "text-emerald-600"],
    ["สมาชิกเก่าที่ต่ออายุ", summaries.renewals, "text-blu-slate"],
    ["สมาชิกที่พ้นสภาพ", summaries.expired, "text-rose-500"],
    ["สมาชิกใกล้หมดอายุ (30 วัน)", summaries.expiring, "text-amber-500"],
  ] as const;

  return <div className="mx-auto max-w-375 space-y-6">
    <header className="flex items-end justify-between"><div><h1 className="text-2xl font-black text-blu-dark">สมาชิก / เทรนเนอร์ / พนักงาน</h1><p className="mt-1 text-xs text-blu-steel">ค้นหา ติดตามสถานะ และเปิดดูประวัติรายบุคคล</p></div><button type="button" onClick={exportCsv} disabled={!filtered.length} className="btn-blue inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs disabled:opacity-50"><Download className="h-4 w-4" /> Export CSV</button></header>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-600">{error}</p>}

    <section className="rounded-2xl border border-blu-sky/40 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Field label="มุมมอง"><select className="member-input" value={draftPeriod.mode} onChange={(event) => { const mode = event.target.value as PeriodFilter["mode"]; const value = mode === "DAY" ? "2026-09-19" : mode === "YEAR" ? "2026" : "2026-09"; setDraftPeriod({ ...draftPeriod, mode, value }); }}><option value="DAY">รายวัน</option><option value="MONTH">รายเดือน</option><option value="YEAR">รายปี</option><option value="RANGE">ช่วงเวลา</option></select></Field>
        {draftPeriod.mode !== "RANGE" ? <Field label="ช่วงเวลา"><input className="member-input" type={draftPeriod.mode === "DAY" ? "date" : draftPeriod.mode === "MONTH" ? "month" : "number"} min={draftPeriod.mode === "YEAR" ? "2025" : undefined} max={draftPeriod.mode === "YEAR" ? "2026" : undefined} value={draftPeriod.value} onChange={(event) => setDraftPeriod({ ...draftPeriod, value: event.target.value })} /></Field> : <><Field label="จากวันที่"><input className="member-input" type="date" value={draftPeriod.from} onChange={(event) => setDraftPeriod({ ...draftPeriod, from: event.target.value })} /></Field><Field label="ถึงวันที่"><input className="member-input" type="date" value={draftPeriod.to} onChange={(event) => setDraftPeriod({ ...draftPeriod, to: event.target.value })} /></Field></>}
        <div className="flex items-end"><button type="button" onClick={applyPeriod} className="btn-blue h-10 w-full rounded-xl px-4 text-xs">กรองช่วงเวลา</button></div>
      </div>
    </section>

    <section className="rounded-2xl border border-blu-sky/40 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-8">
        <Field label="ชื่อ"><input className="member-input" value={search.firstName} onChange={(event) => setSearch({ ...search, firstName: event.target.value })} /></Field>
        <Field label="นามสกุล"><input className="member-input" value={search.lastName} onChange={(event) => setSearch({ ...search, lastName: event.target.value })} /></Field>
        <Field label="เพศ"><select className="member-input" value={search.gender} onChange={(event) => setSearch({ ...search, gender: event.target.value })}><option value="ALL">ทั้งหมด</option><option value="MALE">ชาย</option><option value="FEMALE">หญิง</option><option value="OTHER">อื่นๆ</option></select></Field>
        <Field label="หมายเลขสมาชิก"><input className="member-input" placeholder="BLU-…" value={search.memberCode} onChange={(event) => setSearch({ ...search, memberCode: event.target.value })} /></Field>
        <Field label="โทรศัพท์"><input className="member-input" value={search.phone} onChange={(event) => setSearch({ ...search, phone: event.target.value })} /></Field>
        <Field label="ประเภทสมาชิก"><select className="member-input" value={search.memberType} onChange={(event) => setSearch({ ...search, memberType: event.target.value })}><option value="ALL">ทั้งหมด</option><option value="รายวัน">รายวัน</option><option value="1 เดือน">รายเดือน</option><option value="3 เดือน">3 เดือน</option><option value="6 เดือน">6 เดือน</option><option value="1 ปี">12 เดือน</option></select></Field>
        <div className="col-span-2 flex items-end text-xs text-blu-steel"><Search className="mr-2 h-4 w-4" /> พบ {filtered.length} รายการ</div>
      </div>
    </section>

    <section className="space-y-3"><div className="flex items-center gap-2"><Users className="h-5 w-5 text-blu-slate" /><h2 className="font-black text-blu-dark">สรุปช่วง {dateText(range.from)} – {dateText(range.to)}</h2></div><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{summaryCards.map(([label, value, tone]) => <div key={label} className="rounded-2xl border border-blu-sky/40 bg-white p-4 shadow-sm"><p className="text-[11px] font-semibold text-blu-steel">{label}</p><p className={`mt-2 text-2xl font-black ${tone}`}>{value}</p></div>)}</div></section>
    <AdminDashboardChart title="สมาชิกสมัครใหม่ / ต่ออายุ / พ้นสภาพ รายเดือน (6 เดือนล่าสุด)" data={chartData} series={chartSeries} type="bar" />

    <section className="overflow-hidden rounded-2xl border border-blu-sky/40 bg-white shadow-sm"><div className="border-b border-blu-sky/30 px-5 py-4"><h2 className="font-black text-blu-dark">ประวัติสมาชิก</h2></div><div className="overflow-x-auto"><table className="w-full min-w-300 text-left text-xs"><thead><tr className="bg-blu-ice/60 text-[10px] text-blu-steel">{["ชื่อ-นามสกุล", "วันที่เริ่มสมัคร", "ประเภทสมาชิก", "ช่วงเวลา", "เพศ", "หมายเลขสมาชิก", "โทรศัพท์", "บทบาท", "สถานะ", ""].map((heading) => <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-blu-sky/20">{filtered.map((member) => { const latest = latestMembership(member); const status = membershipStatus(member, range.to); return <tr key={member.memberCode} className="hover:bg-blu-ice/30"><td className="px-4 py-3 font-bold">{member.firstName} {member.lastName}</td><td className="px-4 py-3">{dateText(member.registeredAt)}</td><td className="px-4 py-3">{latest?.packageName ?? "-"}</td><td className="px-4 py-3">{latest?.timeSlot ?? "-"}</td><td className="px-4 py-3">{genderLabel(member.gender)}</td><td className="px-4 py-3 font-mono">{member.memberCode}</td><td className="px-4 py-3">{member.phone}</td><td className="px-4 py-3">{roleLabel(member.role)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-600" : status === "EXPIRED" ? "bg-rose-500/10 text-rose-500" : "bg-amber-500/10 text-amber-600"}`}>{status === "ACTIVE" ? "ปัจจุบัน" : status === "EXPIRED" ? "พ้นสภาพ" : "รอดำเนินการ"}</span></td><td className="px-4 py-3"><Link href={`/admin/members/${member.memberCode}`} className="inline-flex items-center gap-1 whitespace-nowrap font-bold text-blu-slate hover:underline"><UserRound className="h-4 w-4" /> ดูประวัติ</Link></td></tr>; })}{!filtered.length && <tr><td colSpan={10} className="p-10 text-center text-blu-steel">ไม่พบสมาชิก</td></tr>}</tbody></table></div></section>
    <style jsx>{`.member-input { width: 100%; height: 2.5rem; border: 1px solid color-mix(in srgb, var(--blu-sky) 55%, transparent); border-radius: .75rem; background: white; padding: 0 .75rem; font-size: .75rem; outline: none; } .member-input:focus { border-color: var(--blu-slate); }`}</style>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="min-w-0 space-y-1.5"><span className="block text-[10px] font-semibold text-blu-steel">{label}</span>{children}</label>;
}
