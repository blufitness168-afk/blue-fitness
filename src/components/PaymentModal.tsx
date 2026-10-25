"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { X, Loader2, CheckCircle2 } from "lucide-react";
import type { MockPackage } from "@/lib/mock-data";
import { RECEIVER_BLOCKER } from "@/lib/payment-policy";

type Order = {
  id: string; package: MockPackage; receiver: { promptpay: string; bankCode: string; bankAccount: string; name: string };
  amountSatang: number; subtotalSatang: number; discountSatang: number; expiresAt: string; uploadDeadline: string;
  readiness: { transfersEnabled: boolean; blocker: string | null }; rejectionReason: string | null;
  status: "PENDING" | "PAID" | "REJECTED"; qrPayload: string | null; membershipExpiresAt: string | null; pointsEarned: number;
};
const money = (amount: number) => (amount / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 });
const date = (value: string) => new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
export default function PaymentModal({ pkg, isOpen, onClose }: { pkg: MockPackage | null; isOpen: boolean; onClose: () => void }) {
  if (!isOpen || !pkg) return null;
  return <PaymentForm key={pkg.id} pkg={pkg} onClose={onClose} />;
}
function PaymentForm({ pkg, onClose }: { pkg: MockPackage; onClose: () => void }) {
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [ownerRecheckAvailable, setOwnerRecheckAvailable] = useState(false);
  const [ownerRecheckPrepared, setOwnerRecheckPrepared] = useState(false);
  const [readiness, setReadiness] = useState({ transfersEnabled: false, blocker: RECEIVER_BLOCKER as string | null });
  const [now, setNow] = useState(0);
  const lock = useRef(false);
  const requestKey = useRef<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () => Array.from(panel?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []).filter(element => element.getClientRects().length > 0);
    const focusFirst = () => (controls()[0] ?? panel)?.focus();
    focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!lock.current) close.current();
      } else if (event.key === "Tab") {
        const items = controls();
        const first = items[0], last = items.at(-1);
        if (!first) { event.preventDefault(); panel?.focus(); }
        else if (!panel?.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    const focusin = (event: FocusEvent) => { if (panel && event.target instanceof Node && !panel.contains(event.target)) focusFirst(); };
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusin);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const expired = !!order && now >= Date.parse(order.expiresAt);
  const uploadExpired = !!order && now >= Date.parse(order.uploadDeadline);
  const transfersEnabled = (order?.readiness ?? readiness).transfersEnabled;

  useEffect(() => {
    let active = true;
    void fetch("/api/member/payment-account", { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw Error(body.error ?? "กรุณาเข้าสู่ระบบ");
      if (active && body.readiness) setReadiness(body.readiness);
      if (active && body.pendingOrder) {
        setOrder(body.pendingOrder);
        setNotice("พบคำสั่งซื้อเดิม จึงแสดงรายการเดิมเพื่อป้องกันโอนซ้ำ กรุณาตรวจชื่อแพ็กเกจและยอดก่อนโอน");
      }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "โหลดรายการค้างไม่ได้"); })
      .finally(() => { if (active) setLoaded(true); });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "ระบบยังไม่ยืนยัน กรุณาโหลดสถานะ อย่าโอนซ้ำ"); }
    finally { lock.current = false; setBusy(false); }
  }
  function acceptOrder(next: Order) {
    setOrder(next);
    if (next.status === "PAID") {
      window.dispatchEvent(new Event("blu-real-payment-updated"));
      router.refresh();
    }
  }
  async function create() {
    requestKey.current ??= crypto.randomUUID();
    const response = await fetch("/api/payments/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId: pkg.id, promoCode, requestKey: requestKey.current }) });
    const body = await response.json();
    if (body.readiness) setReadiness(body.readiness);
    if (!response.ok) throw Error(body.error ?? "สร้างคำสั่งซื้อไม่ได้");
    acceptOrder(body.order);
  }
  async function refresh() {
    const response = await fetch(order ? `/api/payments/orders/${order.id}` : "/api/member/payment-account", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw Error(body.error ?? "อ่านสถานะไม่ได้");
    const next = body.order ?? body.pendingOrder;
    setOwnerRecheckAvailable(body.ownerRecheckAvailable === true);
    setOwnerRecheckPrepared(body.ownerRecheckPrepared === true);
    if (next) acceptOrder(next);
    else setNotice("ไม่มีคำสั่งซื้อค้าง สามารถสร้างรายการใหม่ได้");
    if (body.verification?.state === "VERIFIED" && next?.status !== "PAID") setNotice("ตรวจสลิปแล้วแต่ยังบันทึกไม่สำเร็จ ส่งรูปเดิมอีกครั้งเพื่อบันทึก โดยไม่เรียก EasySlip ซ้ำ");
    if (["PROCESSING", "UNKNOWN"].includes(body.verification?.state)) setNotice("กำลังตรวจหรือยังไม่ทราบผล ห้ามโอนซ้ำ ตรวจซ้ำได้ด้วยรูปเดิมหลัง 2 นาที สูงสุด 1 ครั้งเพิ่มเติม");
  }
  async function prepareRecheck() {
    if (!order || !window.confirm("เปิดตรวจภาพเดิมหนึ่งครั้งเพื่อแก้บั๊ก PromptPay อาจใช้โควตาเพิ่ม ห้ามโอนซ้ำ ยืนยันหรือไม่?")) return;
    const response = await fetch(`/api/admin/payments/${order.id}/recheck`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true, reason: "PROMPTPAY_REGISTRATION_FIX" }) });
    const body = await response.json();
    if (!response.ok) throw Error(body.error);
    await refresh();
    setNotice(body.message);
  }
  async function verify(reconcile = false) {
    if (!order || !file) throw Error("กรุณาเลือกรูปสลิป");
    if (reconcile && !window.confirm("ตรวจซ้ำหลัง 2 นาทีด้วยรูปเดิม อาจใช้โควตา EasySlip เพิ่มอีก 1 ครั้ง ยืนยันหรือไม่? ห้ามโอนเงินซ้ำ")) return;
    const form = new FormData(); form.append("file", file); form.append("reconcile", String(reconcile));
    const response = await fetch(`/api/payments/orders/${order.id}/verify`, { method: "POST", body: form });
    const body = await response.json();
    if (body.order) acceptOrder(body.order);
    if (body.order?.status === "PAID") return;
    else if (body.pending) setNotice(body.error ?? "ยังรอการยืนยัน ห้ามโอนซ้ำ");
    else if (!response.ok) throw Error(body.error ?? "สลิปไม่ผ่าน");
    else throw Error("ระบบยังไม่ยืนยันการชำระ");
  }
  const button = "rounded-xl bg-blu-dark px-4 py-3 font-bold text-white disabled:opacity-40";
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-blu-dark/80 p-4" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="payment-title">
    <div className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl bg-white p-6 text-blu-dark">
      <header className="flex items-center justify-between"><h2 id="payment-title" className="text-lg font-black">ชำระแพ็กเกจ</h2><button aria-label="ปิด" onClick={onClose} disabled={busy}><X /></button></header>
      <p className="text-sm">{order?.package.name ?? pkg.name}</p>
      <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">บัญชีผู้รับทดสอบชั่วคราวที่ได้รับอนุญาต กรุณาตรวจชื่อผู้รับก่อนโอน • รูปสลิปจะส่งให้ EasySlip และอาจใช้โควตาบริการ • ตรวจผู้รับด้วย EasySlip v2 และบัญชีที่ลงทะเบียน เลขปิดบังหรือชื่ออย่างเดียวไม่ใช้อนุมัติ</p>
      {!transfersEnabled && <p role="alert" className="rounded-xl bg-rose-100 p-3 text-sm font-bold">{(order?.readiness ?? readiness).blocker ?? RECEIVER_BLOCKER} ห้ามโอนเงินจริง หากเคยโอนแล้วให้ติดต่อเจ้าของ</p>}
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{notice}</p>}
      {!loaded && <p>กำลังโหลดรายการค้าง...</p>}
      {order?.status === "PAID" ? <section className="space-y-3 text-center"><CheckCircle2 className="mx-auto text-emerald-600" size={48} /><h3 className="font-bold">ชำระสำเร็จและบันทึกสมาชิกจริงแล้ว</h3><p>หมดอายุ {order.membershipExpiresAt ? date(order.membershipExpiresAt) : "—"}</p><p>ได้รับ {order.pointsEarned} แต้ม</p><Link href="/member" className={button} onClick={onClose}>ดูบัญชีสมาชิก</Link></section> : order?.status === "REJECTED" ? <section role="alert" className="rounded-xl bg-rose-50 p-3 text-sm">รายการถูกปิดโดยไม่เพิ่มสิทธิ์ ({order.rejectionReason}) หากโอนแล้วติดต่อเจ้าของเรื่องยอดโอน ห้ามโอนซ้ำ</section> : <>
        {!order && <><label className="block text-sm">โค้ดส่วนลด (ถ้ามี)<input value={promoCode} maxLength={40} disabled={busy} onChange={e => { setPromoCode(e.target.value); requestKey.current = null; }} className="mt-1 w-full rounded-xl border p-3" /></label><p className="text-xs">ราคาและโควตาส่วนลดตรวจโดยเซิร์ฟเวอร์ สิทธิ์ทดลองในเบราว์เซอร์ใช้ลดเงินจริงไม่ได้</p><button className={`${button} w-full`} disabled={busy || !loaded || !transfersEnabled} onClick={() => void run(create)}>สร้างคำสั่งซื้อ / แสดงยอดจริง</button></>}
        {order && <>
          <p className="text-sm">ราคา ฿{money(order.subtotalSatang)} • ลด ฿{money(order.discountSatang)}</p><p className="text-2xl font-black">ยอดโอน ฿{money(order.amountSatang)}</p>
          {transfersEnabled && <p className="text-sm">{order.receiver.name}<br />PromptPay {order.receiver.promptpay}<br />บัญชี {order.receiver.bankAccount} • ธนาคาร {order.receiver.bankCode === "004" ? "กสิกรไทย" : order.receiver.bankCode}</p>}
          <p className="text-xs">คำสั่งซื้อ {order.id}<br />โอนภายใน {date(order.expiresAt)} (15 นาที)<br />อัปโหลดสลิปได้ถึง {date(order.uploadDeadline)} (เพิ่ม 30 นาที เฉพาะโอนทันเวลา)</p>
          {transfersEnabled && !expired && order.qrPayload ? <div className="flex justify-center rounded-xl border bg-white p-4"><QRCodeSVG value={order.qrPayload} size={200} /></div> : <p className="font-bold text-rose-700">ห้ามโอนเพิ่ม {uploadExpired ? "พ้นเวลาอัปโหลดใหม่แล้ว กู้ได้เฉพาะผลตรวจที่บันทึกไว้ หรือติดต่อเจ้าของ" : "หากโอนทันกำหนด ส่งรูปสลิปได้ภายใน upload deadline"}</p>}
          <label className="block text-sm">รูปสลิป (ไม่เกิน 4 MB)<input className="mt-2 block w-full" type="file" accept="image/jpeg,image/png,image/gif,image/webp" disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
          <button className={`${button} w-full`} disabled={busy || !file} onClick={() => void run(() => verify())}>{transfersEnabled ? "ตรวจสลิปจริง / บันทึกผลเดิม" : "กู้ผลตรวจที่บันทึกไว้เท่านั้น"}</button>
          {ownerRecheckAvailable && <button className="block text-xs underline" disabled={busy} onClick={() => void run(prepareRecheck)}>OWNER: ขอแก้บั๊ก PromptPay และตรวจภาพเดิมอีกหนึ่งครั้ง</button>}
          <button className="text-xs underline disabled:opacity-40" disabled={busy || !file || (uploadExpired && !ownerRecheckPrepared) || !transfersEnabled} onClick={() => void run(() => verify(true))}>ยังไม่ทราบผล: ยืนยันตรวจรูปเดิมซ้ำ (อาจใช้โควตาเพิ่ม)</button>
          {uploadExpired && <button className="block text-xs underline" disabled={busy} onClick={() => { setOrder(null); setFile(null); requestKey.current = null; setNotice("รายการเดิมยังเก็บใน DB หากมีผลตรวจค้าง เซิร์ฟเวอร์จะไม่อนุญาตสร้างใหม่"); }}>เลือกสร้างรายการใหม่ (เฉพาะยังไม่ได้โอน)</button>}
        </>}
        <button className="block text-sm underline disabled:opacity-40" disabled={busy} onClick={() => void run(refresh)}>โหลดคำสั่งซื้อ / สถานะล่าสุด</button>
        <Link className="block text-sm underline" href="/member/login">เข้าสู่ระบบสมาชิก</Link>
      </>}
      {busy && <p role="status" className="flex gap-2 text-sm"><Loader2 className="animate-spin" />กำลังดำเนินการ กรุณารอ อย่ากดซ้ำ</p>}
    </div>
  </div>;
}
