"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, LogIn, LogOut } from "lucide-react";
import AdminDashboardChart, { type ChartSeries } from "@/components/AdminDashboardCharts";
import AdminScanner from "@/components/AdminScanner";
import {
  ADMIN_MEMBERS_EVENT,
  ADMIN_MEMBERS_KEY,
  combinedMembershipHistory,
  readAdminMembers,
  type AdminMember,
} from "@/lib/admin-members";
import { readServiceRecords, saveServiceRecord, SERVICE_EVENT, SERVICE_STORAGE_KEY, type ServiceRecord } from "@/lib/admin-service";
import { CHECKIN_STORAGE_KEY, createDemoMembers, evaluateCheckin, type CheckinResult } from "@/lib/checkin";

const hourlySeries: ChartSeries[] = [{ key: "usage", label: "จำนวนการเข้าใช้บริการ", color: "#3a728e" }];
const initialFilters = { memberCode: "ALL", from: "2026-09-01T00:00", to: "2026-09-30T23:59" };

function toBangkokIso(value: string) {
  return `${value}:00+07:00`;
}

function dateText(value: string) {
  return new Date(value).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bangkok" });
}

function timeText(value: string) {
  return new Date(value).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function selectedMembership(member?: AdminMember) {
  return member ? combinedMembershipHistory(member)[0] : undefined;
}

export default function CheckinPage() {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [scanResult, setScanResult] = useState<CheckinResult | null>(null);
  const [autoScanEnabled, setAutoScanEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const processing = useRef(false);

  const load = useCallback(() => {
    try { setMembers(readAdminMembers()); setRecords(readServiceRecords()); setError(""); }
    catch (cause) { setRecords([]); setError(cause instanceof Error ? cause.message : "อ่านประวัติใช้บริการไม่สำเร็จ"); }
  }, []);

  useEffect(() => {
    // Browser-only mock stores are loaded after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const storage = (event: StorageEvent) => { if ([null, ADMIN_MEMBERS_KEY, SERVICE_STORAGE_KEY, CHECKIN_STORAGE_KEY].includes(event.key)) load(); };
    window.addEventListener("storage", storage);
    window.addEventListener(ADMIN_MEMBERS_EVENT, load);
    window.addEventListener(SERVICE_EVENT, load);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener(ADMIN_MEMBERS_EVENT, load); window.removeEventListener(SERVICE_EVENT, load); };
  }, [load]);

  const filtered = useMemo(() => {
    const from = Date.parse(toBangkokIso(filters.from));
    const to = Date.parse(toBangkokIso(filters.to));
    return records.filter((record) => (filters.memberCode === "ALL" || record.memberCode === filters.memberCode) && Date.parse(record.occurredAt) >= from && Date.parse(record.occurredAt) <= to);
  }, [records, filters]);

  const checkins = useMemo(() => filtered.filter((record) => record.serviceType === "CHECKIN"), [filtered]);
  const periods = useMemo(() => {
    let morning = 0; let evening = 0;
    for (const record of checkins) {
      const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Bangkok" }).format(new Date(record.occurredAt)));
      if (hour >= 7 && hour < 14) morning++;
      else if (hour >= 14 && hour <= 22) evening++;
    }
    return { morning, evening, total: morning + evening };
  }, [checkins]);
  const hourlyData = useMemo(() => Array.from({ length: 24 }, (_, hour) => ({
    label: String(hour).padStart(2, "0"),
    values: { usage: checkins.filter((record) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Bangkok" }).format(new Date(record.occurredAt))) === hour).length },
  })), [checkins]);


  const scan = useCallback(async (code: string) => {
    if (processing.current) return;
    processing.current = true; setBusy(true); setNotice("");
    try {
      if (!navigator.locks?.request) throw new Error("ต้องใช้ Web Locks ผ่าน HTTPS หรือ localhost");
      await navigator.locks.request(SERVICE_STORAGE_KEY, { mode: "exclusive" }, () => {
        const now = new Date();
        const normalized = code.trim().toUpperCase();
                const member = members.find((item) => item.memberCode === normalized || item.cardNumber === normalized);
                const memberRecords = readServiceRecords().filter((record) => record.memberCode === member?.memberCode);
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
        const todayRecords = memberRecords.filter((record) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(record.occurredAt)) === today).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
        const nextType: ServiceRecord["serviceType"] = todayRecords[0]?.serviceType === "CHECKIN" ? "CHECKOUT" : "CHECKIN";
        const decision = evaluateCheckin(code, createDemoMembers(now), [], now, "USB_MANUAL", crypto.randomUUID());
        if (!decision.member || decision.status !== "success") { setScanResult(decision); return; }
        const membership = selectedMembership(member);
        if (!membership) throw new Error("ไม่พบแพ็กเกจสมาชิก");
        saveServiceRecord({ memberCode: decision.member.memberCode, memberName: decision.member.fullName, occurredAt: now.toISOString(), membershipType: membership.packageName, timeSlot: membership.timeSlot, serviceType: nextType, note: "สแกนอัตโนมัติ" }, "SCANNER");
        setScanResult({ ...decision, title: nextType === "CHECKIN" ? "เข้าใช้บริการสำเร็จ" : "ออกจากบริการสำเร็จ", message: `ระบบบันทึก${nextType === "CHECKIN" ? "เข้า" : "ออก"}อัตโนมัติจากประวัติวันนี้`, record: { ...decision.record!, checkedAt: now.toISOString() } });

      });
      load();
    } catch (cause) { setScanResult({ status: "error", title: "ยังไม่บันทึกการเข้า-ออก", message: cause instanceof Error ? cause.message : "บันทึกไม่ได้" }); }
    finally { processing.current = false; setBusy(false); }
  }, [load, members]);

  const exportCsv = () => {
    const header = ["วันที่", "เวลา", "ประเภทบริการ", "รหัสสมาชิก", "สมาชิก", "ประเภทสมาชิก", "ช่วงเวลา", "หมายเหตุ"];
    const rows = filtered.map((record) => [dateText(record.occurredAt), timeText(record.occurredAt), record.serviceType === "CHECKIN" ? "เข้ายิม" : "ออกยิม", record.memberCode, record.memberName, record.membershipType, record.timeSlot, record.note]);
    const csv = `\ufeff${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "service-history.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  return <div className="mx-auto max-w-375 space-y-6">
    <header className="flex items-end justify-between"><div><h1 className="text-2xl font-black text-blu-dark">เช็กอินหน้าร้าน</h1><p className="mt-1 text-xs text-blu-steel">บันทึกการเข้า-ออก ตรวจสอบการใช้บริการ และดูสถิติสมาชิก</p></div><button type="button" onClick={exportCsv} disabled={!filtered.length} className="btn-blue inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs disabled:opacity-50"><Download className="h-4 w-4" /> Export CSV</button></header>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-600">{error}</p>}{notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">{notice}</p>}


    <section className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm"><h2 className="font-black text-blu-dark">1. สแกนและบันทึกการเข้า-ออก</h2><p className="mt-1 text-xs text-blu-steel">เปิด Scanner แล้วกรอกรหัสสมาชิก ระบบจะเลือกบันทึกเข้า/ออกจากประวัติของวันนี้ให้อัตโนมัติ</p><div className="mt-4 grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border border-blu-sky/40 bg-blu-ice/30 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-bold text-blu-dark">เช็กอิน / เช็กเอาท์อัตโนมัติ</h3>{autoScanEnabled && <div className="flex items-center gap-3"><span className="inline-flex items-center gap-2 text-xs font-bold text-emerald-600"><span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />กำลังทำงาน</span><button type="button" className="text-xs font-bold text-blu-steel underline" onClick={() => setAutoScanEnabled(false)} disabled={busy}>หยุด</button></div>}</div><p className="mt-1 text-xs text-blu-steel">กรอกรหัสสมาชิกหรือเลขบัตร แล้วระบบจะดูประวัติของวันนี้เพื่อเลือกเข้า/ออกให้เอง</p>{autoScanEnabled ? <AdminScanner label="ช่องรับรหัสเครื่องสแกนสมาชิก" disabled={busy} autoFocus onScan={scan} /> : <button type="button" className="btn-blue mt-4 rounded-xl px-5 py-2 text-xs font-bold" disabled={busy} onClick={() => setAutoScanEnabled(true)}>เปิด Auto Scan</button>}</div><div aria-live="polite" className={`rounded-xl border p-4 ${scanResult?.status === "success" ? "border-emerald-200 bg-emerald-50" : scanResult?.status === "warning" ? "border-amber-200 bg-amber-50" : scanResult ? "border-rose-200 bg-rose-50" : "border-blu-sky/40 bg-blu-ice/50"}`}><h3 className="font-black">{scanResult?.title ?? "รอสแกนสมาชิก"}</h3><p className="mt-1 text-xs text-blu-steel">{scanResult?.message ?? "ระบบจะตรวจช่วงเวลา วันหมดอายุ และประวัติวันนี้ก่อนบันทึก"}</p></div></div></section>

    <section className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm"><h2 className="mb-4 font-black text-blu-dark">2. กราฟสรุปการใช้บริการ</h2><div className="grid gap-4 xl:grid-cols-2"><DonutChart morning={periods.morning} evening={periods.evening} total={periods.total} /><AdminDashboardChart title="จำนวนการเข้าใช้บริการตามชั่วโมง (24 ชั่วโมง)" data={hourlyData} series={hourlySeries} type="line" /></div></section>

    <section className="overflow-hidden rounded-2xl border border-blu-sky/40 bg-white shadow-sm"><div className="border-b border-blu-sky/30 px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-black text-blu-dark">3. ประวัติการใช้บริการ</h2><p className="mt-1 text-[10px] text-blu-steel">ทั้งหมด {filtered.length} รายการ · เข้ายิม {checkins.length} ครั้ง</p></div><span className="rounded-full bg-blu-ice px-3 py-1 text-[10px] font-bold text-blu-slate">ใช้ตัวกรองเพื่อค้นหารายการ</span></div><div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]"><Field label="หมายเลขสมาชิก"><select className="service-input" value={draftFilters.memberCode} onChange={(event) => setDraftFilters({ ...draftFilters, memberCode: event.target.value })}><option value="ALL">ทั้งหมด</option>{members.map((member) => <option key={member.memberCode} value={member.memberCode}>{member.memberCode} · {member.firstName} {member.lastName}</option>)}</select></Field><Field label="จากวันที่-เวลา"><input type="datetime-local" className="service-input" value={draftFilters.from} onChange={(event) => setDraftFilters({ ...draftFilters, from: event.target.value })} /></Field><Field label="ถึงวันที่-เวลา"><input type="datetime-local" className="service-input" value={draftFilters.to} onChange={(event) => setDraftFilters({ ...draftFilters, to: event.target.value })} /></Field><div className="flex items-end"><button type="button" onClick={() => draftFilters.from <= draftFilters.to ? (setFilters(draftFilters), setError("")) : setError("ช่วงวันที่ไม่ถูกต้อง")} className="btn-blue h-10 rounded-xl px-5 text-xs">กรองข้อมูล</button></div></div></div><div className="overflow-x-auto"><table className="w-full min-w-275 text-left text-xs"><thead><tr className="bg-blu-ice/60 text-[10px] text-blu-steel">{["วันที่", "เวลา", "ประเภทบริการ", "สมาชิก", "ประเภทสมาชิก", "ช่วงเวลา", "หมายเหตุ"].map((heading) => <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-blu-sky/20">{filtered.map((record) => <tr key={record.id} className="hover:bg-blu-ice/30"><td className="px-4 py-3">{dateText(record.occurredAt)}</td><td className="px-4 py-3 font-mono">{timeText(record.occurredAt)}</td><td className="px-4 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${record.serviceType === "CHECKIN" ? "bg-emerald-500/10 text-emerald-600" : "bg-blu-ice text-blu-slate"}`}>{record.serviceType === "CHECKIN" ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}{record.serviceType === "CHECKIN" ? "เข้ายิม" : "ออกยิม"}</span></td><td className="px-4 py-3"><strong>{record.memberName}</strong><span className="block font-mono text-[9px] text-blu-steel">{record.memberCode}</span></td><td className="px-4 py-3">{record.membershipType}</td><td className="px-4 py-3">{record.timeSlot}</td><td className="max-w-65 px-4 py-3 text-blu-steel">{record.note || "-"}</td></tr>)}{!filtered.length && <tr><td colSpan={7} className="p-10 text-center text-blu-steel">ไม่พบประวัติ</td></tr>}</tbody></table></div></section>
    <style jsx>{`.service-input { width: 100%; height: 2.5rem; border: 1px solid color-mix(in srgb, var(--blu-sky) 55%, transparent); border-radius: .75rem; background: white; padding: 0 .75rem; font-size: .75rem; outline: none; } .service-input:focus { border-color: var(--blu-slate); }`}</style>
  </div>;
}

function DonutChart({ morning, evening, total }: { morning: number; evening: number; total: number }) {
  const morningPercent = total ? Math.round((morning / total) * 100) : 0;
  return <div className="rounded-2xl border border-blu-sky/30 bg-blu-ice/20 p-4"><h3 className="text-sm font-black text-blu-dark">กราฟวงกลม — ช่วงเวลาที่ใช้บริการ</h3><div className="mt-5 flex items-center justify-center gap-10"><div className="relative h-52 w-52 shrink-0 rounded-full" style={{ background: `conic-gradient(#3a728e 0 ${morningPercent}%, #ffd700 ${morningPercent}% 100%)` }}><div className="absolute inset-10 flex flex-col items-center justify-center rounded-full bg-white"><strong className="text-2xl text-blu-dark">{total}</strong><span className="text-[10px] text-blu-steel">ครั้ง</span></div></div><div className="space-y-4 text-xs"><Legend color="#3a728e" label="07:00–14:00" value={`${morning} (${morningPercent}%)`} /><Legend color="#ffd700" label="14:00–22:00" value={`${evening} (${total ? 100 - morningPercent : 0}%)`} /></div></div></div>;
}
function Legend({ color, label, value }: { color: string; label: string; value: string }) { return <div><p className="flex items-center gap-2 font-semibold"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />{label}</p><strong className="ml-5 text-lg text-blu-dark">{value}</strong></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="min-w-0 space-y-1.5"><span className="block text-[10px] font-semibold text-blu-steel">{label}</span>{children}</label>; }
