"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { buttonClass, Confirmation, inputClass, MockNotice, panelClass } from "@/components/AdminScanner";
import { mockAdminMembers } from "@/lib/admin-mock";
import { BENEFITS_EVENT, BENEFITS_KEY, completeMockPayment, previewMockPayment, readBenefits, type BenefitsState, type MockPayment } from "@/lib/benefits";

export default function MockBenefitsWallet() {
  const [state, setState] = useState<BenefitsState | null>(null);
  const [memberCode, setMemberCode] = useState(mockAdminMembers[0].memberCode);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [subtotal, setSubtotal] = useState(1000);
  const [payment, setPayment] = useState<MockPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const refresh = useCallback(() => {
    try { setState(readBenefits()); setError(""); }
    catch (cause) { setState(null); setError(cause instanceof Error ? cause.message : "อ่านกระเป๋าไม่ได้"); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const sync = (e: StorageEvent) => { if (e.key === BENEFITS_KEY || e.key === null) refresh(); };
    window.addEventListener("storage", sync); window.addEventListener(BENEFITS_EVENT, refresh);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(BENEFITS_EVENT, refresh); };
  }, [refresh]);
  async function confirmPayment() {
    if (!payment || writing.current) return;
    writing.current = true; setBusy(true);
    try { await completeMockPayment(payment); setMessage("ชำระ mock สำเร็จ บันทึกการใช้ส่วนลดแล้ว — ไม่มีการตัดเงินจริงหรือเปิดแพ็กเกจ"); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "บันทึกไม่ได้"); }
    finally { writing.current = false; setBusy(false); setPayment(null); refresh(); }
  }
  const grants = state?.grants.filter(g => g.memberCode === memberCode) ?? [];
  return <main className="mx-auto max-w-4xl space-y-5 px-4 py-24 text-blu-dark" onKeyDownCapture={e => { if (payment && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); } }}>
    <h1 className="text-2xl font-black">กระเป๋าสิทธิ์ทดลอง (Mock Wallet)</h1><MockNotice />
    <p className="text-sm">เลือกสมาชิกตัวอย่างเพื่อทดสอบเท่านั้น <strong>ไม่ใช่การเข้าสู่ระบบหรือการยืนยันตัวตน</strong> • ใช้ข้อมูลเดียวกับหน้า Admin • คูปองนำ QR ไปแลกที่หน้า Admin/Coupons • ส่วนลดใช้กับการชำระจำลองด้านล่าง ไม่เชื่อม PaymentModal/PromptPay เดิม</p>
    <nav className="flex flex-wrap gap-4 text-sm underline"><Link href="/admin/promo-codes">แจกส่วนลด</Link><Link href="/admin/coupons">แจก / แลกคูปอง</Link><Link href="/member/rewards">ของรางวัล</Link></nav>
    <section className={panelClass}><label className="block text-sm">สมาชิกตัวอย่าง<select className={inputClass} disabled={!!payment || busy} value={memberCode} onChange={e => { setMemberCode(e.target.value); setMessage(""); }}>{mockAdminMembers.map(m => <option key={m.memberCode} value={m.memberCode}>{m.fullName} ({m.memberCode})</option>)}</select></label><label className="block text-sm">ยอดชำระจำลองก่อนส่วนลด (บาทเต็ม)<input className={inputClass} type="number" min={1} max={10000000} step={1} value={subtotal} disabled={!!payment || busy} onChange={e => setSubtotal(Number(e.target.value))} /></label><button className={buttonClass} disabled={busy} onClick={refresh}>โหลดกระเป๋าใหม่</button></section>
    {error && <p role="alert" className="rounded-xl bg-rose-100 p-4">{error}</p>}{message && <p role="status" className="rounded-xl bg-blu-sky/30 p-4">{message}</p>}
    {payment && <Confirmation key={payment.paymentId} busy={busy || !state} onCancel={() => setPayment(null)} onConfirm={() => void confirmPayment()} label="ยืนยันชำระจำลอง (ไม่ตัดเงินจริง)"><h2 className="font-bold">ตรวจสอบชำระ mock ให้ {mockAdminMembers.find(m => m.memberCode === payment.memberCode)?.fullName}</h2><p>ยอดก่อนลด {payment.subtotal} บาท − ส่วนลด {payment.discount} บาท = <strong>{payment.total} บาท</strong></p><p className="break-all font-mono text-xs">{payment.grantCode}</p><p className="text-sm">การเปิดหน้านี้/ดู QR/คำนวณส่วนลดไม่ถือว่าใช้ • กดยืนยันจึงบันทึกใช้สิทธิ์พร้อมรายการชำระ mock ในครั้งเดียว</p></Confirmation>}
    <div className="grid gap-4 sm:grid-cols-2">{grants.map(g => <article key={g.id} className={panelClass}><h2 className="font-bold">{g.definition.name}</h2><p className="text-sm">{g.definition.kind === "PROMO" ? `ส่วนลด ${g.definition.amount}${g.definition.discountType === "PERCENT" ? "%" : " บาท"} • ยอดขั้นต่ำ ${g.definition.minSpend} บาท` : `${g.definition.benefit === "EXTRA_DAYS" ? "เพิ่มวัน (mock)" : "พาเพื่อน"} ${g.definition.amount}`}</p><p className="text-sm">{g.definition.detail}</p><p className="text-xs">หมดอายุ {new Date(g.definition.expiresAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p><p className="font-bold">{g.status === "USED" ? "ใช้แล้ว" : "ยังไม่ใช้"}{!state!.definitions.find(d => d.id === g.definition.id)?.active ? " • ระงับ" : ""}</p>{g.usedAt && <p className="text-xs">ใช้เมื่อ {new Date(g.usedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}{g.paymentId && ` • ชำระ mock ${g.paidAmount} บาท • รายการ ${g.paymentId}`}</p>}<QRCodeSVG value={g.code} size={144} title={`สิทธิ์ ${g.memberName}`} /><p className="break-all font-mono text-xs select-all">{g.code}</p>{g.definition.kind === "PROMO" && <button className={buttonClass} disabled={busy || !!payment || g.status !== "UNUSED" || !state!.definitions.find(d => d.id === g.definition.id)?.active} onClick={() => { try { setPayment(previewMockPayment(g.code, memberCode, subtotal)); setMessage(""); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "ตรวจสอบไม่ได้"); } }}>ตรวจสอบส่วนลดก่อนชำระ mock</button>}</article>)}</div>
    {state && !grants.length && <p className={panelClass}>ยังไม่มีสิทธิ์ที่แจกให้สมาชิกนี้ — ไม่สร้างคูปองหรือส่วนลดอัตโนมัติ</p>}
  </main>;
}
