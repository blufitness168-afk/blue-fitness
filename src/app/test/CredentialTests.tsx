"use client";

import { useRef, useState, type FormEvent } from "react";

export default function CredentialTests() {
  const [phone, setPhone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [slipVersion, setSlipVersion] = useState<"v1" | "v2">("v2");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [result, setResult] = useState<unknown>(null);
  async function run(event: FormEvent, service: "sms" | "slip") {
    event.preventDefault();
    if (lock.current || !confirmed) return;
    if (service === "slip" && (!file || file.size > 4 * 1024 * 1024 || file.size === 0)) {
      setResult({ error: "เลือกไฟล์รูปขนาดไม่เกิน 4 MB" }); return;
    }
    if (!window.confirm(service === "sms" ? `ส่ง SMS จริงไป ${phone}? อาจหักเครดิต` : "ส่งรูปสลิปให้ EasySlip ตรวจจริง? อาจใช้โควตาหรือเครดิต")) return;
    lock.current = true;
    setBusy(true);
    setResult(null);
    try {
      const upload = new FormData();
      if (file) upload.append("file", file);
      upload.append("action", slipVersion === "v2" ? "verify-test-slip-v2" : "verify-test-slip");
      upload.append("confirmed", "true");
      const response = await fetch("/api/test-services", {
        method: "POST",
        ...(service === "sms" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send-test-sms", phone, confirmed: true }) } : { body: upload }),
        signal: AbortSignal.timeout(60000),
      });
      setResult(await response.json());
    } catch {
      setResult({ error: "ไม่ได้รับผลตอบกลับ รายการอาจถูกดำเนินการแล้ว ตรวจยอด/มือถือก่อนกดซ้ำ" });
    } finally { setBusy(false); lock.current = false; }
  }
  async function readReceiverDiagnostics() {
    if (lock.current || !window.confirm("อ่านข้อมูล key/branch และบัญชีที่ผูก EasySlip v2 เท่านั้น ไม่ตรวจสลิป ไม่เปิดรับโอน และไม่เพิ่มสิทธิ์สมาชิก ต้องการดำเนินการหรือไม่?")) return;
    lock.current = true;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/payments/provider-diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedReadOnly: true }),
        signal: AbortSignal.timeout(30000),
      });
      setResult(await response.json());
    } catch {
      setResult({ error: "อ่านข้อมูล EasySlip v2 ไม่สำเร็จ ไม่มีการตรวจสลิปหรือเปิดรับโอน" });
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return <section className="space-y-5 rounded-2xl border border-amber-500/20 bg-slate-900 p-6">
    <h2 className="text-lg font-bold text-amber-300">ทดสอบ credentials ชั่วคราว (OWNER เท่านั้น)</h2>
    <p className="text-sm text-slate-300">ส่ง SMS จริงโดยไม่มีการยืนยัน OTP และตรวจรูปสลิปจริง ไม่สร้าง/แก้ไขสมาชิก การซื้อ หรือการชำระเงิน รูปส่งให้ EasySlip โดยตรงผ่านเซิร์ฟเวอร์ ไม่เก็บใน Cloudinary หรือฐานข้อมูล</p>
    <div className="space-y-2 rounded-xl border border-amber-400/30 p-4">
      <p className="text-sm text-amber-200">ตรวจสลิปสำเร็จในหน้านี้ไม่ใช่การอนุมัติซื้อแพ็กเกจ ระบบรับโอนยังปิดไว้จนกว่ายืนยันข้อมูลผู้รับได้อย่างปลอดภัย</p>
      <button type="button" onClick={readReceiverDiagnostics} disabled={busy} className="rounded bg-slate-700 px-4 py-2 disabled:opacity-40">เช็ค EasySlip v2 / บัญชีที่ผูก (อ่านอย่างเดียว)</button>
    </div>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />ยอมรับว่าอาจเสียเครดิต/โควตา และมีการส่งเบอร์โทรหรือรูปสลิปให้ผู้ให้บริการภายนอก</label>
    <form onSubmit={e => run(e, "sms")} className="flex flex-wrap gap-3">
      <label>เบอร์มือถือไทย<input className="ml-2 rounded bg-slate-800 p-2" type="tel" aria-label="เบอร์มือถือไทย" value={phone} onChange={e => setPhone(e.target.value)} pattern="0[689][0-9]{8}" maxLength={10} placeholder="08xxxxxxxx" required disabled={busy} /></label>
      <button className="rounded bg-emerald-700 px-4 py-2 disabled:opacity-40" disabled={busy || !confirmed}>ส่ง SMS ทดสอบจริง</button>
    </form>
    <form onSubmit={e => run(e, "slip")} className="flex flex-wrap gap-3">
      <label>รูปสลิป (ไม่เกิน 4 MB)<input className="ml-2" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => setFile(e.target.files?.[0] ?? null)} required disabled={busy} /></label>
      <label>API <select value={slipVersion} onChange={e => setSlipVersion(e.target.value as "v1" | "v2")} disabled={busy} className="ml-2 rounded bg-slate-800 p-2"><option value="v2">v2 — ตรวจสลิป + เทียบบัญชีผู้รับ</option><option value="v1">v1 — ตรวจสลิปเดิม</option></select></label>
      <button className="rounded bg-blue-700 px-4 py-2 disabled:opacity-40" disabled={busy || !confirmed}>ตรวจสลิป {slipVersion} จริง (ไม่เพิ่มสิทธิ์)</button>
    </form>
    <p className="text-sm text-slate-300">ทดสอบ v2 ด้วยสลิปเดิมที่รับเงินเข้าบัญชีทดลองได้ ไม่ต้องโอนใหม่; ใช้สลิปที่โอนให้คนอื่นเป็นเคสลบได้ ผลจะไม่อนุมัติการซื้อแม้ matchedAccount ตรง</p>
    <p className="text-xs text-slate-400">แสดงยอดก่อน/หลังและผลต่างตามที่ API รองรับ: SMS standard/corporate; EasySlip currentCredit/usedQuota/remainingQuota ยอด null คือไม่มีค่าตัวเลข ไม่ใช่ศูนย์ ไม่สรุปว่าแพ็กเกจฟรีจากคำขอสำเร็จหรือเครดิตคงเหลือ</p>
    {busy && <p role="status">กำลังเรียกบริการ กรุณารอและอย่ากดซ้ำ...</p>}
    {result !== null && <pre aria-live="polite" className="overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-4 text-xs">{JSON.stringify(result, null, 2)}</pre>}
  </section>;
}
