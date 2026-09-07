"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import AdminScanner, { buttonClass, Confirmation, inputClass, MockNotice, panelClass } from "@/components/AdminScanner";
import { findMemberByAnyCode, type RedemptionRecord } from "@/lib/admin-mock";
import { confirmDeskAction, DESK_UPDATED_EVENT, lookupRewardCode, readDeskRewards, type DeskAction } from "@/lib/front-desk";
import { newReward, readRewardCatalog, remainingStock, removeReward, saveReward } from "@/lib/reward-catalog";
import type { RewardItem } from "@/lib/mock-data";

export default function AdminRewardsPage() {
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [records, setRecords] = useState<RedemptionRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<RewardItem | null>(null);
  const [expected, setExpected] = useState<RewardItem | null>(null);
  const [action, setAction] = useState<DeskAction | null>(null);
  const pending = useRef(false);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    try { const catalog = readRewardCatalog(); const history = readDeskRewards(); setRewards(catalog); setRecords(history); setReady(true); setError(""); }
    catch (cause) { setRewards([]); setRecords([]); setReady(false); setError(cause instanceof Error ? cause.message : "อ่านข้อมูลไม่ได้"); }
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
    try { setMessage(await operation()); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "ทำรายการไม่ได้"); }
    finally { writing.current = false; setBusy(false); cancel(); refresh(); }
  }
  function scan(code: string) {
    if (pending.current || writing.current || !ready) return;
    const member = findMemberByAnyCode(code);
    if (member) { setQuery(member.memberCode); setMessage(`พบ ${member.fullName} — เลือกรายการรอรับด้านล่างเพื่อตรวจสอบก่อนส่งมอบ`); return; }
    try { const found = lookupRewardCode(code); pending.current = true; setAction(found); setMessage(""); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "ไม่พบรางวัล"); }
  }
  const disabled = busy || !!action || !ready;
  const filtered = records.filter(r => `${r.memberCode} ${r.memberName} ${r.rewardCode} ${r.rewardTitle}`.toLowerCase().includes(query.toLowerCase().trim()));
  return <div className="mx-auto max-w-6xl space-y-6" onKeyDownCapture={e => { if (pending.current && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); } }}>
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-black">ของรางวัล / ยืนยันรับของ</h1><p className="mt-2 text-sm text-blu-steel">สแกนที่หน้านี้โดยตรง • ยืนยันส่งมอบเท่านั้น ไม่หักแต้มซ้ำ</p></div><button className={buttonClass} disabled={busy} onClick={refresh}>โหลดข้อมูลใหม่</button></header>
    <MockNotice /><p className="text-sm">คลังและรายการรับรางวัลใช้ร่วมกับ <Link className="font-bold underline" href="/member/rewards">ร้านรางวัล mock ฝั่งสมาชิก</Link> • สต็อกรวมลบจำนวนจอง/รับแล้ว = คงเหลือ • ปิดรางวัลหยุดแลกใหม่ แต่รายการที่จองไว้ยังรับได้</p>
    {error && <p role="alert" className="rounded-xl bg-rose-100 p-4">{error}</p>}{message && <p role="status" className="rounded-xl bg-blu-sky/30 p-4">{message}</p>}
    <AdminScanner label="สแกนรับรางวัล BLU-RW-… หรือสแกน BLU-… / CARD-… เพื่อค้นหารายการของสมาชิก" disabled={disabled} onScan={scan} />
    {action && <Confirmation key={action.code} busy={busy || !ready} onCancel={cancel} label="ยืนยันส่งมอบรางวัล" onConfirm={() => void run(async () => { await confirmDeskAction(action, new Date()); return "บันทึกรับรางวัลแล้ว ไม่หักแต้มซ้ำ"; })}><h2 className="text-lg font-bold">{action.title}</h2><p>ผู้รับ: <strong>{action.memberName}</strong> ({action.memberCode})</p><p className="break-all font-mono text-sm">{action.code}</p><p className="text-sm">{action.detail}</p></Confirmation>}
    <section className={panelClass}><h2 className="font-bold">รายการรอรับ / ประวัติรับแล้ว</h2><input className={inputClass} aria-label="ค้นหารายการรับรางวัล" placeholder="ชื่อ / รหัสสมาชิก / รหัสรางวัล" value={query} onChange={e => setQuery(e.target.value)} /><ul className="divide-y divide-blu-sky/30">{filtered.map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><strong className="text-sm">{r.rewardTitle}</strong><p className="text-sm">{r.memberName} • {r.memberCode}</p><p className="break-all font-mono text-xs">{r.rewardCode}</p><p className="text-xs">ใช้ไปแล้ว {r.pointsSpent} แต้ม • {new Date(r.redeemedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p>{r.completedAt && <p className="text-xs">รับเมื่อ {new Date(r.completedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p>}</div>{r.status === "PENDING" ? <button className={buttonClass} disabled={disabled} onClick={() => scan(r.rewardCode)}>ตรวจสอบก่อนส่งมอบ</button> : <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm">รับแล้ว</span>}</li>)}</ul>{!filtered.length && <p className="text-sm">ไม่มีรายการ</p>}</section>
    <section className={panelClass}><div className="flex justify-between"><h2 className="font-bold">จัดการคลังรางวัล</h2><button className={buttonClass} disabled={disabled} onClick={() => { try { setExpected(null); setDraft(newReward()); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "อ่านไม่ได้"); } }}>+ เพิ่มรางวัล</button></div><div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr>{["รูป / ชื่อ", "แต้ม", "สต็อกรวม / คงเหลือ", "สถานะ", "จัดการ"].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{rewards.map(r => <tr key={r.id} className="border-t border-blu-sky/30"><td className="p-3"><div className="flex items-center gap-3"><Image unoptimized src={r.imageUrl} width={48} height={48} alt={r.title} className="h-12 w-12 rounded-xl object-cover" />{r.title}</div></td><td className="p-3">{r.pointCost}</td><td className="p-3">{r.stock} / {remainingStock(r, records)}</td><td className="p-3">{r.isActive ? "เปิด" : "ปิด"}</td><td className="p-3"><div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={disabled} onClick={() => { setExpected(r); setDraft({ ...r }); }}>แก้ไข</button><button className={buttonClass} disabled={disabled} onClick={() => { if (window.confirm(`ลบ ${r.title}? หากเคยมีการแลก ระบบจะปิดใช้งานแทนและเก็บประวัติไว้`)) void run(async () => (await removeReward(r)) === "DISABLED" ? "ปิดรางวัลแล้ว เก็บประวัติและสิทธิ์รับของเดิม" : "ลบรางวัลที่ไม่เคยแลกแล้ว"); }}>{records.some(x => x.rewardId === r.id) ? "ปิดใช้งาน" : "ลบ"}</button></div></td></tr>)}</tbody></table></div></section>
    {draft && <form className={panelClass} onSubmit={e => { e.preventDefault(); void run(async () => { await saveReward({ ...draft, titleEn: draft.title }, expected); setDraft(null); return "บันทึกคลังรางวัลแล้ว"; }); }}><h2 className="font-bold">{expected ? "แก้ไขรางวัล" : "เพิ่มรางวัล"}</h2><fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm">ชื่อ<input className={inputClass} required maxLength={120} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label className="space-y-1 text-sm">รูป (HTTPS URL)<input type="url" className={inputClass} required value={draft.imageUrl} onChange={e => setDraft({ ...draft, imageUrl: e.target.value })} /></label><label className="space-y-1 text-sm">แต้มที่ใช้<input className={inputClass} required type="number" min={1} max={1000000} step={1} value={draft.pointCost} onChange={e => setDraft({ ...draft, pointCost: Number(e.target.value) })} /></label><label className="space-y-1 text-sm">สต็อกรวม (รวมที่จอง/รับแล้ว)<input className={inputClass} required type="number" min={0} max={1000000} step={1} value={draft.stock} onChange={e => setDraft({ ...draft, stock: Number(e.target.value) })} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />เปิดให้แลกใหม่</label><p className="text-xs text-blu-steel">รูปโหลดจาก URL ที่ระบุโดยตรง (ไม่อัปโหลดไฟล์/ไม่มี API); ไม่ควรใส่ URL ที่มีข้อมูลลับ</p><div className="flex gap-2"><button className={buttonClass}>บันทึก</button><button type="button" className={buttonClass} onClick={() => setDraft(null)}>ยกเลิก</button></div></fieldset></form>}
  </div>;
}
