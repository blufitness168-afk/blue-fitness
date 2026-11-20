"use client";

import { useRef, useState } from "react";
import type { StaffFreeOffer } from "@/lib/staff-free-server";

const format = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

export default function StaffFreeSection({ memberCode }: { memberCode: string }) {
  const url = `/api/admin/members/${encodeURIComponent(memberCode)}/staff-free`;
  const [offer, setOffer] = useState<StaffFreeOffer | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const pending = useRef<string | null>(null);
  const active = useRef(false);

  async function preview() {
    if (active.current || pending.current) return;
    active.current = true;
    setBusy(true);
    setOffer(null);
    setMessage("");
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) { setMessage("ยังไม่พร้อมตรวจสิทธิ์ กรุณาลองใหม่"); return; }
      const data = await response.json();
      setOffer(data.offer);
      if (!data.offer) setMessage("ไม่พบแพ็กเกจที่เข้าเงื่อนไขต่ออายุ 0 บาท");
    } catch { setMessage("ตรวจสิทธิ์ไม่สำเร็จ กรุณาลองใหม่"); }
    finally { active.current = false; setBusy(false); }
  }

  async function record(reason: string) {
    if (active.current || !offer) return;
    if (!pending.current) pending.current = JSON.stringify({ requestKey: crypto.randomUUID(), offer, reason });
    active.current = true;
    setFrozen(true);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: pending.current, redirect: "error" });
      if (response.ok) {
        const { receipt } = await response.json();
        if (receipt?.source !== "STAFF_FREE" || receipt.amountSatang !== 0 || typeof receipt.saleId !== "string") throw Error("Unconfirmed receipt");
        setMessage(`บันทึกต่ออายุ 0 บาทแล้ว — เลขรายการ ${receipt.saleId}`);
      } else if ([400, 409].includes(response.status)) {
        setMessage("ข้อมูลเปลี่ยนหรือคำขอขัดแย้ง กรุณาตรวจสิทธิ์ใหม่");
      } else {
        setMessage("ยังยืนยันผลไม่ได้ ตรวจเซสชันแล้วส่งคำขอเดิมซ้ำ");
        return;
      }
      pending.current = null;
      setFrozen(false);
      setOffer(null);
    } catch { setMessage("ยังยืนยันผลไม่ได้ กรุณาส่งคำขอเดิมซ้ำ"); }
    finally { active.current = false; setBusy(false); }
  }

  return <section className="rounded-xl border bg-white p-4">
    <h2 className="font-bold">ต่ออายุผ่านเจ้าหน้าที่ 0 บาท</h2>
    <p className="mb-3 text-sm">รองรับเฉพาะแพ็กเกจเดิมที่ยังมีผลและไม่มีสิทธิ์แถม ไม่ใช่รายการโอนเงิน และไม่ลงย้อนหลัง</p>
    <button type="button" disabled={busy || frozen} onClick={preview} className="rounded border px-3 py-2">ตรวจสิทธิ์</button>
    {offer && <form className="mt-3 space-y-2" onSubmit={e => { e.preventDefault(); void record(String(new FormData(e.currentTarget).get("reason") ?? "").trim()); }}>
      <p>{offer.packageName} — {offer.dailySlot} (เวลาไทย)</p>
      <p>{format.format(new Date(offer.startsAt))} ถึง {format.format(new Date(offer.endsAt))}</p>
      <label className="block">เหตุผล <input className="rounded border p-2" name="reason" required maxLength={240} disabled={frozen || busy} /></label>
      <button type="submit" disabled={busy} className="rounded border px-3 py-2">{frozen ? "ส่งคำขอเดิมซ้ำ" : "ยืนยันต่ออายุ 0 บาท"}</button>
    </form>}
    <p className="mt-2 text-sm" role="status">{message}</p>
  </section>;
}
