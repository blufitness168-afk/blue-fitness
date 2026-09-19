"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, Edit3, History, Plus, Power, Search, Users, X } from "lucide-react";
import { buttonClass, Confirmation, inputClass, MockNotice, panelClass } from "./AdminScanner";
import { combinedMembershipHistory, readAdminMembers, type AdminMember } from "@/lib/admin-members";
import { BENEFITS_EVENT, BENEFITS_KEY, commitGrant, newDefinition, previewGrant, readBenefits, saveDefinition, type BenefitDefinition, type BenefitGrant, type BenefitsState, type GrantPlan } from "@/lib/benefits";

const errorText = (cause: unknown) => cause instanceof Error ? cause.message : "ทำรายการไม่ได้ กรุณาลองใหม่";

const dateTimeText = (value: string) => new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
const inputDateTime = (value: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)).replace(" ", "T");
const memberTypes = ["ALL", "DAILY", "MONTHLY", "3_MONTHS", "6_MONTHS", "12_MONTHS"] as const;
type MemberType = typeof memberTypes[number];
type GrantStatus = "ALL" | "UNUSED" | "USED" | "EXPIRED" | "SUSPENDED";

function csvCell(value: string | number) { return `"${String(value).replaceAll('"', '""')}"`; }
function memberType(member?: AdminMember): MemberType {
  const name = member ? combinedMembershipHistory(member)[0]?.packageName ?? "" : "";
  if (name.includes("รายวัน")) return "DAILY";
  if (name.includes("1 เดือน")) return "MONTHLY";
  if (name.includes("3 เดือน")) return "3_MONTHS";
  if (name.includes("6 เดือน")) return "6_MONTHS";
  if (name.includes("1 ปี")) return "12_MONTHS";
  return "ALL";
}
function memberTypeLabel(value: MemberType) { return { ALL: "ทุกประเภท", DAILY: "รายวัน", MONTHLY: "รายเดือน", "3_MONTHS": "3 เดือน", "6_MONTHS": "6 เดือน", "12_MONTHS": "1 ปี" }[value]; }
function grantStatus(grant: BenefitGrant, definition?: BenefitDefinition): Exclude<GrantStatus, "ALL"> {
  if (!definition?.active) return "SUSPENDED";
  if (grant.status === "USED") return "USED";
  return Date.parse(grant.definition.expiresAt) <= Date.now() ? "EXPIRED" : "UNUSED";
}
function statusLabel(status: Exclude<GrantStatus, "ALL">) { return { UNUSED: "ยังไม่ใช้", USED: "ใช้แล้ว", EXPIRED: "หมดอายุ", SUSPENDED: "ระงับ" }[status]; }

export default function PromoCodesAdmin() {
  const [state, setState] = useState<BenefitsState | null>(null);
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [draft, setDraft] = useState<BenefitDefinition | null>(null);
  const [expected, setExpected] = useState<BenefitDefinition | null>(null);
  const [statusTarget, setStatusTarget] = useState<BenefitDefinition | null>(null);
  const [grantDefinitionId, setGrantDefinitionId] = useState("");
  const [grantMode, setGrantMode] = useState<"SELECTED" | "ALL">("SELECTED");
  const [eligibility, setEligibility] = useState<MemberType>("ALL");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [plan, setPlan] = useState<GrantPlan | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [filters, setFilters] = useState({ member: "", definitionId: "ALL", status: "ALL" as GrantStatus, code: "" });
  const [draftFilters, setDraftFilters] = useState({ query: "", status: "ALL" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const writing = useRef(false);

  const refresh = useCallback(() => {
    try { setState(readBenefits()); setMembers(readAdminMembers()); setError(""); }
    catch (cause) { setState(null); setMembers([]); setError(errorText(cause)); }
  }, []);
  useEffect(() => {
    // Browser-only mock storage is loaded after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const sync = (event: StorageEvent) => { if (event.key === BENEFITS_KEY || event.key === null) refresh(); };
    window.addEventListener("storage", sync); window.addEventListener(BENEFITS_EVENT, refresh);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(BENEFITS_EVENT, refresh); };
  }, [refresh]);

  const allDefinitions = useMemo(() => state?.definitions.filter(d => d.kind === "PROMO") ?? [], [state]);
  const definitions = useMemo(() => {
    const query = draftFilters.query.trim().toLowerCase();
    return allDefinitions.filter(d => (!query || `${d.name} ${d.code}`.toLowerCase().includes(query)) && (draftFilters.status === "ALL" || (draftFilters.status === "ACTIVE" ? d.active : !d.active)));
  }, [allDefinitions, draftFilters]);
  const definitionMap = useMemo(() => new Map((state?.definitions ?? []).map(d => [d.id, d])), [state]);
  const eligibleMembers = useMemo(() => members.filter(member => eligibility === "ALL" || memberType(member) === eligibility), [eligibility, members]);
  const memberResults = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    return eligibleMembers.filter(member => !query || `${member.firstName} ${member.lastName} ${member.memberCode} ${member.cardNumber}`.toLowerCase().includes(query));
  }, [eligibleMembers, memberSearch]);
  const grants = useMemo(() => (state?.grants ?? []).filter(grant => {
    if (grant.definition.kind !== "PROMO") return false;
    const status = grantStatus(grant, definitionMap.get(grant.definition.id));
    return (!filters.member || `${grant.memberCode} ${grant.memberName}`.toLowerCase().includes(filters.member.trim().toLowerCase())) &&
      (filters.definitionId === "ALL" || grant.definition.id === filters.definitionId) &&
      (filters.status === "ALL" || status === filters.status) &&
      (!filters.code || grant.code.toLowerCase().includes(filters.code.trim().toLowerCase()));
  }).sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt)), [definitionMap, filters, state]);
  const activeDefinitions = allDefinitions.filter(d => d.active);
  const issuedCount = (definitionId: string) => state?.grants.filter(g => g.definition.id === definitionId && g.definition.kind === "PROMO").length ?? 0;
  const usedCount = (definitionId: string) => state?.grants.filter(g => g.definition.id === definitionId && g.status === "USED").length ?? 0;
  const disabled = busy || !state || !!draft || !!statusTarget || !!plan;

  function closeOverlays() { setDraft(null); setExpected(null); setStatusTarget(null); setPlan(null); setGrantOpen(false); }
  async function run(operation: () => Promise<string>) {
    if (writing.current) return;
    writing.current = true; setBusy(true); setMessage("");
    try { setMessage(await operation()); }
    catch (cause) { setMessage(errorText(cause)); }
    finally { writing.current = false; setBusy(false); closeOverlays(); refresh(); }
  }
  function edit(definition: BenefitDefinition | null) { setExpected(definition); setDraft(definition ? { ...definition } : newDefinition("PROMO")); }
  function openGrant(definition: BenefitDefinition) {
    setGrantDefinitionId(definition.id); setGrantMode("SELECTED"); setEligibility("ALL"); setMemberSearch(""); setSelectedMembers([]); setPlan(null); setGrantOpen(true); setMessage("");
  }
  function prepareGrant() {
    try { setPlan(previewGrant(grantDefinitionId, selectedMembers, grantMode, new Date(), eligibleMembers.map(member => member.memberCode))); }
    catch (cause) { setMessage(errorText(cause)); }
  }
  function toggleMember(code: string) { setSelectedMembers(current => current.includes(code) ? current.filter(item => item !== code) : [...current, code]); }
  function exportCsv() {
    const rows = grants.map(grant => { const status = grantStatus(grant, definitionMap.get(grant.definition.id)); return [grant.memberCode, grant.memberName, grant.definition.name, grant.code, dateTimeText(grant.issuedAt), grant.definition.expiresAt === "" ? "" : dateTimeText(grant.definition.expiresAt), statusLabel(status), grant.usedAt ? dateTimeText(grant.usedAt) : ""]; });
    const csv = `\ufeff${[["รหัสสมาชิก", "สมาชิก", "แคมเปญ", "รหัสส่วนลด", "วันที่แจก", "วันหมดอายุ", "สถานะ", "วันที่ใช้"], ...rows].map(row => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "promo-code-history.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  return <div className="mx-auto max-w-375 space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-blu-steel">Promotion management</p><h1 className="mt-1 text-2xl font-black text-blu-dark">จัดการโค้ดส่วนลด</h1><p className="mt-1 text-xs text-blu-steel">สร้างแคมเปญ แจกสิทธิ์ และติดตามการใช้ส่วนลดในที่เดียว</p></div><button type="button" className={`${buttonClass} inline-flex items-center gap-1`} disabled={busy} onClick={refresh}>โหลดใหม่</button></header>
    <MockNotice />
    <p className="text-xs text-blu-steel">โค้ดส่วนลดถูกใช้ในขั้นตอนซื้อแพ็กเกจ mock และระบบจะเปลี่ยนสถานะเป็น “ใช้แล้ว” เมื่อชำระเงินสำเร็จ · <Link className="font-bold underline" href="/member">ดูฝั่งสมาชิก</Link></p>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}{message && <p role="status" className="rounded-xl border border-blu-sky/40 bg-blu-sky/20 p-4 text-sm">{message}</p>}

    <section className={panelClass}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blu-yellow/20"><Power className="h-5 w-5" /></span><div><h2 className="text-lg font-black">1. แคมเปญโค้ดส่วนลด</h2><p className="mt-1 text-xs text-blu-steel">แก้ไขได้ แต่รายการที่แจกแล้วจะเก็บเงื่อนไขเดิมไว้ในประวัติ</p></div></div></div><button type="button" className={`${buttonClass} inline-flex items-center gap-1`} disabled={disabled} onClick={() => edit(null)}><Plus className="h-4 w-4" /> สร้างแคมเปญ</button></div>
      <div className="rounded-2xl border border-blu-sky/40 bg-blu-ice/35 p-4"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"><Field label="ค้นหาชื่อ / รหัส"><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-blu-steel" /><input className={`${inputClass} pl-9`} value={draftFilters.query} onChange={event => setDraftFilters({ ...draftFilters, query: event.target.value })} placeholder="เช่น SUMMER10" /></div></Field><Field label="สถานะ"><select className={inputClass} value={draftFilters.status} onChange={event => setDraftFilters({ ...draftFilters, status: event.target.value })}><option value="ALL">ทั้งหมด</option><option value="ACTIVE">เปิดใช้งาน</option><option value="INACTIVE">ปิดใช้งาน</option></select></Field><button type="button" className="h-10 text-xs font-bold text-blu-slate underline" onClick={() => setDraftFilters({ query: "", status: "ALL" })}>ล้างตัวกรอง</button></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-250 text-left text-sm"><thead><tr className="bg-blu-ice/60">{["ชื่อ / รหัส", "ส่วนลด / เงื่อนไข", "แจก / ใช้ / โควต้า", "หมดอายุ", "สถานะ", "จัดการ"].map(heading => <th key={heading} className="p-3 text-xs text-blu-steel">{heading}</th>)}</tr></thead><tbody>{definitions.map(definition => <tr key={definition.id} className="border-t border-blu-sky/30"><td className="p-3"><strong>{definition.name}</strong><p className="font-mono text-xs">{definition.code}</p></td><td className="p-3">{definition.amount}{definition.discountType === "PERCENT" ? "%" : " บาท"}<p className="text-xs text-blu-steel">ขั้นต่ำ {definition.minSpend.toLocaleString()} บาท</p><p className="text-xs text-blu-steel">{definition.detail}</p></td><td className="p-3">{issuedCount(definition.id)} / {usedCount(definition.id)} / {definition.quota}<p className="text-xs text-blu-steel">ใช้สูงสุด {definition.maxUses} ครั้ง</p></td><td className="p-3 text-xs">{dateTimeText(definition.expiresAt)}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${definition.active ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>{definition.active ? "เปิด" : "ปิด"}</span></td><td className="p-3"><div className="flex flex-wrap gap-2"><button type="button" className={`${buttonClass} inline-flex items-center gap-1`} disabled={disabled} onClick={() => edit(definition)}><Edit3 className="h-3.5 w-3.5" /> แก้ไข</button><button type="button" className={`${buttonClass} inline-flex items-center gap-1`} disabled={disabled || !definition.active} onClick={() => openGrant(definition)}><Users className="h-3.5 w-3.5" /> แจกให้สมาชิก</button><button type="button" className={`${buttonClass} inline-flex items-center gap-1`} disabled={disabled} onClick={() => setStatusTarget(definition)}><Power className="h-3.5 w-3.5" /> {definition.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}</button></div></td></tr>)}{!definitions.length && <tr><td colSpan={6} className="p-8 text-center text-blu-steel">ยังไม่มีแคมเปญ</td></tr>}</tbody></table></div>
    </section>

    <section className={panelClass}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blu-sky/20"><History className="h-5 w-5" /></span><div><h2 className="text-lg font-black">2. ประวัติการแจกและการใช้</h2><p className="mt-1 text-xs text-blu-steel">ติดตามว่าใครได้รับโค้ด และใช้ส่วนลดไปแล้วหรือยัง</p></div></div></div><div className="flex items-center gap-2"><span className="rounded-full bg-blu-ice px-3 py-1 text-xs font-bold">{grants.length} รายการ</span><button type="button" className={`${buttonClass} inline-flex items-center gap-1`} disabled={!grants.length} onClick={exportCsv}><Download className="h-4 w-4" /> Export</button></div></div><div className="grid gap-3 rounded-2xl border border-blu-sky/40 bg-blu-ice/35 p-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="สมาชิก / ชื่อ"><input className={inputClass} value={filters.member} onChange={event => setFilters({ ...filters, member: event.target.value })} placeholder="BLU-… หรือชื่อ" /></Field><Field label="แคมเปญ"><select className={inputClass} value={filters.definitionId} onChange={event => setFilters({ ...filters, definitionId: event.target.value })}><option value="ALL">ทั้งหมด</option>{(state?.definitions.filter(d => d.kind === "PROMO") ?? []).map(definition => <option key={definition.id} value={definition.id}>{definition.name}</option>)}</select></Field><Field label="สถานะ"><select className={inputClass} value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value as GrantStatus })}><option value="ALL">ทั้งหมด</option><option value="UNUSED">ยังไม่ใช้</option><option value="USED">ใช้แล้ว</option><option value="EXPIRED">หมดอายุ</option><option value="SUSPENDED">ระงับ</option></select></Field><Field label="รหัสส่วนลด"><input className={inputClass} value={filters.code} onChange={event => setFilters({ ...filters, code: event.target.value })} placeholder="BLU-PC-…" /></Field></div><div className="flex justify-between"><button type="button" className="text-xs font-bold text-blu-slate underline" onClick={() => setFilters({ member: "", definitionId: "ALL", status: "ALL", code: "" })}>ล้างตัวกรอง</button><span className="text-xs text-blu-steel">แสดง {grants.length} รายการ</span></div><div className="overflow-x-auto"><table className="w-full min-w-250 text-left text-sm"><thead><tr className="bg-blu-ice/60">{["สมาชิก", "แคมเปญ", "รหัสส่วนลด", "วันที่แจก", "หมดอายุ", "สถานะ", "วันที่ใช้"].map(heading => <th key={heading} className="p-3 text-xs text-blu-steel">{heading}</th>)}</tr></thead><tbody>{grants.map(grant => { const status = grantStatus(grant, definitionMap.get(grant.definition.id)); return <tr key={grant.id} className="border-t border-blu-sky/30"><td className="p-3"><strong>{grant.memberCode}</strong><p className="text-xs">{grant.memberName}</p></td><td className="p-3 font-semibold">{grant.definition.name}<p className="font-mono text-[10px] text-blu-steel">{grant.definition.code}</p></td><td className="max-w-56 break-all p-3 font-mono text-xs">{grant.code}</td><td className="p-3 text-xs">{dateTimeText(grant.issuedAt)}</td><td className="p-3 text-xs">{dateTimeText(grant.definition.expiresAt)}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${status === "UNUSED" ? "bg-amber-50 text-amber-700" : status === "USED" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>{statusLabel(status)}</span></td><td className="p-3 text-xs">{grant.usedAt ? dateTimeText(grant.usedAt) : "-"}</td></tr>; })}{!grants.length && <tr><td colSpan={7} className="p-8 text-center text-blu-steel">ไม่พบประวัติตามตัวกรอง</td></tr>}</tbody></table></div></section>

    {draft && <Modal title={expected ? "แก้ไขแคมเปญโค้ดส่วนลด" : "สร้างแคมเปญโค้ดส่วนลด"} onClose={closeOverlays}><form onSubmit={event => { event.preventDefault(); void run(async () => { await saveDefinition(draft, expected); return "บันทึกแคมเปญแล้ว"; }); }}><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2"><Field label="ชื่อแคมเปญ"><input required maxLength={120} className={inputClass} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field><Field label="รหัสนิยาม"><input required minLength={3} maxLength={40} pattern="[A-Z0-9-]+" className={inputClass} value={draft.code} onChange={event => setDraft({ ...draft, code: event.target.value.toUpperCase() })} /></Field><Field label="ประเภทส่วนลด"><select className={inputClass} value={draft.discountType} onChange={event => setDraft({ ...draft, discountType: event.target.value as BenefitDefinition["discountType"] })}><option value="FIXED">จำนวนเงิน (บาท)</option><option value="PERCENT">เปอร์เซ็นต์</option></select></Field><Field label="มูลค่าส่วนลด"><input required type="number" min={1} max={draft.discountType === "PERCENT" ? 100 : 10000000} className={inputClass} value={draft.amount} onChange={event => setDraft({ ...draft, amount: Number(event.target.value) })} /></Field><Field label="ยอดซื้อขั้นต่ำ (บาท)"><input required type="number" min={0} max={10000000} className={inputClass} value={draft.minSpend} onChange={event => setDraft({ ...draft, minSpend: Number(event.target.value) })} /></Field><Field label="โควต้าผู้รับทั้งหมด"><input required type="number" min={1} max={100000} className={inputClass} value={draft.quota} onChange={event => setDraft({ ...draft, quota: Number(event.target.value) })} /></Field><Field label="จำนวนครั้งใช้สูงสุด"><input required type="number" min={1} max={100000} className={inputClass} value={draft.maxUses} onChange={event => setDraft({ ...draft, maxUses: Number(event.target.value) })} /></Field><Field label="วันหมดอายุ"><input required type="datetime-local" className={inputClass} value={inputDateTime(draft.expiresAt)} onChange={event => setDraft({ ...draft, expiresAt: new Date(`${event.target.value}:00+07:00`).toISOString() })} /></Field><Field label="รายละเอียด"><input required maxLength={300} className={inputClass} value={draft.detail} onChange={event => setDraft({ ...draft, detail: event.target.value })} /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={event => setDraft({ ...draft, active: event.target.checked })} />เปิดใช้งาน</label><div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className={buttonClass} onClick={closeOverlays}>ยกเลิก</button><button className="btn-gold rounded-xl px-4 py-2 font-bold">บันทึกแคมเปญ</button></div></fieldset></form></Modal>}
    {grantOpen && !plan && <Modal title="แจกโค้ดให้สมาชิก" onClose={closeOverlays}><fieldset disabled={busy} className="space-y-4"><Field label="แคมเปญ"><select className={inputClass} value={grantDefinitionId} onChange={event => setGrantDefinitionId(event.target.value)}>{activeDefinitions.map(definition => <option key={definition.id} value={definition.id}>{definition.name} · {definition.code}</option>)}</select></Field><Field label="ประเภทสมาชิก"><select className={inputClass} value={eligibility} onChange={event => { setEligibility(event.target.value as MemberType); setSelectedMembers([]); }}><option value="ALL">ทุกประเภทสมาชิก</option>{memberTypes.slice(1).map(type => <option key={type} value={type}>{memberTypeLabel(type)}</option>)}</select></Field><div className="flex flex-wrap gap-4 text-sm"><label><input type="radio" checked={grantMode === "SELECTED"} onChange={() => setGrantMode("SELECTED")} /> เลือกสมาชิก</label><label><input type="radio" checked={grantMode === "ALL"} onChange={() => setGrantMode("ALL")} /> สมาชิกทั้งหมดตามประเภท ({eligibleMembers.length})</label></div>{grantMode === "SELECTED" && <><input className={inputClass} value={memberSearch} onChange={event => setMemberSearch(event.target.value)} placeholder="ค้นหาชื่อ / BLU-… / CARD-…" /><div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">{memberResults.map(member => <label key={member.memberCode} className="flex gap-2 rounded-xl bg-blu-ice p-3 text-sm"><input type="checkbox" checked={selectedMembers.includes(member.memberCode)} onChange={() => toggleMember(member.memberCode)} /><span><strong>{member.firstName} {member.lastName}</strong><span className="block font-mono text-[10px]">{member.memberCode} · {member.cardNumber}</span></span></label>)}</div><p className="text-xs text-blu-steel">เลือกแล้ว {selectedMembers.length} คน · สมาชิกที่เคยได้รับครบจำนวนต่อคนจะถูกข้ามตอน Preview</p></>}<div className="flex justify-end gap-2"><button type="button" className={buttonClass} onClick={closeOverlays}>ยกเลิก</button><button type="button" className="btn-gold rounded-xl px-4 py-2 font-bold" disabled={!grantDefinitionId || (grantMode === "SELECTED" && !selectedMembers.length)} onClick={prepareGrant}>ตรวจสอบจำนวนก่อนแจก</button></div></fieldset></Modal>}
    {plan && <Modal title="ตรวจสอบก่อนแจก" onClose={closeOverlays}><Confirmation key={plan.batchId} busy={busy || !state} onCancel={closeOverlays} label={`ยืนยันแจก ${plan.newCodes.length} รายการ`} onConfirm={() => void run(async () => { const count = await commitGrant(plan); return `แจกโค้ดให้สมาชิกแล้ว ${count} รายการ`; })}><p>แคมเปญ: <strong>{definitionMap.get(plan.definitionId)?.name}</strong></p><p>ผู้รับทั้งหมด {plan.memberCodes.length} คน · แจกใหม่ <strong>{plan.newCodes.length} รายการ</strong> · ข้าม {plan.skipped} คน</p><p className="text-xs text-blu-steel">โค้ดที่แจกแล้วจะไม่ถูกสร้างซ้ำเกินจำนวนต่อคน</p></Confirmation></Modal>}
    {statusTarget && <Modal title={statusTarget.active ? "ปิดใช้งานแคมเปญ?" : "เปิดใช้งานแคมเปญ?"} onClose={closeOverlays}><p>แคมเปญ <strong>{statusTarget.name}</strong></p><p className="mt-2 text-sm text-blu-steel">{statusTarget.active ? "สมาชิกจะใช้โค้ดใหม่ไม่ได้ และสิทธิ์ที่แจกค้างอยู่จะถูกระงับ แต่ประวัติยังคงอยู่" : "สมาชิกจะกลับมาใช้โค้ดที่ยังไม่หมดอายุได้อีกครั้ง"}</p><div className="mt-6 flex justify-end gap-2"><button type="button" className={buttonClass} onClick={closeOverlays}>ยกเลิก</button><button type="button" className="btn-gold rounded-xl px-4 py-2 font-bold" onClick={() => void run(async () => { const next = { ...statusTarget, active: !statusTarget.active }; await saveDefinition(next, statusTarget); return next.active ? "เปิดใช้งานแคมเปญแล้ว" : "ปิดใช้งานแคมเปญแล้ว"; })}>{statusTarget.active ? "ยืนยันปิดใช้งาน" : "ยืนยันเปิดใช้งาน"}</button></div></Modal>}
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="min-w-0 space-y-1"><span className="block text-xs font-semibold text-blu-steel">{label}</span>{children}</label>; }
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-blu-dark/60 p-4"><div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-start justify-between gap-4"><h2 className="text-xl font-black text-blu-dark">{title}</h2><button type="button" className="rounded-xl p-2 text-blu-steel hover:bg-blu-ice" onClick={onClose} aria-label="ปิดหน้าต่าง"><X className="h-5 w-5" /></button></div>{children}</div></div>; }
