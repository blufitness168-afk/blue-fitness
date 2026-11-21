"use client";

import { useRef, useState, type FormEvent } from "react";

const rejection: Record<string, string> = {
  NOT_FOUND: "ไม่พบสมาชิก",
  OVERLAP: "ช่วงเวลาชนกับรายการเข้าใช้บริการที่มีอยู่",
  PACKAGE_UNVERIFIED: "ยืนยันแหล่งแพ็กเกจกับสมาชิกและเวลาเข้าไม่ได้ ตรวจหลักฐานหรือระบุว่าไม่ทราบแพ็กเกจ",
};

export default function ManualVisitForm({ staffSupported, onSaved }: { staffSupported: boolean; onSaved: () => Promise<void> }) {
  const [source, setSource] = useState("UNKNOWN");
  const request = useRef<string | null>(null);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (writing.current) return;
    const form = event.currentTarget;
    if (!request.current) {
      const fields = new FormData(form);
      const read = (key: string) => String(fields.get(key) ?? "").trim();
      request.current = JSON.stringify({
        requestKey: crypto.randomUUID(), code: read("code").toUpperCase(),
        inAt: `${read("inAt")}+07:00`, outAt: `${read("outAt")}+07:00`,
        orderId: read("orderId").toLowerCase() || null,
        ...(staffSupported && source === "STAFF" ? { staffSaleId: read("staffSaleId").toLowerCase() } : {}),
        usedTimeSlot: read("usedTimeSlot") || null,
        serviceType: read("serviceType"), reason: read("reason"), note: read("note") || null,
      });
    }
    const retrying = retry;
    writing.current = true; setBusy(true); setRetry(true); setResult(null);
    try {
      const response = await fetch("/api/admin/checkin/manual", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: request.current, cache: "no-store",
      });
      const data = await response.json();
      if (response.status === 400 || (response.status === 403 && !retrying) ||
          (response.status === 422 && data.reason === "MANUAL_STAFF_UNSUPPORTED" && !retrying)) {
        request.current = null; setRetry(false);
        setResult({ text: data.error || "บันทึกไม่ได้", ok: false });
      } else if (response.ok && typeof data.ok === "boolean") {
        request.current = null; setRetry(false);
        if (data.ok) {
          form.reset();
          setSource("UNKNOWN");
          setResult({ text: `บันทึกคู่ IN/OUT แล้ว (#${data.visitId})`, ok: true });
          await onSaved();
        } else setResult({ text: rejection[data.reason] || "บันทึกไม่ได้", ok: false });
      } else throw new Error("Unknown write outcome");
    } catch {
      setResult({ text: "ยังยืนยันผลไม่ได้ กรุณาลองคำขอเดิม", ok: false });
    } finally { writing.current = false; setBusy(false); }
  }

  const inputClass = "block w-full rounded border p-2";
  return <details className="rounded border p-4">
    <summary className="cursor-pointer font-semibold">OWNER: บันทึกคู่ IN/OUT ย้อนหลัง</summary>
    <p className="my-2 text-sm">ใช้เฉพาะเมื่อทราบเวลาเข้าและออกจริง (เวลาไทย) ไม่เติม OUT ให้รายการเก่า และไม่ให้สิทธิ์เข้าหรือเพิ่มคะแนน แม้สมาชิกหมดอายุหรือนอกช่วงเวลา</p>
    <form onSubmit={event => void submit(event)} className="space-y-3">
      <fieldset disabled={busy || retry} className="grid gap-3 sm:grid-cols-2">
        <label>รหัสสมาชิก<input className={inputClass} name="code" placeholder="BLU-..." pattern="[Bb][Ll][Uu]-[0-9]{1,12}" maxLength={16} required /></label>
        <label>ประเภทบริการ<input className={inputClass} name="serviceType" maxLength={80} required /></label>
        <label>IN — วันและเวลาเข้า<input className={inputClass} name="inAt" type="datetime-local" step={60} required /></label>
        <label>OUT — วันและเวลาออก<input className={inputClass} name="outAt" type="datetime-local" step={60} required /></label>
        {staffSupported && <label>แหล่งแพ็กเกจที่ใช้จริง<select className={inputClass} value={source} onChange={event => setSource(event.target.value)}>
          <option value="UNKNOWN">ไม่ทราบแพ็กเกจ</option><option value="ONLINE">ออเดอร์ออนไลน์</option><option value="STAFF">รายการขายโดยพนักงาน (ฟรี / โอน)</option>
        </select></label>}
        {(!staffSupported || source === "ONLINE") && <label>ออเดอร์แพ็กเกจที่ใช้จริง (UUID)<input className={inputClass} name="orderId" maxLength={36} required={staffSupported} placeholder={staffSupported ? "UUID ของออเดอร์ออนไลน์" : "เว้นว่าง = ไม่ทราบแพ็กเกจ"} /></label>}
        {staffSupported && source === "STAFF" && <label>รหัสรายการขายโดยพนักงาน (UUID)<input className={inputClass} name="staffSaleId" maxLength={36} required placeholder="UUID จากรายการขายจริงในประวัติการเงิน" /></label>}
        <label>ช่วงเวลาบริการที่ใช้จริง<input className={inputClass} name="usedTimeSlot" maxLength={11} placeholder="HH:mm-HH:mm หรือเว้นว่าง" /></label>
        <label>เหตุผลที่บันทึกย้อนหลัง<input className={inputClass} name="reason" maxLength={300} required /></label>
        <label>หมายเหตุ<input className={inputClass} name="note" maxLength={300} /></label>
      </fieldset>
      <button className="rounded bg-blue-700 px-4 py-2 text-white" disabled={busy}>{busy ? "กำลังบันทึก…" : retry ? "ลองคำขอเดิม" : "บันทึกคู่ IN/OUT"}</button>
    </form>
    {result && <p className="mt-2" role={result.ok ? "status" : "alert"}>{result.text}</p>}
  </details>;
}
