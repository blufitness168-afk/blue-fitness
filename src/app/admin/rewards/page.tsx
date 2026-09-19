"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Gift, History, PackageCheck, Pencil, Plus, Power, RefreshCw, Search, X } from "lucide-react";
import { buttonClass, inputClass, MockNotice, panelClass } from "@/components/AdminScanner";
import type { RedemptionRecord } from "@/lib/admin-mock";
import { combinedMembershipHistory, readAdminMembers, type AdminMember } from "@/lib/admin-members";
import { confirmDeskAction, DESK_UPDATED_EVENT, lookupRewardCode, readDeskRewards, type DeskAction } from "@/lib/front-desk";
import { newReward, readRewardCatalog, remainingStock, saveReward } from "@/lib/reward-catalog";
import type { RewardItem } from "@/lib/mock-data";

type StatusFilter = "ALL" | RedemptionRecord["status"];
type CatalogStatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
type HistoryFilters = {
  memberCode: string;
  memberType: string;
  rewardId: string;
  status: StatusFilter;
  rewardCode: string;
};
type CatalogFilters = { query: string; status: CatalogStatusFilter };

const initialFilters: HistoryFilters = {
  memberCode: "",
  memberType: "ALL",
  rewardId: "ALL",
  status: "PENDING",
  rewardCode: "",
};
const initialCatalogFilters: CatalogFilters = { query: "", status: "ALL" };

function dateText(value: string) {
  return new Date(value).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bangkok" });
}

function timeText(value: string) {
  return new Date(value).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}

function memberType(member?: AdminMember) {
  const name = member ? combinedMembershipHistory(member)[0]?.packageName ?? "" : "";
  if (name.includes("รายวัน")) return "DAILY";
  if (name.includes("1 เดือน")) return "MONTHLY";
  if (name.includes("3 เดือน")) return "3_MONTHS";
  if (name.includes("6 เดือน")) return "6_MONTHS";
  if (name.includes("1 ปี")) return "12_MONTHS";
  return "OTHER";
}

function memberTypeLabel(member?: AdminMember) {
  return { DAILY: "รายวัน", MONTHLY: "รายเดือน", "3_MONTHS": "3 เดือน", "6_MONTHS": "6 เดือน", "12_MONTHS": "12 เดือน", OTHER: "อื่นๆ" }[memberType(member)];
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export default function AdminRewardsPage() {
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [records, setRecords] = useState<RedemptionRecord[]>([]);
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [filters, setFilters] = useState<HistoryFilters>({ ...initialFilters });
  const [catalogFilters, setCatalogFilters] = useState<CatalogFilters>({ ...initialCatalogFilters });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<RewardItem | null>(null);
  const [expected, setExpected] = useState<RewardItem | null>(null);
  const [action, setAction] = useState<DeskAction | null>(null);
  const [statusTarget, setStatusTarget] = useState<RewardItem | null>(null);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);

  const refresh = useCallback(() => {
    try {
      setRewards(readRewardCatalog());
      setRecords(readDeskRewards());
      setMembers(readAdminMembers());
      setReady(true);
      setError("");
    } catch (cause) {
      setRewards([]);
      setRecords([]);
      setMembers([]);
      setReady(false);
      setError(cause instanceof Error ? cause.message : "อ่านข้อมูลไม่ได้");
    }
  }, []);

  useEffect(() => {
    // Browser-only mock stores are loaded after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(DESK_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(DESK_UPDATED_EVENT, refresh);
    };
  }, [refresh]);

  function cancelAction() {
    setAction(null);
    setStatusTarget(null);
  }

  async function run(operation: () => Promise<string>) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setMessage("");
    try {
      setMessage(await operation());
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "ทำรายการไม่ได้");
    } finally {
      writing.current = false;
      setBusy(false);
      cancelAction();
      refresh();
    }
  }

  function openHistoryAction(record: RedemptionRecord) {
    if (writing.current || !ready) return;
    try {
      setAction(lookupRewardCode(record.rewardCode));
      setMessage("");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "เปิดรายการยืนยันไม่ได้");
    }
  }

  const memberMap = useMemo(() => new Map(members.map((member) => [member.memberCode, member])), [members]);
  const historyFiltered = useMemo(() => records.filter((record) => {
    const type = memberType(memberMap.get(record.memberCode));
    const memberQuery = filters.memberCode.trim().toLowerCase();
    const rewardCode = filters.rewardCode.trim().toLowerCase();
    return (!memberQuery || `${record.memberCode} ${record.memberName}`.toLowerCase().includes(memberQuery)) &&
      (filters.memberType === "ALL" || type === filters.memberType) &&
      (filters.rewardId === "ALL" || record.rewardId === Number(filters.rewardId)) &&
      (filters.status === "ALL" || record.status === filters.status) &&
      (!rewardCode || record.rewardCode.toLowerCase().includes(rewardCode));
  }).sort((a, b) => Date.parse(b.redeemedAt) - Date.parse(a.redeemedAt)), [records, filters, memberMap]);
  const catalogRewards = useMemo(() => {
    const query = catalogFilters.query.trim().toLowerCase();
    return rewards.filter((reward) => (!query || reward.title.toLowerCase().includes(query)) &&
      (catalogFilters.status === "ALL" || (catalogFilters.status === "ACTIVE" ? reward.isActive : !reward.isActive)));
  }, [catalogFilters, rewards]);
  const pendingRecords = historyFiltered.filter((record) => record.status === "PENDING");
  const completedRecords = historyFiltered.filter((record) => record.status === "COMPLETED");
  const disabled = busy || !!action || !!statusTarget || !ready;

  const exportCsv = () => {
    const header = ["วันที่แลก", "เวลา", "หมายเลขสมาชิก", "ชื่อ-นามสกุล", "ประเภทสมาชิก", "ของรางวัล", "รหัสของรางวัล", "แต้มที่ใช้", "สถานะ", "วันที่รับ"];
    const rows = historyFiltered.map((record) => [dateText(record.redeemedAt), timeText(record.redeemedAt), record.memberCode, record.memberName, memberTypeLabel(memberMap.get(record.memberCode)), record.rewardTitle, record.rewardCode, record.pointsSpent, record.status === "PENDING" ? "รอรับของ" : "รับแล้ว", record.completedAt ? `${dateText(record.completedAt)} ${timeText(record.completedAt)}` : ""]);
    const csv = `\ufeff${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "reward-redemptions.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <div className="mx-auto max-w-375 space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blu-steel">Reward management</p>
        <h1 className="mt-1 text-2xl font-black text-blu-dark">จัดการของรางวัล</h1>
        <p className="mt-1 text-xs text-blu-steel">ตรวจสอบรายการรอรับของ และจัดการคลังของรางวัล</p>
      </div>
      <button type="button" className={`${buttonClass} inline-flex items-center`} disabled={busy} onClick={refresh}><RefreshCw className="mr-1 h-4 w-4" /> โหลดใหม่</button>
    </header>

    <MockNotice />
    <p className="text-xs text-blu-steel">รายการแลกจาก <Link className="font-bold underline" href="/member/rewards">ร้านรางวัลฝั่งสมาชิก</Link> จะเข้ามาอยู่ในประวัติสถานะ “รอรับของ” จนกว่าพนักงานจะยืนยันส่งมอบ</p>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-blu-sky/40 bg-blu-sky/20 p-4 text-sm">{message}</p>}

    <section id="reward-history" className="rounded-3xl border border-blu-sky/50 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-blu-dark"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blu-yellow/20 text-blu-dark"><History className="h-5 w-5" /></span><h2 className="text-lg font-black">1. ประวัติการรับของ</h2></div>
          <p className="mt-2 text-xs text-blu-steel">รายการจะแสดง “รอรับของ” เป็นค่าเริ่มต้น พนักงานกดยืนยันเมื่อส่งมอบให้ลูกค้าแล้ว</p>
        </div>
        <button type="button" className={`${buttonClass} inline-flex items-center gap-1`} disabled={!historyFiltered.length} onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</button>
      </div>

      <div className="mt-5 rounded-2xl border border-blu-sky/40 bg-blu-ice/35 p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Field label="สมาชิก / ชื่อ"><input className={inputClass} value={filters.memberCode} onChange={(event) => setFilters({ ...filters, memberCode: event.target.value })} placeholder="BLU-… หรือชื่อ" /></Field><Field label="ประเภทสมาชิก"><select className={inputClass} value={filters.memberType} onChange={(event) => setFilters({ ...filters, memberType: event.target.value })}><option value="ALL">ทั้งหมด</option><option value="DAILY">รายวัน</option><option value="MONTHLY">รายเดือน</option><option value="3_MONTHS">3 เดือน</option><option value="6_MONTHS">6 เดือน</option><option value="12_MONTHS">12 เดือน</option><option value="OTHER">อื่นๆ</option></select></Field><Field label="ชื่อของรางวัล"><select className={inputClass} value={filters.rewardId} onChange={(event) => setFilters({ ...filters, rewardId: event.target.value })}><option value="ALL">ทั้งหมด</option>{rewards.map((reward) => <option key={reward.id} value={reward.id}>{reward.title}</option>)}</select></Field><Field label="สถานะ"><select className={inputClass} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value as StatusFilter })}><option value="PENDING">รอรับของ</option><option value="COMPLETED">รับแล้ว</option><option value="ALL">ทั้งหมด</option></select></Field><Field label="รหัสการแลก"><input className={inputClass} value={filters.rewardCode} onChange={(event) => setFilters({ ...filters, rewardCode: event.target.value })} placeholder="BLU-RW-…" /></Field></div><button type="button" onClick={() => setFilters({ ...initialFilters })} className="mt-3 text-xs font-bold text-blu-slate underline">คืนค่าตัวกรองเริ่มต้น</button></div>

      <div className="mt-4 grid grid-cols-2 gap-3"><Summary icon={Gift} label="รอรับของ" value={pendingRecords.length} tone="text-amber-500" /><Summary icon={PackageCheck} label="รับแล้ว" value={completedRecords.length} tone="text-emerald-600" /></div>
      <div className="mt-4"><RedemptionTable records={historyFiltered} memberMap={memberMap} disabled={disabled} onConfirm={openHistoryAction} /></div>
    </section>

    <section id="reward-catalog" className="rounded-3xl border border-blu-sky/50 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-blu-dark"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blu-sky/20 text-blu-slate"><PackageCheck className="h-5 w-5" /></span><h2 className="text-lg font-black">2. ตารางของรางวัล</h2></div>
          <p className="mt-2 text-xs text-blu-steel">จัดการชื่อ รูป แต้ม สต็อก และสถานะของรางวัลที่เปิดให้สมาชิกแลก</p>
        </div>
        <button type="button" className={`${buttonClass} inline-flex items-center gap-1`} disabled={disabled} onClick={() => { try { setExpected(null); setDraft(newReward()); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "อ่านคลังรางวัลไม่ได้"); } }}><Plus className="h-4 w-4" /> เพิ่มรางวัล</button>
      </div>

      <div className="mt-5 rounded-2xl border border-blu-sky/40 bg-blu-ice/35 p-4"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"><Field label="ค้นหาชื่อของรางวัล"><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-blu-steel" /><input className={`${inputClass} pl-9`} value={catalogFilters.query} onChange={(event) => setCatalogFilters({ ...catalogFilters, query: event.target.value })} placeholder="ค้นหาของรางวัล" /></div></Field><Field label="สถานะ"><select className={inputClass} value={catalogFilters.status} onChange={(event) => setCatalogFilters({ ...catalogFilters, status: event.target.value as CatalogStatusFilter })}><option value="ALL">ทั้งหมด</option><option value="ACTIVE">เปิดใช้งาน</option><option value="INACTIVE">ปิดใช้งาน</option></select></Field><button type="button" className="h-10 text-xs font-bold text-blu-slate underline" onClick={() => setCatalogFilters({ ...initialCatalogFilters })}>ล้างตัวกรอง</button></div></div>

      {draft && <form className={`${panelClass} mt-4 border-2 border-blu-sky/50`} onSubmit={(event) => { event.preventDefault(); void run(async () => { await saveReward({ ...draft, titleEn: draft.title }, expected); setDraft(null); setExpected(null); return "บันทึกคลังรางวัลแล้ว"; }); }}><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{expected ? "แก้ไขรางวัล" : "เพิ่มรางวัล"}</h3><p className="mt-1 text-xs text-blu-steel">บันทึกแล้วจะใช้ร่วมกับร้านรางวัลฝั่งสมาชิกทันที</p></div><button type="button" className="rounded-lg p-1 text-blu-steel hover:bg-blu-ice" onClick={() => { setDraft(null); setExpected(null); }} aria-label="ปิดฟอร์ม"><X className="h-4 w-4" /></button></div><fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2"><Field label="ชื่อ"><input className={inputClass} required maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><Field label="รูป (HTTPS URL)"><input type="url" className={inputClass} required value={draft.imageUrl} onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })} /></Field><Field label="แต้มที่ใช้"><input className={inputClass} required type="number" min={1} max={1000000} step={1} value={draft.pointCost} onChange={(event) => setDraft({ ...draft, pointCost: Number(event.target.value) })} /></Field><Field label="สต็อกรวม"><input className={inputClass} required type="number" min={0} max={1000000} step={1} value={draft.stock} onChange={(event) => setDraft({ ...draft, stock: Number(event.target.value) })} /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />เปิดให้แลกใหม่</label><p className="text-xs text-blu-steel">รูปโหลดจาก URL โดยตรง ไม่ควรใส่ URL ที่มีข้อมูลลับ</p><div className="flex gap-2 sm:col-span-2"><button type="submit" className={`${buttonClass} inline-flex items-center gap-1`}><Pencil className="h-4 w-4" /> บันทึก</button><button type="button" className={buttonClass} onClick={() => { setDraft(null); setExpected(null); }}>ยกเลิก</button></div></fieldset></form>}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-blu-sky/40"><table className="w-full min-w-160 text-left text-sm"><thead><tr className="bg-blu-ice/60">{["รูป / ชื่อ", "แต้ม", "สต็อกรวม / คงเหลือ", "สถานะ", "จัดการ"].map((heading) => <th key={heading} className="p-3 text-xs text-blu-steel">{heading}</th>)}</tr></thead><tbody>{catalogRewards.map((reward) => <tr key={reward.id} className="border-t border-blu-sky/30"><td className="p-3"><div className="flex items-center gap-3"><Image unoptimized src={reward.imageUrl} width={48} height={48} alt={reward.title} className="h-12 w-12 rounded-xl object-cover" /><strong>{reward.title}</strong></div></td><td className="p-3 font-bold">{reward.pointCost.toLocaleString()}</td><td className="p-3">{reward.stock.toLocaleString()} / {remainingStock(reward, records).toLocaleString()}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${reward.isActive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>{reward.isActive ? "เปิด" : "ปิด"}</span></td><td className="p-3"><div className="flex flex-wrap gap-2"><button type="button" className={`${buttonClass} inline-flex items-center gap-1`} disabled={disabled} onClick={() => { setExpected(reward); setDraft({ ...reward }); }}><Pencil className="h-3.5 w-3.5" /> แก้ไข</button><button type="button" className={`${buttonClass} inline-flex items-center gap-1`} disabled={disabled} onClick={() => { setStatusTarget(reward); setMessage(""); }}><Power className="h-3.5 w-3.5" /> {reward.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}</button></div></td></tr>)}{!catalogRewards.length && <tr><td colSpan={5} className="p-10 text-center text-sm text-blu-steel">ไม่พบของรางวัลตามตัวกรอง</td></tr>}</tbody></table></div>
      <p className="mt-3 text-[10px] text-blu-steel">สต็อกคงเหลือ = สต็อกรวม − จำนวนรายการที่จองหรือรับแล้ว · รางวัลที่เคยแลกจะปิดใช้งานแทนการลบเพื่อเก็บประวัติ</p>
    </section>

    {action && <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-blu-dark/60 p-4"><div role="dialog" aria-modal="true" aria-labelledby="reward-confirm-title" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-blu-steel">ยืนยันการส่งมอบ</p><h2 id="reward-confirm-title" className="mt-1 text-xl font-black text-blu-dark">ส่งมอบของรางวัลให้สมาชิก</h2></div><button type="button" className="rounded-xl p-2 text-blu-steel hover:bg-blu-ice" onClick={cancelAction} disabled={busy} aria-label="ปิดหน้าต่าง"><X className="h-5 w-5" /></button></div><div className="mt-5 space-y-3 rounded-2xl border border-blu-sky/40 bg-blu-ice/40 p-4 text-sm"><p>สมาชิก: <strong>{action.memberName}</strong> ({action.memberCode})</p><p>ของรางวัล: <strong>{action.title}</strong></p><p>รหัสการแลก: <span className="break-all font-mono text-xs">{action.code}</span></p><p className="text-xs text-blu-steel">{action.detail}</p></div><p className="mt-4 text-xs text-blu-steel">เมื่อยืนยันแล้ว สถานะจะเปลี่ยนเป็น “รับแล้ว” และระบบจะไม่หักแต้มซ้ำ</p><div className="mt-6 flex justify-end gap-3"><button type="button" className={buttonClass} onClick={cancelAction} disabled={busy}>ยกเลิก</button><button type="button" className="btn-gold rounded-xl px-4 py-2 font-bold disabled:opacity-40" disabled={busy || !ready} onClick={() => void run(async () => { await confirmDeskAction(action, new Date()); return "ยืนยันส่งมอบของรางวัลแล้ว"; })}>{busy ? "กำลังบันทึก…" : "ยืนยันรับของ"}</button></div></div></div>}
    {statusTarget && <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-blu-dark/60 p-4"><div role="dialog" aria-modal="true" aria-labelledby="reward-status-title" className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-blu-steel">ยืนยันการเปลี่ยนสถานะ</p><h2 id="reward-status-title" className="mt-1 text-xl font-black text-blu-dark">{statusTarget.isActive ? "ปิดใช้งานของรางวัล" : "เปิดใช้งานของรางวัล"}</h2></div><button type="button" className="rounded-xl p-2 text-blu-steel hover:bg-blu-ice" onClick={cancelAction} disabled={busy} aria-label="ปิดหน้าต่าง"><X className="h-5 w-5" /></button></div><div className="mt-5 rounded-2xl border border-blu-sky/40 bg-blu-ice/40 p-4 text-sm"><p>ของรางวัล: <strong>{statusTarget.title}</strong></p><p className="mt-2 text-xs text-blu-steel">{statusTarget.isActive ? "สมาชิกจะไม่สามารถแลกรางวัลนี้ใหม่ได้ แต่รายการที่แลกไว้แล้วจะยังคงอยู่ในประวัติ" : "สมาชิกจะสามารถแลกรางวัลนี้ได้อีกครั้ง หากยังมีสต็อกเหลือ"}</p></div><div className="mt-6 flex justify-end gap-3"><button type="button" className={buttonClass} onClick={cancelAction} disabled={busy}>ยกเลิก</button><button type="button" className="btn-gold rounded-xl px-4 py-2 font-bold disabled:opacity-40" disabled={busy || !ready} onClick={() => void run(async () => { const nextActive = !statusTarget.isActive; await saveReward({ ...statusTarget, isActive: nextActive }, statusTarget); return nextActive ? "เปิดใช้งานรางวัลแล้ว" : "ปิดใช้งานรางวัลแล้ว"; })}>{busy ? "กำลังบันทึก…" : statusTarget.isActive ? "ยืนยันปิดใช้งาน" : "ยืนยันเปิดใช้งาน"}</button></div></div></div>}
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="min-w-0 space-y-1"><span className="block text-xs font-semibold text-blu-steel">{label}</span>{children}</label>;
}

function Summary({ icon: Icon, label, value, tone }: { icon: typeof Gift; label: string; value: number; tone: string }) {
  return <div className="rounded-2xl border border-blu-sky/40 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-blu-steel">{label}</p><Icon className={`h-5 w-5 ${tone}`} /></div><p className={`mt-2 text-2xl font-black ${tone}`}>{value}</p></div>;
}

function RedemptionTable({ records, memberMap, disabled, onConfirm }: { records: RedemptionRecord[]; memberMap: Map<string, AdminMember>; disabled: boolean; onConfirm: (record: RedemptionRecord) => void }) {
  const headings = ["จัดการ", "วันที่แลก", "เวลา", "สถานะ", "สมาชิก", "ประเภทสมาชิก", "ของรางวัล", "รหัสการแลก", "แต้มที่ใช้"];
  return <div className="overflow-x-auto rounded-2xl border border-blu-sky/40"><table className="w-full min-w-275 text-left text-xs"><thead><tr className="bg-blu-ice/60 text-[10px] text-blu-steel">{headings.map((heading) => <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-blu-sky/20">{records.map((record) => <tr key={record.id} className="hover:bg-blu-ice/30"><td className="px-4 py-3">{record.status === "PENDING" ? <button type="button" className={buttonClass} disabled={disabled} onClick={() => onConfirm(record)}>ตรวจรับ</button> : "-"}</td><td className="px-4 py-3">{dateText(record.redeemedAt)}</td><td className="px-4 py-3 font-mono">{timeText(record.redeemedAt)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${record.status === "PENDING" ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}>{record.status === "PENDING" ? "รอรับของ" : "รับแล้ว"}</span>{record.completedAt && <span className="mt-1 block text-[9px] text-blu-steel">{dateText(record.completedAt)} {timeText(record.completedAt)}</span>}</td><td className="px-4 py-3"><strong>{record.memberCode}</strong><span className="block text-[10px] text-blu-steel">{record.memberName}</span></td><td className="px-4 py-3">{memberTypeLabel(memberMap.get(record.memberCode))}</td><td className="px-4 py-3 font-semibold">{record.rewardTitle}</td><td className="max-w-60 break-all px-4 py-3 font-mono text-[10px]">{record.rewardCode}</td><td className="px-4 py-3 font-bold">{record.pointsSpent.toLocaleString()}</td></tr>)}{!records.length && <tr><td colSpan={9} className="p-10 text-center text-sm text-blu-steel">ไม่พบประวัติตามตัวกรอง</td></tr>}</tbody></table></div>;
}
