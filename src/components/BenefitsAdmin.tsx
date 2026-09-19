"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import AdminScanner, { buttonClass, Confirmation, inputClass, MockNotice, panelClass } from "./AdminScanner";
import { mockAdminMembers } from "@/lib/admin-mock";
import { ADMIN_MEMBERS_EVENT, ADMIN_MEMBERS_KEY, combinedMembershipHistory, readAdminMembers, type AdminMember } from "@/lib/admin-members";
import { bangkokDay } from "@/lib/checkin";
import { BENEFITS_EVENT, BENEFITS_KEY, commitGrant, newDefinition, previewCoupon, previewGrant, readBenefits, readMembership, redeemCoupon, removeDefinition, resolveBenefitMember, saveDefinition, type BenefitDefinition, type BenefitGrant, type BenefitKind, type BenefitsState, type GrantPlan } from "@/lib/benefits";
import { consumePointCoupon, previewPointCoupon, type PointCoupon } from "@/lib/member-account";

const errorText = (error: unknown) => error instanceof Error ? error.message : "ทำรายการไม่ได้ กรุณาลองใหม่";
const thaiDate = (value: string) => new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
type CouponRedemption = BenefitGrant | PointCoupon;
type Eligibility = "ALL" | "DAILY" | "MONTHLY" | "3_MONTHS" | "6_MONTHS" | "12_MONTHS";
const isAdminGrant = (redemption: CouponRedemption): redemption is BenefitGrant => "definition" in redemption;
function memberEligibility(member?: AdminMember): Eligibility {
  const name = member ? combinedMembershipHistory(member)[0]?.packageName ?? "" : "";
  if (name.includes("รายวัน")) return "DAILY";
  if (name.includes("1 เดือน")) return "MONTHLY";
  if (name.includes("3 เดือน")) return "3_MONTHS";
  if (name.includes("6 เดือน")) return "6_MONTHS";
  if (name.includes("1 ปี")) return "12_MONTHS";
  return "ALL";
}
function eligibilityLabel(value: Eligibility) {
  return { ALL: "ทุกประเภท", DAILY: "รายวัน", MONTHLY: "รายเดือน", "3_MONTHS": "3 เดือน", "6_MONTHS": "6 เดือน", "12_MONTHS": "12 เดือน" }[value];
}
function csvCell(value: string | number) { return `"${String(value).replaceAll('"', '""')}"`; }
export default function BenefitsAdmin({ kind }: { kind: BenefitKind }) {
  const coupon = kind === "COUPON";
  const title = coupon ? "คูปอง" : "โค้ดส่วนลด";
  const [state, setState] = useState<BenefitsState | null>(null);
  const [adminMembers, setAdminMembers] = useState<AdminMember[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [draft, setDraft] = useState<BenefitDefinition | null>(null);
  const [expected, setExpected] = useState<BenefitDefinition | null>(null);
  const [definitionId, setDefinitionId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [grantMode, setGrantMode] = useState<"SELECTED" | "ALL">("SELECTED");
  const [eligibility, setEligibility] = useState<Eligibility>("ALL");
  const [mode, setMode] = useState<"GRANT" | "REDEEM">("GRANT");
  const [plan, setPlan] = useState<GrantPlan | null>(null);
  const [redemption, setRedemption] = useState<CouponRedemption | null>(null);
  const pending = useRef(false);
  const [walletFilters, setWalletFilters] = useState({ member: "", memberType: "ALL", name: "", status: "ALL", code: "" });
  const [qr, setQr] = useState("");
  const refresh = useCallback(() => {
    try { setState(readBenefits()); setAdminMembers(readAdminMembers()); setError(""); }
    catch (cause) { setState(null); setAdminMembers([]); setError(errorText(cause)); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const sync = (e: StorageEvent) => { if (e.key === BENEFITS_KEY || e.key === ADMIN_MEMBERS_KEY || e.key === null) refresh(); };
    window.addEventListener("storage", sync); window.addEventListener(BENEFITS_EVENT, refresh); window.addEventListener(ADMIN_MEMBERS_EVENT, refresh);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(BENEFITS_EVENT, refresh); window.removeEventListener(ADMIN_MEMBERS_EVENT, refresh); };
  }, [refresh]);
  function cancel() { setPlan(null); setRedemption(null); pending.current = false; }
  async function run(operation: () => Promise<string>) {
    if (writing.current) return;
    writing.current = true; setBusy(true); setMessage("");
    try { setMessage(await operation()); }
    catch (cause) { setMessage(errorText(cause)); }
    finally { writing.current = false; setBusy(false); cancel(); refresh(); }
  }
  function scanMember(code: string) {
    if (writing.current || pending.current || !state || grantMode !== "SELECTED") return;
    try {
      const member = resolveBenefitMember(code);
      if (eligibility !== "ALL" && memberEligibility(adminMembers.find(profile => profile.memberCode === member.memberCode)) !== eligibility) throw new Error(`สมาชิกไม่อยู่ในสิทธิ์ ${eligibilityLabel(eligibility)}`);
      setSelected(prior => [...new Set([...prior, member.memberCode])]);
      setMessage(`เลือก ${member.fullName} (${member.memberCode}) แล้ว — ยังไม่ได้แจก; รหัสซ้ำไม่เพิ่มผู้รับ`);
    } catch (cause) { setMessage(errorText(cause)); }
  }
  function scanCoupon(code: string) {
    if (writing.current || pending.current || !state) return;
    try {
      const g = code.trim().toUpperCase().startsWith("BLU-PTC-") ? previewPointCoupon(code) : previewCoupon(code);
      if (isAdminGrant(g) && g.definition.benefit === "EXTRA_DAYS" && !readMembership(g.memberCode)) throw new Error("ผู้รับยังไม่มีแพ็กเกจ mock ที่บันทึก กรุณาซื้อแพ็กเกจก่อนแลกคูปองเพิ่มวัน");
      pending.current = true; setMode("REDEEM"); setRedemption(g); setMessage("");
    }
    catch (cause) { setMessage(errorText(cause)); }
  }
  function prepare() {
    try { const next = previewGrant(definitionId, selected, grantMode, new Date(), eligibleMembers.map(member => member.memberCode)); pending.current = true; setPlan(next); setMessage(""); }
    catch (cause) { setMessage(errorText(cause)); }
  }
  const disabled = busy || !!plan || !!redemption || !state || !!error;
  const definitions = state?.definitions.filter(d => d.kind === kind) ?? [];
  const adminMemberMap = useMemo(() => new Map(adminMembers.map(member => [member.memberCode, member])), [adminMembers]);
  const eligibleMembers = mockAdminMembers.filter(member => eligibility === "ALL" || memberEligibility(adminMemberMap.get(member.memberCode)) === eligibility);
  const members = eligibleMembers.filter(m => `${m.fullName} ${m.memberCode} ${m.cardNumber}`.toLowerCase().includes(search.trim().toLowerCase()));
  const grants = state?.grants.filter(g => {
    if (g.definition.kind !== kind) return false;
    const currentDefinition = state.definitions.find(definition => definition.id === g.definition.id);
    const status = !currentDefinition?.active ? "SUSPENDED" : g.status;
    return (!walletFilters.member || `${g.memberCode} ${g.memberName}`.toLowerCase().includes(walletFilters.member.toLowerCase().trim())) &&
      (walletFilters.memberType === "ALL" || memberEligibility(adminMemberMap.get(g.memberCode)) === walletFilters.memberType) &&
      (!walletFilters.name || g.definition.name.toLowerCase().includes(walletFilters.name.toLowerCase().trim())) &&
      (walletFilters.status === "ALL" || status === walletFilters.status) &&
      (!walletFilters.code || g.code.toLowerCase().includes(walletFilters.code.toLowerCase().trim()));
  }) ?? [];
  function edit(d: BenefitDefinition | null) { setExpected(d); setDraft(d ? { ...d } : newDefinition(kind)); }
  function exportCsv() {
    const header = ["หมายเลขสมาชิก", "ชื่อ", "นามสกุล", `ชื่อ${title}`, `รหัส${title}`, "ประเภทสมาชิก", "วันออก", "วันหมดอายุ", "ประเภท", "มูลค่า", "สถานะ"];
    const rows = grants.map(grant => {
      const [firstName, ...lastName] = grant.memberName.split(" ");
      const currentDefinition = state?.definitions.find(definition => definition.id === grant.definition.id);
      const status = !currentDefinition?.active ? "ระงับ" : grant.status === "USED" ? "ใช้แล้ว" : "ยังไม่ใช้งาน";
      return [grant.memberCode, firstName, lastName.join(" "), grant.definition.name, grant.code, eligibilityLabel(memberEligibility(adminMemberMap.get(grant.memberCode))), thaiDate(grant.issuedAt), thaiDate(grant.definition.expiresAt), grant.definition.discountType === "PERCENT" ? "เปอร์เซ็นต์" : "บาท", grant.definition.amount, status];
    });
    const csv = `\ufeff${[header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${coupon ? "coupons" : "promo-codes"}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }
  return <div className="mx-auto max-w-375 space-y-6" onKeyDownCapture={e => { if (pending.current && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); } }}>
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-black">จัดการ{title}</h1><p className="mt-2 text-sm text-blu-steel">{coupon ? "สร้างนิยาม → เลือก/สแกนผู้รับ → ยืนยันแจก → แลกใช้แยกโหมด" : "สร้างส่วนลด → เลือก/สแกนผู้รับ → ยืนยันแจก • นับการใช้เมื่อชำระ mock สำเร็จเท่านั้น"}</p></div><div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={refresh}>โหลดข้อมูลใหม่</button><button className={buttonClass} disabled={!grants.length} onClick={exportCsv}><Download className="mr-1 inline h-4 w-4" /> Export CSV</button></div></header>
    <MockNotice />
    <p className="text-sm text-blu-steel">ข้อมูล mock เฉพาะเบราว์เซอร์นี้: ส่วนลดที่แจกใช้ผ่าน PaymentModal ตอนซื้อแพ็กเกจ โดยบันทึกแพ็กเกจและใช้ส่วนลดพร้อมกันเมื่อยืนยันสำเร็จ • คูปองเพิ่มวันต่ออายุแพ็กเกจ mock ที่มีอยู่ ผู้รับต้องซื้อแพ็กเกจก่อน • ไม่มีการตัดเงินจริงหรือยืนยันสิทธิ์จาก backend <Link className="underline font-bold" href="/member/benefits">เปิดกระเป๋าสิทธิ์สมาชิก →</Link></p>
    {error && <p role="alert" className="rounded-xl bg-rose-100 p-4">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-blu-sky/30 p-4 text-sm">{message}</p>}
    <section className={panelClass}><div className="flex justify-between"><h2 className="font-bold">นิยาม{title}</h2><button className={buttonClass} disabled={disabled} onClick={() => edit(null)}>+ สร้าง{title}</button></div>
      <p className="text-xs text-blu-steel">โควต้า = จำนวนผู้รับสูงสุด • 1 สิทธิ์/นิยาม/สมาชิกตลอดประวัติ • แก้ไขมีผลต่อการแจกใหม่; สิทธิ์เดิมเก็บเงื่อนไข ณ วันแจก • ปิดใช้งานจะระงับสิทธิ์ค้างด้วย • เคยแจกแล้วลบไม่ได้</p>
      <div className="overflow-x-auto"><table className="w-full min-w-180 text-left text-sm"><thead><tr>{["ชื่อ / รหัส", "เงื่อนไข", "หมดอายุ (ไทย)", "แจก / ใช้ / ใช้สูงสุด / โควต้า", "สถานะ", "จัดการ"].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{definitions.map(d => {
        const issued = state!.grants.filter(g => g.definition.id === d.id);
        return <tr key={d.id} className="border-t border-blu-sky/30"><td className="p-3"><strong>{d.name}</strong><p className="font-mono text-xs">{d.code}</p></td><td className="p-3">{coupon ? `${d.benefit === "EXTRA_DAYS" ? "เพิ่มวัน (mock)" : "พาเพื่อน"} ${d.amount}` : `${d.amount}${d.discountType === "PERCENT" ? "%" : " บาท"} • ขั้นต่ำ ${d.minSpend} บาท`}<p className="text-xs">{d.detail}</p></td><td className="p-3">{thaiDate(d.expiresAt)}</td><td className="p-3">{issued.length} / {issued.filter(g => g.status === "USED").length} / {d.maxUses} / {d.quota}</td><td className="p-3">{d.active ? "เปิด" : "ปิด"}</td><td className="p-3"><div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={disabled} onClick={() => edit(d)}>แก้ไข</button><button className={buttonClass} disabled={disabled} onClick={() => { if (window.confirm(issued.length ? `ปิด ${d.name} และระงับสิทธิ์ค้าง? เก็บประวัติไว้` : `ลบ ${d.name}?`)) void run(async () => (await removeDefinition(d)) === "DISABLED" ? "ปิดใช้งานแล้ว เก็บประวัติครบ" : "ลบนิยามที่ยังไม่เคยแจกแล้ว"); }}>{issued.length ? "ปิดใช้งาน" : "ลบ"}</button></div></td></tr>;
      })}{!definitions.length && <tr><td colSpan={6} className="p-6 text-center">ยังไม่มีนิยาม เริ่มด้วย “สร้าง{title}”</td></tr>}</tbody></table></div>
    </section>
    {draft && <form className={panelClass} onSubmit={e => { e.preventDefault(); void run(async () => { await saveDefinition(draft, expected); setDraft(null); return "บันทึกนิยามแล้ว"; }); }}><h2 className="font-bold">{expected ? "แก้ไข" : "สร้าง"}{title}</h2><fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm">ชื่อ<input required maxLength={120} className={inputClass} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="space-y-1 text-sm">รหัสนิยาม (A–Z, 0–9, -)<input required minLength={3} maxLength={40} pattern="[A-Z0-9-]+" className={inputClass} value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })} /></label>
      {!coupon && <label className="space-y-1 text-sm">ประเภทส่วนลด<select className={inputClass} value={draft.discountType} onChange={e => setDraft({ ...draft, discountType: e.target.value as BenefitDefinition["discountType"] })}><option value="FIXED">จำนวนเงิน (บาท)</option><option value="PERCENT">เปอร์เซ็นต์</option></select></label>}
      {coupon && <label className="space-y-1 text-sm">ประเภทคูปอง<select className={inputClass} value={draft.benefit} onChange={e => setDraft({ ...draft, benefit: e.target.value as BenefitDefinition["benefit"] })}><option value="BRING_FRIEND">พาเพื่อน</option><option value="EXTRA_DAYS">เพิ่มวันแพ็กเกจ mock (ต้องมีแพ็กเกจก่อน)</option></select></label>}
      <label className="space-y-1 text-sm">{coupon ? "จำนวนคน / วัน" : "มูลค่าส่วนลด"}<input type="number" min={1} max={!coupon && draft.discountType === "PERCENT" ? 100 : 10000000} step={1} required className={inputClass} value={draft.amount} onChange={e => setDraft({ ...draft, amount: Number(e.target.value) })} /></label>
      {!coupon && <label className="space-y-1 text-sm">ยอดขั้นต่ำ (บาท)<input type="number" min={0} max={10000000} step={1} required className={inputClass} value={draft.minSpend} onChange={e => setDraft({ ...draft, minSpend: Number(e.target.value) })} /></label>}
      <label className="space-y-1 text-sm">จำนวนครั้งสูงสุดรวม<input type="number" min={1} max={100000} step={1} required className={inputClass} value={draft.maxUses} onChange={e => setDraft({ ...draft, maxUses: Number(e.target.value) })} /></label>
      <label className="space-y-1 text-sm">โควต้าผู้รับทั้งหมด<input type="number" min={1} max={100000} step={1} required className={inputClass} value={draft.quota} onChange={e => setDraft({ ...draft, quota: Number(e.target.value) })} /></label>
      <label className="space-y-1 text-sm">วันหมดอายุ (23:59:59 เวลาไทย)<input type="date" required className={inputClass} value={bangkokDay(new Date(draft.expiresAt))} onChange={e => { if (e.target.value) setDraft({ ...draft, expiresAt: new Date(`${e.target.value}T23:59:59+07:00`).toISOString() }); }} /></label>
      <label className="space-y-1 text-sm">รายละเอียด<input required maxLength={300} className={inputClass} value={draft.detail} onChange={e => setDraft({ ...draft, detail: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} />เปิดใช้งาน</label>
      <div className="flex gap-2"><button className={buttonClass}>บันทึกนิยาม</button><button type="button" className={buttonClass} onClick={() => setDraft(null)}>ยกเลิก</button></div>
    </fieldset></form>}
    {coupon && <div className="flex gap-3" aria-label="โหมดคูปอง"><button className={buttonClass} aria-pressed={mode === "GRANT"} disabled={disabled} onClick={() => setMode("GRANT")}>แจกคูปอง</button><button className={buttonClass} aria-pressed={mode === "REDEEM"} disabled={disabled} onClick={() => setMode("REDEEM")}>แลกใช้คูปอง (แยกจากแจก)</button></div>}
    {mode === "GRANT" ? <>
      <section className={panelClass}><h2 className="font-bold">เลือกสิทธิ์และผู้รับ — ยังไม่แจกจนกดยืนยัน</h2><fieldset disabled={disabled} className="space-y-4"><label className="block text-sm">สิทธิ์ที่จะแจก<select className={inputClass} value={definitionId} onChange={e => setDefinitionId(e.target.value)}><option value="">เลือกนิยาม{title}</option>{definitions.map(d => <option key={d.id} value={d.id} disabled={!d.active}>{d.name} • {d.code}{!d.active ? " (ปิด)" : ""}</option>)}</select></label>
        <label className="block text-sm">สิทธิ์สมาชิกที่จะได้รับ<select className={inputClass} value={eligibility} onChange={e => { const next = e.target.value as Eligibility; setEligibility(next); setSelected(prior => prior.filter(code => next === "ALL" || memberEligibility(adminMemberMap.get(code)) === next)); }}><option value="ALL">ทุกประเภทสมาชิก</option><option value="DAILY">รายวัน</option><option value="MONTHLY">รายเดือน</option><option value="3_MONTHS">3 เดือน</option><option value="6_MONTHS">6 เดือน</option><option value="12_MONTHS">12 เดือน</option></select></label>
        <div className="flex flex-wrap gap-4"><label><input type="radio" name="recipients" checked={grantMode === "SELECTED"} onChange={() => setGrantMode("SELECTED")} /> เลือกบางคน / สแกนบัตร</label><label><input type="radio" name="recipients" checked={grantMode === "ALL"} onChange={() => setGrantMode("ALL")} /> ทุกคนในสิทธิ์ที่เลือก ({eligibleMembers.length} คน)</label></div>
        {grantMode === "ALL" ? <p className="rounded-xl bg-amber-50 p-3 text-sm">รวมสมาชิกตามประเภทแพ็กเกจที่เลือกด้านล่าง ไม่ใช่เฉพาะผลค้นหา • ไม่รวมสมาชิกที่เพิ่มภายหลัง • ก่อนบันทึกจะแสดง snapshot ผู้รับและจำนวนที่ยังไม่เคยได้รับ</p> : <><input className={inputClass} aria-label="ค้นหาผู้รับ" placeholder="ค้นหาชื่อ / BLU-… / CARD-…" value={search} onChange={e => setSearch(e.target.value)} /><div className="flex gap-2"><button type="button" className={buttonClass} onClick={() => setSelected(prior => [...new Set([...prior, ...members.map(m => m.memberCode)])])}>เลือกผลค้นหาทั้งหมด</button><button type="button" className={buttonClass} onClick={() => setSelected([])}>ล้างที่เลือก ({selected.length})</button></div></>}
        <div className="grid gap-2 sm:grid-cols-2">{(grantMode === "ALL" ? eligibleMembers : members).map(m => <label key={m.memberCode} className="flex gap-3 rounded-xl bg-blu-ice p-3 text-sm"><input type="checkbox" disabled={grantMode === "ALL"} checked={grantMode === "ALL" || selected.includes(m.memberCode)} onChange={e => setSelected(prior => e.target.checked ? [...new Set([...prior, m.memberCode])] : prior.filter(c => c !== m.memberCode))} /><span>{m.fullName}<span className="block font-mono text-xs">{m.memberCode} / {m.cardNumber}</span></span></label>)}</div>
        {grantMode === "SELECTED" && <p className="text-sm">เลือกทั้งหมด {selected.length} คน (รวมรายการนอกผลค้นหา): {selected.map(c => mockAdminMembers.find(m => m.memberCode === c)?.fullName).join(", ") || "ยังไม่เลือก"}</p>}
        <button type="button" className={buttonClass} disabled={!definitionId || (grantMode === "SELECTED" && !selected.length)} onClick={prepare}>ตรวจสอบรายชื่อและจำนวนก่อนแจก</button>
      </fieldset></section>
      <AdminScanner label={`สแกนสมาชิกเพื่อเลือกผู้รับ${title}: BLU-… / CARD-…`} disabled={disabled || grantMode === "ALL"} onScan={scanMember} />
    </> : <AdminScanner label="แลกใช้คูปอง: BLU-CP-… หรือ BLU-PTC-…" disabled={disabled} onScan={scanCoupon} />}
    {plan && <Confirmation key={plan.batchId} busy={busy || !state} onCancel={cancel} label={`ยืนยันแจก ${plan.newCodes.length} คน`} onConfirm={() => void run(async () => { const count = await commitGrant(plan); setSelected([]); return `แจกเข้า ${count} กระเป๋า mock แล้ว — ยังไม่มีการใช้สิทธิ์`; })}><h2 className="text-lg font-bold">ยืนยันแจก {definitions.find(d => d.id === plan.definitionId)?.name}</h2><p>snapshot {plan.memberCodes.length} คน • แจกใหม่ <strong>{plan.newCodes.length} คน</strong> • ข้ามผู้ที่เคยได้รับ {plan.skipped} คน</p><ul className="max-h-64 overflow-y-auto text-sm">{plan.memberCodes.map(c => <li key={c}>{mockAdminMembers.find(m => m.memberCode === c)?.fullName} ({c}) — {plan.newCodes.includes(c) ? "จะได้รับ" : "ข้าม: เคยได้รับแล้ว"}</li>)}</ul><p className="text-xs">ไม่มีการติดตามสมาชิกใหม่อัตโนมัติ • นิยามเดิมไม่แจกซ้ำแม้ใช้ไปแล้ว</p></Confirmation>}
    {redemption && <Confirmation key={redemption.id} busy={busy || !state} onCancel={cancel} label="ยืนยันแลกใช้คูปอง" onConfirm={() => void run(async () => {
      if (isAdminGrant(redemption)) {
        await redeemCoupon(redemption);
        return redemption.definition.benefit === "EXTRA_DAYS" ? `เพิ่มอายุแพ็กเกจ mock ${redemption.definition.amount} วัน พร้อมบันทึกใช้คูปองแล้ว ตรวจสอบวันหมดอายุใหม่ได้ที่บัตรสมาชิก` : "บันทึกแลกใช้คูปองพาเพื่อน mock แล้ว ไม่มีการยืนยันสิทธิ์เข้าใช้จาก backend";
      }
      await consumePointCoupon(redemption);
      return "บันทึกใช้คูปองที่แลกจากคะแนนแล้ว • ไม่หักคะแนนซ้ำ";
    })}>{isAdminGrant(redemption) ? <><h2 className="font-bold">{redemption.definition.name}</h2><p>ผู้รับ: {redemption.memberName} ({redemption.memberCode})</p><p>{redemption.definition.detail} • จำนวน {redemption.definition.amount}</p><p className="break-all font-mono text-xs">{redemption.code}</p><p>หมดอายุ: {thaiDate(redemption.definition.expiresAt)}</p><p className="text-sm">{redemption.definition.benefit === "EXTRA_DAYS" ? "ยืนยันแล้วจะเพิ่มวันหมดอายุแพ็กเกจ mock ของผู้รับพร้อมใช้คูปอง ต้องมีแพ็กเกจที่บันทึกแล้ว (ไม่ใช้แม่แบบบัตรสมาชิก)" : "ตรวจสอบบัตรสมาชิกก่อนส่งมอบ"} • ไม่หักแต้ม</p></> : <><h2 className="font-bold">{redemption.title}</h2><p>ผู้รับ: {mockAdminMembers.find(member => member.memberCode === redemption.memberCode)?.fullName ?? redemption.memberCode} ({redemption.memberCode})</p><p>{redemption.detail} • แลกด้วย {redemption.pointsSpent} คะแนน</p><p className="break-all font-mono text-xs">{redemption.code}</p><p>หมดอายุ: {thaiDate(redemption.expiresAt)}</p><p className="text-sm">คะแนนถูกหักตอนสมาชิกแลกคูปองแล้ว การยืนยันนี้เปลี่ยนเฉพาะสถานะเป็นใช้แล้ว</p></>}</Confirmation>}
    <section className={panelClass}><h2 className="font-bold">กระเป๋า / ประวัติการแจก{title}</h2><div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><label className="space-y-1 text-xs">หมายเลขสมาชิก / ชื่อ<input className={inputClass} value={walletFilters.member} onChange={e => setWalletFilters({ ...walletFilters, member: e.target.value })} placeholder="BLU-…" /></label><label className="space-y-1 text-xs">ประเภทสมาชิก<select className={inputClass} value={walletFilters.memberType} onChange={e => setWalletFilters({ ...walletFilters, memberType: e.target.value })}><option value="ALL">ทั้งหมด</option><option value="DAILY">รายวัน</option><option value="MONTHLY">รายเดือน</option><option value="3_MONTHS">3 เดือน</option><option value="6_MONTHS">6 เดือน</option><option value="12_MONTHS">12 เดือน</option></select></label><label className="space-y-1 text-xs">ชื่อ{title}<input className={inputClass} value={walletFilters.name} onChange={e => setWalletFilters({ ...walletFilters, name: e.target.value })} /></label><label className="space-y-1 text-xs">สถานะ<select className={inputClass} value={walletFilters.status} onChange={e => setWalletFilters({ ...walletFilters, status: e.target.value })}><option value="ALL">ทั้งหมด</option><option value="UNUSED">ยังไม่ใช้งาน</option><option value="USED">ใช้แล้ว</option><option value="SUSPENDED">ระงับ</option></select></label><label className="space-y-1 text-xs">รหัส{title}<input className={inputClass} value={walletFilters.code} onChange={e => setWalletFilters({ ...walletFilters, code: e.target.value })} /></label></div><button type="button" className="text-xs font-bold text-blu-slate underline" onClick={() => setWalletFilters({ member: "", memberType: "ALL", name: "", status: "ALL", code: "" })}>ล้างตัวกรอง</button>
      <div className="overflow-x-auto"><table className="w-full min-w-250 text-left text-sm"><thead><tr>{["หมายเลขสมาชิก / ชื่อ-สกุล", "ประเภทสมาชิก", `ชื่อ${title} / เงื่อนไข`, "วันออก / วันหมดอายุ", "ประเภท / สถานะ", `รหัส${title}`].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{grants.map(g => { const suspended = !state!.definitions.find(d => d.id === g.definition.id)?.active; return <tr key={g.id} className="border-t border-blu-sky/30"><td className="p-3"><strong>{g.memberCode}</strong><p className="text-xs">{g.memberName}</p></td><td className="p-3">{eligibilityLabel(memberEligibility(adminMemberMap.get(g.memberCode)))}</td><td className="p-3"><strong>{g.definition.name}</strong><p className="text-xs">{g.definition.detail} • {g.definition.amount}{g.definition.kind === "PROMO" && g.definition.discountType === "PERCENT" ? "%" : " บาท"}</p></td><td className="p-3 text-xs">{thaiDate(g.issuedAt)}<p>หมดอายุ {thaiDate(g.definition.expiresAt)}</p><p>{g.usedAt ? `ใช้ ${thaiDate(g.usedAt)}` : "ยังไม่ใช้"}</p></td><td className="p-3">{g.definition.discountType === "PERCENT" ? "เปอร์เซ็นต์" : "บาท"}<p className={suspended ? "text-rose-500" : g.status === "USED" ? "text-blu-slate" : "text-emerald-600"}>{suspended ? "ระงับ" : g.status === "USED" ? "ใช้แล้ว" : "ยังไม่ใช้งาน"}</p>{g.paymentId && <p className="text-xs">ชำระ mock {g.paidAmount} บาท</p>}</td><td className="p-3"><button className={buttonClass} onClick={() => setQr(qr === g.code ? "" : g.code)}>แสดง QR / รหัส</button>{coupon && g.status === "UNUSED" && <button className={`${buttonClass} mt-2`} disabled={disabled} onClick={() => scanCoupon(g.code)}>ตรวจสอบแลกใช้</button>}{qr === g.code && <div className="mt-3 space-y-2"><QRCodeSVG value={g.code} size={144} title={`สิทธิ์ ${g.memberName}`} /><p className="max-w-52 break-all font-mono text-xs select-all">{g.code}</p></div>}</td></tr>; })}{!grants.length && <tr><td colSpan={6} className="p-6 text-center">ยังไม่มีรายการที่ตรงกับการค้นหา</td></tr>}</tbody></table></div>
    </section>
  </div>;
}
