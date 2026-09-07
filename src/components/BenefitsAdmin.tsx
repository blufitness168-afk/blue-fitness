"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import AdminScanner, { buttonClass, Confirmation, inputClass, MockNotice, panelClass } from "./AdminScanner";
import { mockAdminMembers } from "@/lib/admin-mock";
import { bangkokDay } from "@/lib/checkin";
import { BENEFITS_EVENT, BENEFITS_KEY, commitGrant, newDefinition, previewCoupon, previewGrant, readBenefits, redeemCoupon, removeDefinition, resolveBenefitMember, saveDefinition, type BenefitDefinition, type BenefitGrant, type BenefitKind, type BenefitsState, type GrantPlan } from "@/lib/benefits";

const errorText = (error: unknown) => error instanceof Error ? error.message : "ทำรายการไม่ได้ กรุณาลองใหม่";
const thaiDate = (value: string) => new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
export default function BenefitsAdmin({ kind }: { kind: BenefitKind }) {
  const coupon = kind === "COUPON";
  const title = coupon ? "คูปอง" : "โค้ดส่วนลด";
  const [state, setState] = useState<BenefitsState | null>(null);
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
  const [mode, setMode] = useState<"GRANT" | "REDEEM">("GRANT");
  const [plan, setPlan] = useState<GrantPlan | null>(null);
  const [redemption, setRedemption] = useState<BenefitGrant | null>(null);
  const pending = useRef(false);
  const [walletQuery, setWalletQuery] = useState("");
  const [qr, setQr] = useState("");
  const refresh = useCallback(() => {
    try { setState(readBenefits()); setError(""); }
    catch (cause) { setState(null); setError(errorText(cause)); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const sync = (e: StorageEvent) => { if (e.key === BENEFITS_KEY || e.key === null) refresh(); };
    window.addEventListener("storage", sync); window.addEventListener(BENEFITS_EVENT, refresh);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(BENEFITS_EVENT, refresh); };
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
      setSelected(prior => [...new Set([...prior, member.memberCode])]);
      setMessage(`เลือก ${member.fullName} (${member.memberCode}) แล้ว — ยังไม่ได้แจก; รหัสซ้ำไม่เพิ่มผู้รับ`);
    } catch (cause) { setMessage(errorText(cause)); }
  }
  function scanCoupon(code: string) {
    if (writing.current || pending.current || !state) return;
    try { const g = previewCoupon(code); pending.current = true; setMode("REDEEM"); setRedemption(g); setMessage(""); }
    catch (cause) { setMessage(errorText(cause)); }
  }
  function prepare() {
    try { const next = previewGrant(definitionId, selected, grantMode); pending.current = true; setPlan(next); setMessage(""); }
    catch (cause) { setMessage(errorText(cause)); }
  }
  const disabled = busy || !!plan || !!redemption || !state || !!error;
  const definitions = state?.definitions.filter(d => d.kind === kind) ?? [];
  const members = mockAdminMembers.filter(m => `${m.fullName} ${m.memberCode} ${m.cardNumber}`.toLowerCase().includes(search.trim().toLowerCase()));
  const grants = state?.grants.filter(g => g.definition.kind === kind && `${g.memberCode} ${g.memberName} ${g.definition.name} ${g.code}`.toLowerCase().includes(walletQuery.trim().toLowerCase())) ?? [];
  function edit(d: BenefitDefinition | null) { setExpected(d); setDraft(d ? { ...d } : newDefinition(kind)); }
  return <div className="mx-auto max-w-6xl space-y-6" onKeyDownCapture={e => { if (pending.current && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); } }}>
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-black">จัดการ{title}</h1><p className="mt-2 text-sm text-blu-steel">{coupon ? "สร้างนิยาม → เลือก/สแกนผู้รับ → ยืนยันแจก → แลกใช้แยกโหมด" : "สร้างส่วนลด → เลือก/สแกนผู้รับ → ยืนยันแจก • นับการใช้เมื่อชำระ mock สำเร็จเท่านั้น"}</p></div><button className={buttonClass} disabled={busy} onClick={refresh}>โหลดข้อมูลใหม่</button></header>
    <MockNotice />
    <p className="text-sm text-blu-steel">กระเป๋า mock บันทึกผู้รับและประวัติจริงในเบราว์เซอร์นี้ แต่ไม่เพิ่มวันสมาชิก/สิทธิ์เข้าใช้จริง และไม่เชื่อม PaymentModal เดิม <Link className="underline font-bold" href="/member/benefits">เปิดกระเป๋าสิทธิ์และจำลองชำระส่วนลด →</Link></p>
    {error && <p role="alert" className="rounded-xl bg-rose-100 p-4">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-blu-sky/30 p-4 text-sm">{message}</p>}
    <section className={panelClass}><div className="flex justify-between"><h2 className="font-bold">นิยาม{title}</h2><button className={buttonClass} disabled={disabled} onClick={() => edit(null)}>+ สร้าง{title}</button></div>
      <p className="text-xs text-blu-steel">โควต้า = จำนวนผู้รับสูงสุด • 1 สิทธิ์/นิยาม/สมาชิกตลอดประวัติ • แก้ไขมีผลต่อการแจกใหม่; สิทธิ์เดิมเก็บเงื่อนไข ณ วันแจก • ปิดใช้งานจะระงับสิทธิ์ค้างด้วย • เคยแจกแล้วลบไม่ได้</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr>{["ชื่อ / รหัส", "เงื่อนไข", "หมดอายุ (ไทย)", "แจก / ใช้ / โควต้า", "สถานะ", "จัดการ"].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{definitions.map(d => {
        const issued = state!.grants.filter(g => g.definition.id === d.id);
        return <tr key={d.id} className="border-t border-blu-sky/30"><td className="p-3"><strong>{d.name}</strong><p className="font-mono text-xs">{d.code}</p></td><td className="p-3">{coupon ? `${d.benefit === "EXTRA_DAYS" ? "เพิ่มวัน (mock)" : "พาเพื่อน"} ${d.amount}` : `${d.amount}${d.discountType === "PERCENT" ? "%" : " บาท"} • ขั้นต่ำ ${d.minSpend} บาท`}<p className="text-xs">{d.detail}</p></td><td className="p-3">{thaiDate(d.expiresAt)}</td><td className="p-3">{issued.length} / {issued.filter(g => g.status === "USED").length} / {d.quota}</td><td className="p-3">{d.active ? "เปิด" : "ปิด"}</td><td className="p-3"><div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={disabled} onClick={() => edit(d)}>แก้ไข</button><button className={buttonClass} disabled={disabled} onClick={() => { if (window.confirm(issued.length ? `ปิด ${d.name} และระงับสิทธิ์ค้าง? เก็บประวัติไว้` : `ลบ ${d.name}?`)) void run(async () => (await removeDefinition(d)) === "DISABLED" ? "ปิดใช้งานแล้ว เก็บประวัติครบ" : "ลบนิยามที่ยังไม่เคยแจกแล้ว"); }}>{issued.length ? "ปิดใช้งาน" : "ลบ"}</button></div></td></tr>;
      })}{!definitions.length && <tr><td colSpan={6} className="p-6 text-center">ยังไม่มีนิยาม เริ่มด้วย “สร้าง{title}”</td></tr>}</tbody></table></div>
    </section>
    {draft && <form className={panelClass} onSubmit={e => { e.preventDefault(); void run(async () => { await saveDefinition(draft, expected); setDraft(null); return "บันทึกนิยามแล้ว"; }); }}><h2 className="font-bold">{expected ? "แก้ไข" : "สร้าง"}{title}</h2><fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm">ชื่อ<input required maxLength={120} className={inputClass} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="space-y-1 text-sm">รหัสนิยาม (A–Z, 0–9, -)<input required minLength={3} maxLength={40} pattern="[A-Z0-9-]+" className={inputClass} value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })} /></label>
      {!coupon && <label className="space-y-1 text-sm">ประเภทส่วนลด<select className={inputClass} value={draft.discountType} onChange={e => setDraft({ ...draft, discountType: e.target.value as BenefitDefinition["discountType"] })}><option value="FIXED">จำนวนเงิน (บาท)</option><option value="PERCENT">เปอร์เซ็นต์</option></select></label>}
      {coupon && <label className="space-y-1 text-sm">ประเภทคูปอง<select className={inputClass} value={draft.benefit} onChange={e => setDraft({ ...draft, benefit: e.target.value as BenefitDefinition["benefit"] })}><option value="BRING_FRIEND">พาเพื่อน</option><option value="EXTRA_DAYS">เพิ่มวัน (บันทึก mock เท่านั้น)</option></select></label>}
      <label className="space-y-1 text-sm">{coupon ? "จำนวนคน / วัน" : "มูลค่าส่วนลด"}<input type="number" min={1} max={!coupon && draft.discountType === "PERCENT" ? 100 : 10000000} step={1} required className={inputClass} value={draft.amount} onChange={e => setDraft({ ...draft, amount: Number(e.target.value) })} /></label>
      {!coupon && <label className="space-y-1 text-sm">ยอดขั้นต่ำ (บาท)<input type="number" min={0} max={10000000} step={1} required className={inputClass} value={draft.minSpend} onChange={e => setDraft({ ...draft, minSpend: Number(e.target.value) })} /></label>}
      <label className="space-y-1 text-sm">โควต้าผู้รับทั้งหมด<input type="number" min={1} max={100000} step={1} required className={inputClass} value={draft.quota} onChange={e => setDraft({ ...draft, quota: Number(e.target.value) })} /></label>
      <label className="space-y-1 text-sm">วันหมดอายุ (23:59:59 เวลาไทย)<input type="date" required className={inputClass} value={bangkokDay(new Date(draft.expiresAt))} onChange={e => { if (e.target.value) setDraft({ ...draft, expiresAt: new Date(`${e.target.value}T23:59:59+07:00`).toISOString() }); }} /></label>
      <label className="space-y-1 text-sm">รายละเอียด<input required maxLength={300} className={inputClass} value={draft.detail} onChange={e => setDraft({ ...draft, detail: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} />เปิดใช้งาน</label>
      <div className="flex gap-2"><button className={buttonClass}>บันทึกนิยาม</button><button type="button" className={buttonClass} onClick={() => setDraft(null)}>ยกเลิก</button></div>
    </fieldset></form>}
    {coupon && <div className="flex gap-3" aria-label="โหมดคูปอง"><button className={buttonClass} aria-pressed={mode === "GRANT"} disabled={disabled} onClick={() => setMode("GRANT")}>แจกคูปอง</button><button className={buttonClass} aria-pressed={mode === "REDEEM"} disabled={disabled} onClick={() => setMode("REDEEM")}>แลกใช้คูปอง (แยกจากแจก)</button></div>}
    {mode === "GRANT" ? <>
      <section className={panelClass}><h2 className="font-bold">เลือกสิทธิ์และผู้รับ — ยังไม่แจกจนกดยืนยัน</h2><fieldset disabled={disabled} className="space-y-4"><label className="block text-sm">สิทธิ์ที่จะแจก<select className={inputClass} value={definitionId} onChange={e => setDefinitionId(e.target.value)}><option value="">เลือกนิยาม{title}</option>{definitions.map(d => <option key={d.id} value={d.id} disabled={!d.active}>{d.name} • {d.code}{!d.active ? " (ปิด)" : ""}</option>)}</select></label>
        <div className="flex flex-wrap gap-4"><label><input type="radio" name="recipients" checked={grantMode === "SELECTED"} onChange={() => setGrantMode("SELECTED")} /> เลือกบางคน / สแกนบัตร</label><label><input type="radio" name="recipients" checked={grantMode === "ALL"} onChange={() => setGrantMode("ALL")} /> ทุกคนปัจจุบัน ({mockAdminMembers.length} คน)</label></div>
        {grantMode === "ALL" ? <p className="rounded-xl bg-amber-50 p-3 text-sm">รวมสมาชิกปัจจุบันทุกสถานะตามรายชื่อด้านล่าง ไม่ใช่เฉพาะผลค้นหา • ไม่รวมสมาชิกที่เพิ่มภายหลัง • ก่อนบันทึกจะแสดง snapshot ผู้รับและจำนวนที่ยังไม่เคยได้รับ</p> : <><input className={inputClass} aria-label="ค้นหาผู้รับ" placeholder="ค้นหาชื่อ / BLU-… / CARD-…" value={search} onChange={e => setSearch(e.target.value)} /><div className="flex gap-2"><button type="button" className={buttonClass} onClick={() => setSelected(prior => [...new Set([...prior, ...members.map(m => m.memberCode)])])}>เลือกผลค้นหาทั้งหมด</button><button type="button" className={buttonClass} onClick={() => setSelected([])}>ล้างที่เลือก ({selected.length})</button></div></>}
        <div className="grid gap-2 sm:grid-cols-2">{(grantMode === "ALL" ? mockAdminMembers : members).map(m => <label key={m.memberCode} className="flex gap-3 rounded-xl bg-blu-ice p-3 text-sm"><input type="checkbox" disabled={grantMode === "ALL"} checked={grantMode === "ALL" || selected.includes(m.memberCode)} onChange={e => setSelected(prior => e.target.checked ? [...new Set([...prior, m.memberCode])] : prior.filter(c => c !== m.memberCode))} /><span>{m.fullName}<span className="block font-mono text-xs">{m.memberCode} / {m.cardNumber}</span></span></label>)}</div>
        {grantMode === "SELECTED" && <p className="text-sm">เลือกทั้งหมด {selected.length} คน (รวมรายการนอกผลค้นหา): {selected.map(c => mockAdminMembers.find(m => m.memberCode === c)?.fullName).join(", ") || "ยังไม่เลือก"}</p>}
        <button type="button" className={buttonClass} disabled={!definitionId || (grantMode === "SELECTED" && !selected.length)} onClick={prepare}>ตรวจสอบรายชื่อและจำนวนก่อนแจก</button>
      </fieldset></section>
      <AdminScanner label={`สแกนสมาชิกเพื่อเลือกผู้รับ${title}: BLU-… / CARD-…`} disabled={disabled || grantMode === "ALL"} onScan={scanMember} />
    </> : <AdminScanner label="แลกใช้คูปองที่แจกแล้ว: BLU-CP-… เท่านั้น" disabled={disabled} onScan={scanCoupon} />}
    {plan && <Confirmation key={plan.batchId} busy={busy || !state} onCancel={cancel} label={`ยืนยันแจก ${plan.newCodes.length} คน`} onConfirm={() => void run(async () => { const count = await commitGrant(plan); setSelected([]); return `แจกเข้า ${count} กระเป๋า mock แล้ว — ยังไม่มีการใช้สิทธิ์`; })}><h2 className="text-lg font-bold">ยืนยันแจก {definitions.find(d => d.id === plan.definitionId)?.name}</h2><p>snapshot {plan.memberCodes.length} คน • แจกใหม่ <strong>{plan.newCodes.length} คน</strong> • ข้ามผู้ที่เคยได้รับ {plan.skipped} คน</p><ul className="max-h-64 overflow-y-auto text-sm">{plan.memberCodes.map(c => <li key={c}>{mockAdminMembers.find(m => m.memberCode === c)?.fullName} ({c}) — {plan.newCodes.includes(c) ? "จะได้รับ" : "ข้าม: เคยได้รับแล้ว"}</li>)}</ul><p className="text-xs">ไม่มีการติดตามสมาชิกใหม่อัตโนมัติ • นิยามเดิมไม่แจกซ้ำแม้ใช้ไปแล้ว</p></Confirmation>}
    {redemption && <Confirmation key={redemption.id} busy={busy || !state} onCancel={cancel} label="ยืนยันแลกใช้คูปอง" onConfirm={() => void run(async () => { await redeemCoupon(redemption); return "บันทึกแลกใช้คูปอง mock แล้ว ไม่ได้ต่ออายุสมาชิกหรือเพิ่มสิทธิ์จริง"; })}><h2 className="font-bold">{redemption.definition.name}</h2><p>ผู้รับ: {redemption.memberName} ({redemption.memberCode})</p><p>{redemption.definition.detail} • จำนวน {redemption.definition.amount}</p><p className="break-all font-mono text-xs">{redemption.code}</p><p>หมดอายุ: {thaiDate(redemption.definition.expiresAt)}</p><p className="text-sm">ตรวจสอบบัตรสมาชิกก่อนส่งมอบ • ไม่หักแต้ม</p></Confirmation>}
    <section className={panelClass}><h2 className="font-bold">กระเป๋า / ประวัติการแจก{title}</h2><input className={inputClass} aria-label="ค้นหากระเป๋า" placeholder="ค้นหาผู้รับ ชื่อสิทธิ์ หรือรหัส" value={walletQuery} onChange={e => setWalletQuery(e.target.value)} />
      <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead><tr>{["ผู้รับ", "สิทธิ์ ณ วันแจก", "สถานะ", "วันแจก / วันใช้ (ไทย)", "รหัสสิทธิ์"].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{grants.map(g => <tr key={g.id} className="border-t border-blu-sky/30"><td className="p-3">{g.memberName}<p className="text-xs">{g.memberCode}</p></td><td className="p-3">{g.definition.name}<p className="text-xs">{g.definition.detail} • จำนวน/ส่วนลด {g.definition.amount}{g.definition.kind === "PROMO" && g.definition.discountType === "PERCENT" ? "%" : ""}</p><p className="text-xs">หมดอายุ {thaiDate(g.definition.expiresAt)}</p></td><td className="p-3">{g.status === "USED" ? "ใช้แล้ว" : "ยังไม่ใช้"}{!state!.definitions.find(d => d.id === g.definition.id)?.active && <p>ระงับ</p>}{g.paymentId && <p className="text-xs">ชำระ mock {g.paidAmount} บาท</p>}</td><td className="p-3 text-xs">{thaiDate(g.issuedAt)}<p>{g.usedAt ? thaiDate(g.usedAt) : "—"}</p></td><td className="p-3"><button className={buttonClass} onClick={() => setQr(qr === g.code ? "" : g.code)}>แสดง QR / รหัส</button>{coupon && g.status === "UNUSED" && <button className={`${buttonClass} mt-2`} disabled={disabled} onClick={() => scanCoupon(g.code)}>ตรวจสอบแลกใช้</button>}{qr === g.code && <div className="mt-3 space-y-2"><QRCodeSVG value={g.code} size={144} title={`สิทธิ์ ${g.memberName}`} /><p className="max-w-52 break-all font-mono text-xs select-all">{g.code}</p></div>}</td></tr>)}{!grants.length && <tr><td colSpan={5} className="p-6 text-center">ยังไม่มีรายการที่ตรงกับการค้นหา</td></tr>}</tbody></table></div>
    </section>
  </div>;
}
