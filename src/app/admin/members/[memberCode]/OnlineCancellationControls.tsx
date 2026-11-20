"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { onlineCancellationInput, onlineCancellationPreview, onlineCancellationReceipt } from "@/lib/online-cancellation-contract";

type Preview = z.infer<typeof onlineCancellationPreview>;
type Receipt = z.infer<typeof onlineCancellationReceipt>;
type Submission = z.infer<typeof onlineCancellationInput>;
const blockers = {
  ALREADY_CANCELLED: "ยกเลิกแล้ว ห้ามคืนเงินซ้ำ",
  READERS_NOT_ENABLED: "ระบบยังไม่เปิดให้บันทึกการยกเลิก",
  REVIEW_REQUIRED: "ไม่ผ่านเงื่อนไขยกเลิกอัตโนมัติ ต้องตรวจสอบด้วยตนเอง",
};
const money = (satang: number) => (satang / 100).toFixed(2);

export default function OnlineCancellationControls({ orderId, memberCode }: { orderId: string; memberCode: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, setPending] = useState<Submission | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const endpoint = `/api/owner/online-cancellations/${encodeURIComponent(orderId)}`;

  async function run(submission?: Submission) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    if (submission) setPending(submission);
    else { setPreview(null); setReason(""); setConfirmed(false); }
    try {
      const response = await fetch(endpoint, submission ? {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission), cache: "no-store",
      } : { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        if (submission && [400, 409].includes(response.status)) {
          setPending(null); setPreview(null); setConfirmed(false);
        }
        setError(typeof body?.error === "string" ? body.error : "ระบบไม่พร้อมใช้งาน");
        return;
      }
      if (submission) {
        const recorded = onlineCancellationReceipt.parse(body?.receipt);
        if (recorded.orderId !== orderId || recorded.refundSatang !== submission.refundSatang) throw Error("Receipt mismatch");
        setReceipt(recorded); setPending(null);
        router.refresh();
      } else {
        const result = onlineCancellationPreview.parse(body?.preview);
        if (result.orderId !== orderId || result.memberCode !== memberCode) throw Error("Order mismatch");
        setPreview(result);
      }
    } catch {
      setError(submission ? "ยังยืนยันผลไม่ได้ กรุณาส่งคำขอเดิมซ้ำ ห้ามคืนเงินซ้ำ" : "ตรวจสอบรายการไม่ได้ กรุณาลองใหม่");
    } finally { inFlight.current = false; setBusy(false); }
  }

  if (receipt) return <p role="status" className="mt-1 whitespace-normal text-xs text-emerald-800">บันทึกยกเลิกและคืนเงินนอกระบบแล้ว ฿{money(receipt.refundSatang)} · ถอน {receipt.pointsReversed} คะแนน</p>;
  return <div className="mt-1 w-72 space-y-2 whitespace-normal text-xs">
    {!pending && <button type="button" disabled={busy} className="underline" onClick={() => void run()}>ตรวจสอบก่อนยกเลิก</button>}
    {preview?.blocker && <p role="status">{blockers[preview.blocker]}</p>}
    {preview?.eligible && !pending && <form className="space-y-2" onSubmit={event => {
      event.preventDefault();
      if (!confirmed || !reason.trim() || inFlight.current) return;
      const input = onlineCancellationInput.safeParse({ requestKey: crypto.randomUUID(), refundSatang: preview.amountSatang,
        reason, confirmedFullExternalRefund: confirmed });
      if (input.success) void run(input.data);
      else setError("เหตุผลไม่ถูกต้อง");
    }}>
      <p>{preview.packageName ?? "แพ็กเกจออนไลน์"} · คืนเต็ม ฿{money(preview.amountSatang)} · ถอน {preview.pointsToReverse} คะแนน</p>
      <p>ผลตรวจไม่รับประกันว่าจะบันทึกได้ ระบบไม่โอนเงินคืน หากบันทึกไม่ได้ให้ตรวจสอบ ห้ามคืนเงินซ้ำ</p>
      <label className="block">เหตุผล / อ้างอิงการคืนเงิน<textarea className="block w-full rounded border p-1" required maxLength={240} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <label className="block"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> ยืนยันว่าคืนเงินเต็ม ฿{money(preview.amountSatang)} นอกระบบแล้ว</label>
      <button type="submit" className="btn-blue rounded px-2 py-1 disabled:opacity-50" disabled={busy || !confirmed || !reason.trim()}>บันทึกการยกเลิก</button>
    </form>}
    {pending && <button type="button" disabled={busy} className="underline" onClick={() => void run(pending)}>ส่งคำขอเดิมซ้ำ (ไม่คืนเงินซ้ำ)</button>}
    {busy && <p role="status">กำลังดำเนินการ…</p>}
    {error && <p role="alert" className="text-rose-800">{error}</p>}
  </div>;
}
