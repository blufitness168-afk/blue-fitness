"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Gift, PackageCheck, RefreshCw } from "lucide-react";
import AdminScanner, { buttonClass, Confirmation, inputClass, MockNotice, panelClass } from "@/components/AdminScanner";
import { findMemberByAnyCode, type RedemptionRecord } from "@/lib/admin-mock";
import { combinedMembershipHistory, readAdminMembers, type AdminMember } from "@/lib/admin-members";
import { confirmDeskAction, DESK_UPDATED_EVENT, lookupRewardCode, readDeskRewards, type DeskAction } from "@/lib/front-desk";
import { newReward, readRewardCatalog, remainingStock, removeReward, saveReward } from "@/lib/reward-catalog";
import type { RewardItem } from "@/lib/mock-data";

type StatusFilter = "ALL" | RedemptionRecord["status"];
const initialFilters = { memberCode: "", memberType: "ALL", rewardId: "ALL", status: "ALL" as StatusFilter, rewardCode: "" };

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
function csvCell(value: string | number) { return `\"${String(value).replaceAll('\"', '\"\"')}\"`; }

export default function AdminRewardsPage() {
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [records, setRecords] = useState<RedemptionRecord[]>([]);
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [filters, setFilters] = useState(initialFilters);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<RewardItem | null>(null);
  const [expected, setExpected] = useState<RewardItem | null>(null);
  const [action, setAction] = useState<DeskAction | null>(null);
  const pending = useRef(false);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    try { setRewards(readRewardCatalog()); setRecords(readDeskRewards()); setMembers(readAdminMembers()); setReady(true); setError(""); }
    catch (cause) { setRewards([]); setRecords([]); setMembers([]); setReady(false); setError(cause instanceof Error ? cause.message : "อ่านข้อมูลไม่ได้"); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    window.addEventListener("storage", refresh); window.addEventListener(DESK_UPDATED_EVENT, refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener(DESK_UPDATED_EVENT, refresh); };
  }, [refresh]);

  function cancel() { setAction(null); pending.current = false; }
  async function run(operation: () => Promise<string>) {
    if (writing.current) return;
    writing.current = true; setBusy(true); setMessage("");
    try { setMessage(await operation()); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "ทำรายการไม่ได้"); }
    finally { writing.current = false; setBusy(false); cancel(); refresh(); }
  }
  function scan(code: string) {
    if (pending.current || writing.current || !ready) return;
    const member = findMemberByAnyCode(code);
    if (member) {
      setFilters((current) => ({ ...current, memberCode: member.memberCode }));
      setMessage(`พบ ${member.fullName} — แสดงรายการรอรับและประวัติของสมาชิกแล้ว`);
      return;
    }
    try { const found = lookupRewardCode(code); pending.current = true; setAction(found); setMessage(""); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "ไม่พบรางวัล"); }
  }

  const memberMap = useMemo(() => new Map(members.map((member) => [member.memberCode, member])), [members]);
  const filtered = useMemo(() => records.filter((record) => {
    const type = memberType(memberMap.get(record.memberCode));
    return (!filters.memberCode.trim() || `${record.memberCode} ${record.memberName}`.toLowerCase().includes(filters.memberCode.trim().toLowerCase())) &&
      (filters.memberType === "ALL" || type === filters.memberType) &&
      (filters.rewardId === "ALL" || record.rewardId === Number(filters.rewardId)) &&
      (filters.status === "ALL" || record.status === filters.status) &&
      (!filters.rewardCode.trim() || record.rewardCode.toLowerCase().includes(filters.rewardCode.trim().toLowerCase()));
  }).sort((a, b) => Date.parse(b.redeemedAt) - Date.parse(a.redeemedAt)), [records, filters, memberMap]);
  const pendingRecords = filtered.filter((record) => record.status === "PENDING");
  const completedRecords = filtered.filter((record) => record.status === "COMPLETED");
  const disabled = busy || !!action || !ready;

  const exportCsv = () => {
    const header = ["วันที่แลก", "เวลา", "หมายเลขสมาชิก", "ชื่อ-นามสกุล", "ประเภทสมาชิก", "ของรางวัล", "รหัสของรางวัล", "แต้มที่ใช้", "สถานะ", "วันที่รับ"];
    const rows = filtered.map((record) => [dateText(record.redeemedAt), timeText(record.redeemedAt), record.memberCode, record.memberName, memberTypeLabel(memberMap.get(record.memberCode)), record.rewardTitle, record.rewardCode, record.pointsSpent, record.status === "PENDING" ? "รอรับ" : "รับแล้ว", record.completedAt ? `${dateText(record.completedAt)} ${timeText(record.completedAt)}` : ""]);
    const csv = `\ufeff${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "reward-redemptions.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  return <div className="mx-auto max-w-375 space-y-6" onKeyDownCapture={(event) => { if (pending.current && event.key === "Enter") { event.preventDefault(); event.stopPropagation(); } }}>
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-black text-blu-dark">ของรางวัล / ยืนยันรับของ</h1><p className="mt-1 text-xs text-blu-steel">ค้นหา ตรวจสอบ และยืนยันส่งมอบโดยไม่หักแต้มซ้ำ</p></div><div className="flex gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={refresh}><RefreshCw className="mr-1 inline h-4 w-4" /> โหลดใหม่</button><button type="button" className={buttonClass} disabled={!filtered.length} onClick={exportCsv}><Download className="mr-1 inline h-4 w-4" /> Export CSV</button></div></header>
    <MockNotice /><p className="text-xs text-blu-steel">คลังและรายการรับรางวัลใช้ร่วมกับ <Link className="font-bold underline" href="/member/rewards">ร้านรางวัล mock ฝั่งสมาชิก</Link> · ปิดรางวัลจะหยุดการแลกใหม่ แต่รายการที่จองไว้ยังรับได้</p>
    {error && <p role="alert" className="rounded-xl bg-rose-100 p-4 text-sm text-rose-700">{error}</p>}{message && <p role="status" className="rounded-xl bg-blu-sky/30 p-4 text-sm">{message}</p>}

    <section className={panelClass}><h2 className="font-bold">ตัวกรอง</h2><div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Field label="หมายเลขสมาชิก / ชื่อ"><input className={inputClass} value={filters.memberCode} onChange={(event) => setFilters({ ...filters, memberCode: event.target.value })} placeholder="BLU-…" /></Field><Field label="ประเภทสมาชิก"><select className={inputClass} value={filters.memberType} onChange={(event) => setFilters({ ...filters, memberType: event.target.value })}><option value="ALL">ทั้งหมด</option><option value="DAILY">รายวัน</option><option value="MONTHLY">รายเดือน</option><option value="3_MONTHS">3 เดือน</option><option value="6_MONTHS">6 เดือน</option><option value="12_MONTHS">12 เดือน</option><option value="OTHER">อื่นๆ</option></select></Field><Field label="ชื่อของรางวัล"><select className={inputClass} value={filters.rewardId} onChange={(event) => setFilters({ ...filters, rewardId: event.target.value })}><option value="ALL">ทั้งหมด</option>{rewards.map((reward) => <option key={reward.id} value={reward.id}>{reward.title}</option>)}</select></Field><Field label="สถานะ"><select className={inputClass} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value as StatusFilter })}><option value="ALL">ทั้งหมด</option><option value="PENDING">รอรับ</option><option value="COMPLETED">รับแล้ว</option></select></Field><Field label="รหัสของรางวัล"><input className={inputClass} value={filters.rewardCode} onChange={(event) => setFilters({ ...filters, rewardCode: event.target.value })} placeholder="BLU-RW-…" /></Field></div><button type="button" onClick={() => setFilters(initialFilters)} className="text-xs font-bold text-blu-slate underline">ล้างตัวกรอง</button></section>

    <AdminScanner label="สแกนรับรางวัล BLU-RW-… หรือสแกน BLU-… / CARD-… เพื่อค้นหารายการของสมาชิก" disabled={disabled} onScan={scan} />
    {action && <Confirmation key={action.code} busy={busy || !ready} onCancel={cancel} label="ยืนยันส่งมอบรางวัล" onConfirm={() => void run(async () => { await confirmDeskAction(action, new Date()); return "บันทึกรับรางวัลแล้ว ไม่หักแต้มซ้ำ"; })}><h2 className="text-lg font-bold">{action.title}</h2><p>ผู้รับ: <strong>{action.memberName}</strong> ({action.memberCode})</p><p className="break-all font-mono text-sm">{action.code}</p><p className="text-sm">{action.detail}</p></Confirmation>}

    <div className="grid grid-cols-2 gap-3"><Summary icon={Gift} label="รายการรอรับ" value={pendingRecords.length} tone="text-amber-500" /><Summary icon={PackageCheck} label="ประวัติรับแล้ว" value={completedRecords.length} tone="text-emerald-600" /></div>
    {(filters.status === "ALL" || filters.status === "PENDING") && <RedemptionTable title="รายการรอรับ" records={pendingRecords} memberMap={memberMap} disabled={disabled} onConfirm={(record) => scan(record.rewardCode)} />}
    {(filters.status === "ALL" || filters.status === "COMPLETED") && <RedemptionTable title="ประวัติรับแล้ว" records={completedRecords} memberMap={memberMap} disabled={disabled} onConfirm={(record) => scan(record.rewardCode)} />}

    <section className={panelClass}><div className="flex justify-between"><div><h2 className="font-bold">จัดการคลังรางวัล</h2><p className="mt-1 text-xs text-blu-steel">สต็อกรวมลบรายการจองและรับแล้วเท่ากับจำนวนคงเหลือ</p></div><button className={buttonClass} disabled={disabled} onClick={() => { try { setExpected(null); setDraft(newReward()); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "อ่านไม่ได้"); } }}>+ เพิ่มรางวัล</button></div><div className="overflow-x-auto"><table className="w-full min-w-160 text-left text-sm"><thead><tr className="bg-blu-ice/60">{["รูป / ชื่อ", "แต้ม", "สต็อกรวม / คงเหลือ", "สถานะ", "จัดการ"].map((heading) => <th key={heading} className="p-3 text-xs text-blu-steel">{heading}</th>)}</tr></thead><tbody>{rewards.map((reward) => <tr key={reward.id} className="border-t border-blu-sky/30"><td className="p-3"><div className="flex items-center gap-3"><Image unoptimized src={reward.imageUrl} width={48} height={48} alt={reward.title} className="h-12 w-12 rounded-xl object-cover" /><strong>{reward.title}</strong></div></td><td className="p-3">{reward.pointCost}</td><td className="p-3">{reward.stock} / {remainingStock(reward, records)}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${reward.isActive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>{reward.isActive ? "เปิด" : "ปิด"}</span></td><td className="p-3"><div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={disabled} onClick={() => { setExpected(reward); setDraft({ ...reward }); }}>แก้ไข</button><button className={buttonClass} disabled={disabled} onClick={() => { if (window.confirm(`ลบ ${reward.title}? หากเคยมีการแลก ระบบจะปิดใช้งานแทนและเก็บประวัติไว้`)) void run(async () => (await removeReward(reward)) === "DISABLED" ? "ปิดรางวัลแล้ว เก็บประวัติและสิทธิ์รับของเดิม" : "ลบรางวัลที่ไม่เคยแลกแล้ว"); }}>{records.some((item) => item.rewardId === reward.id) ? "ปิดใช้งาน" : "ลบ"}</button></div></td></tr>)}</tbody></table></div></section>

    {draft && <form className={panelClass} onSubmit={(event) => { event.preventDefault(); void run(async () => { await saveReward({ ...draft, titleEn: draft.title }, expected); setDraft(null); return "บันทึกคลังรางวัลแล้ว"; }); }}><h2 className="font-bold">{expected ? "แก้ไขรางวัล" : "เพิ่มรางวัล"}</h2><fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2"><Field label="ชื่อ"><input className={inputClass} required maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><Field label="รูป (HTTPS URL)"><input type="url" className={inputClass} required value={draft.imageUrl} onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })} /></Field><Field label="แต้มที่ใช้"><input className={inputClass} required type="number" min={1} max={1000000} step={1} value={draft.pointCost} onChange={(event) => setDraft({ ...draft, pointCost: Number(event.target.value) })} /></Field><Field label="สต็อกรวม"><input className={inputClass} required type="number" min={0} max={1000000} step={1} value={draft.stock} onChange={(event) => setDraft({ ...draft, stock: Number(event.target.value) })} /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />เปิดให้แลกใหม่</label><p className="text-xs text-blu-steel">รูปโหลดจาก URL โดยตรง ไม่ควรใส่ URL ที่มีข้อมูลลับ</p><div className="flex gap-2"><button className={buttonClass}>บันทึก</button><button type="button" className={buttonClass} onClick={() => setDraft(null)}>ยกเลิก</button></div></fieldset></form>}
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="min-w-0 space-y-1"><span className="block text-xs font-semibold text-blu-steel">{label}</span>{children}</label>; }
function Summary({ icon: Icon, label, value, tone }: { icon: typeof Gift; label: string; value: number; tone: string }) { return <div className="rounded-2xl border border-blu-sky/40 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-blu-steel">{label}</p><Icon className={`h-5 w-5 ${tone}`} /></div><p className={`mt-2 text-2xl font-black ${tone}`}>{value}</p></div>; }
function RedemptionTable({ title, records, memberMap, disabled, onConfirm }: { title: string; records: RedemptionRecord[]; memberMap: Map<string, AdminMember>; disabled: boolean; onConfirm: (record: RedemptionRecord) => void }) { return <section className="overflow-hidden rounded-2xl border border-blu-sky/40 bg-white shadow-sm"><div className="border-b border-blu-sky/30 px-5 py-4"><h2 className="font-black text-blu-dark">{title}</h2><p className="mt-1 text-[10px] text-blu-steel">{records.length} รายการ</p></div><div className="overflow-x-auto"><table className="w-full min-w-275 text-left text-xs"><thead><tr className="bg-blu-ice/60 text-[10px] text-blu-steel">{["วันที่แลก", "เวลา", "หมายเลขสมาชิก - ชื่อ-สกุล", "ประเภทสมาชิก", "ของรางวัล", "รหัสของรางวัล", "แต้มที่ใช้", "สถานะ", "จัดการ"].map((heading) => <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-blu-sky/20">{records.map((record) => <tr key={record.id} className="hover:bg-blu-ice/30"><td className="px-4 py-3">{dateText(record.redeemedAt)}</td><td className="px-4 py-3 font-mono">{timeText(record.redeemedAt)}</td><td className="px-4 py-3"><strong>{record.memberCode}</strong><span className="block text-[10px] text-blu-steel">{record.memberName}</span></td><td className="px-4 py-3">{memberTypeLabel(memberMap.get(record.memberCode))}</td><td className="px-4 py-3 font-semibold">{record.rewardTitle}</td><td className="max-w-60 break-all px-4 py-3 font-mono text-[10px]">{record.rewardCode}</td><td className="px-4 py-3 font-bold">{record.pointsSpent}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${record.status === "PENDING" ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}>{record.status === "PENDING" ? "รอรับ" : "รับแล้ว"}</span>{record.completedAt && <span className="mt-1 block text-[9px] text-blu-steel">{dateText(record.completedAt)} {timeText(record.completedAt)}</span>}</td><td className="px-4 py-3">{record.status === "PENDING" ? <button className={buttonClass} disabled={disabled} onClick={() => onConfirm(record)}>ตรวจสอบส่งมอบ</button> : "-"}</td></tr>)}{!records.length && <tr><td colSpan={9} className="p-8 text-center text-blu-steel">ไม่มีรายการ</td></tr>}</tbody></table></div></section>; }
