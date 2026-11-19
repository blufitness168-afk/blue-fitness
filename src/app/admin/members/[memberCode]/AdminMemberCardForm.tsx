"use client";
import { useRef, useState } from "react";
import type { MemberCardSnapshot } from "@/lib/member-card-server";

export default function AdminMemberCardForm({ memberCode, initial }: { memberCode: string; initial: MemberCardSnapshot }) {
  const [cardCode, setCardCode] = useState(initial.cardCode ?? "");
  const [unbind, setUnbind] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  async function send() {
    if (lock.current || done) return;
    const normalized = cardCode.trim().toUpperCase();
    if (!pending && (!reason.trim() || (!unbind && !/^CARD-[0-9]{1,95}$/.test(normalized)))) {
      setMessage("ระบุ CARD-ตามด้วยตัวเลข และเหตุผลก่อนบันทึก"); return;
    }
    const body = pending ?? JSON.stringify({ requestKey: crypto.randomUUID(), reason: reason.trim(), expectedVersion: initial.version, cardCode: unbind ? null : normalized });
    lock.current = true; setBusy(true); setPending(body);
    try {
      const response = await fetch(`/api/admin/members/${encodeURIComponent(memberCode)}/card`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(12000),
      });
      const data = await response.json();
      if (response.ok && data.ok === true) { setDone(true); setMessage("บันทึกบัตรแล้ว โหลดใหม่เพื่อตรวจสอบข้อมูลล่าสุด"); }
      else setMessage(data.error || "ยังยืนยันผลไม่ได้ ส่งคำขอเดิมซ้ำหรือโหลดใหม่เพื่อตรวจสอบ");
    } catch { setMessage("ยังยืนยันผลไม่ได้ ส่งคำขอเดิมซ้ำหรือโหลดใหม่เพื่อตรวจสอบ ห้ามเริ่มคำขอใหม่ทันที"); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="rounded-2xl border border-blu-sky/30 p-4 space-y-3">
    <h2 className="font-bold">บัตรแข็ง — {memberCode}</h2>
    <p>บัตรปัจจุบัน: <span className="font-mono">{initial.cardCode ?? "ยังไม่ผูกบัตร"}</span></p>
    <p className="text-sm">หนึ่งคนมีบัตรได้หนึ่งใบ ไม่ย้ายบัตรของผู้อื่นอัตโนมัติ และไม่เพิ่มสิทธิ์เข้าใช้บริการ</p>
    <form onSubmit={event => { event.preventDefault(); void send(); }} className="space-y-3">
      <fieldset disabled={busy || !!pending || done} className="space-y-3">
        <label className="block"><input type="checkbox" checked={unbind} onChange={e => setUnbind(e.target.checked)} /> ยกเลิกบัตรของสมาชิกคนนี้</label>
        {!unbind && <label className="block">บัตรใหม่ (USB ส่ง Enter เพื่อบันทึกเมื่อกรอกเหตุผลครบ)
          <input aria-label="รหัสบัตรใหม่" value={cardCode} onChange={e => setCardCode(e.target.value)} maxLength={100} autoComplete="off" required className="block w-full rounded-lg border p-2" />
        </label>}
        <label className="block">เหตุผลเจ้าหน้าที่
          <textarea required maxLength={240} value={reason} onChange={e => setReason(e.target.value)} className="block w-full rounded-lg border p-2" />
        </label>
      </fieldset>
      <button type="submit" disabled={busy || done} className="rounded-lg border px-4 py-2">{busy ? "กำลังบันทึก…" : pending ? "ส่งคำขอเดิมซ้ำ" : unbind ? "ยืนยันยกเลิกบัตรคนนี้" : "ยืนยันผูก / เปลี่ยนบัตรคนนี้"}</button>
      <button type="button" disabled={busy} onClick={() => window.location.reload()} className="ml-3 underline">โหลดใหม่ / ตรวจสอบผล</button>
    </form>
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
