"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { StaffFreeCancellationCandidate } from "@/lib/staff-free-cancellation-server";

const format = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

export default function StaffFreeCancellationSection({ memberCode, candidates }: {
  memberCode: string;
  candidates: StaffFreeCancellationCandidate[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<StaffFreeCancellationCandidate | null>(null);
  const [hiddenSale, setHiddenSale] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(false);
  const pending = useRef<string | null>(null);

  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || !selected) return;
    if (!pending.current) {
      const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
      if (!reason || reason.length > 240) { setMessage("กรุณาระบุเหตุผล 1–240 ตัวอักษร"); return; }
      pending.current = JSON.stringify({ saleId: selected.saleId, requestKey: crypto.randomUUID(), reason });
    }
    active.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/members/${encodeURIComponent(memberCode)}/staff-free/cancellation`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: pending.current, redirect: "error",
      });
      if (response.ok) {
        const { receipt } = await response.json();
        if (receipt?.saleId !== selected.saleId || receipt.source !== "STAFF_FREE_CANCELLATION"
          || receipt.status !== "CANCELLED" || receipt.amountSatang !== 0) throw Error("Unconfirmed cancellation");
        setMessage("ยกเลิกเทอมฟรีแล้ว ไม่มีการคืนเงิน");
      } else if ([400, 409].includes(response.status)) {
        setMessage("ยกเลิกเทอมนี้ไม่ได้ กรุณาตรวจข้อมูลล่าสุด");
      } else {
        throw Error("Unconfirmed cancellation");
      }
      pending.current = null;
      setRetry(false);
      setHiddenSale(selected.saleId);
      setSelected(null);
      router.refresh();
    } catch {
      setRetry(true);
      setMessage("ยังยืนยันผลไม่ได้ กรุณาส่งคำขอเดิมซ้ำ");
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return <section className="rounded-xl border bg-white p-4">
    <h2 className="font-bold">ยกเลิกเทอมต่ออายุ 0 บาท</h2>
    <p className="text-sm">เฉพาะเทอมฟรีที่ยังไม่เริ่ม ไม่ยกเลิกแพ็กเกจออนไลน์และไม่มีการคืนเงิน</p>
    {!selected && candidates.filter(term => term.saleId !== hiddenSale).map(term => <div key={term.saleId} className="mt-3 space-y-1">
      <p>{term.packageName} — {format.format(new Date(term.startsAt))} ถึง {format.format(new Date(term.endsAt))} (เวลาไทย)</p>
      <button type="button" className="rounded border px-3 py-2" onClick={() => { setSelected(term); setMessage(""); }}>เลือกยกเลิกเทอมนี้</button>
    </div>)}
    {selected && <form className="mt-3 space-y-2" onSubmit={cancel}>
      <p>ยืนยันสำหรับ {memberCode}: {selected.packageName} เริ่ม {format.format(new Date(selected.startsAt))} (เวลาไทย)</p>
      <label className="block">เหตุผล <input className="rounded border p-2" name="reason" required maxLength={240} readOnly={busy || retry} /></label>
      <button type="submit" disabled={busy} className="rounded border px-3 py-2">{retry ? "ส่งคำขอเดิมซ้ำ" : "ยืนยันยกเลิกเทอมฟรี"}</button>
      <button type="button" disabled={busy || retry} className="ml-2 rounded border px-3 py-2" onClick={() => { setSelected(null); setMessage(""); }}>กลับ</button>
    </form>}
    <p className="mt-2 text-sm" role="status">{message}</p>
  </section>;
}
