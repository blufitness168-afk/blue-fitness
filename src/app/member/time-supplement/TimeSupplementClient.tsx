"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Coupon = { couponId: number; title: string; timeSlot: string; expiresAt: string;
  usedCount: number; activatedAt: string | null; activeUntil: string | null; active: boolean };
const date = (value: string) => new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
const input = "w-full rounded-lg border p-2";

export default function TimeSupplementClient({ staff, memberId }: { staff: boolean; memberId: number }) {
  const [items, setItems] = useState<Coupon[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function reload(signal?: AbortSignal) {
    const response = await fetch("/api/member/time-supplement", { cache: "no-store", signal });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "โหลดสิทธิ์เสริมไม่สำเร็จ");
    if (!signal?.aborted) setItems(result.data);
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/member/time-supplement", { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "โหลดสิทธิ์เสริมไม่สำเร็จ");
      if (!controller.signal.aborted) setItems(result.data);
    }).catch(error => { if (!controller.signal.aborted) setMessage(String(error)); });
    return () => controller.abort();
  }, []);
  async function send(kind: "grant" | "activate", fields: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    const storageKey = `blu-time-supplement:${memberId}:${kind}`;
    try {
      // Keep unknown-outcome requests across refresh. A retry sends exactly the
      // saved payload, never a new UUID or a different coupon/form accidentally.
      const saved = sessionStorage.getItem(storageKey);
      const body = saved || JSON.stringify({ ...fields, requestKey: crypto.randomUUID() });
      const retry = JSON.parse(body) as Record<string, unknown>;
      if (!window.confirm(saved ? `มีคำขอที่ยังไม่ยืนยันผล จะลองคำขอเดิมซ้ำ: ${JSON.stringify(retry)}` : kind === "grant"
        ? `ยืนยันแจก 1 ใบให้ ${fields.memberCode} ช่วง ${fields.timeSlot}?` : "ยืนยันใช้ 1 สิทธิ์ตอนนี้? ไม่เพิ่มวันและไม่เปลี่ยนแพ็กเกจหลัก")) return;
      sessionStorage.setItem(storageKey, body);
      const response = await fetch(kind === "grant" ? "/api/admin/time-supplement" : "/api/member/time-supplement", {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) sessionStorage.removeItem(storageKey);
        throw Error(result.error || "ใช้สิทธิ์ไม่สำเร็จ");
      }
      sessionStorage.removeItem(storageKey);
      setMessage(kind === "grant" ? `แจกแล้ว คูปอง #${result.data.couponId}` : `เปิดใช้คูปอง #${result.data.couponId} ถึง ${date(result.data.expiresAt)}`);
      await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "ยังยืนยันผลไม่ได้ ลองคำขอเดิมซ้ำ"); }
    finally { lock.current = false; setBusy(false); }
  }
  function grant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void send("grant", Object.fromEntries(data.entries()));
  }
  return <main className="mx-auto max-w-xl space-y-5 px-4 py-10">
    <Link href="/member" className="underline">กลับกระเป๋าสมาชิก</Link>
    <h1 className="text-2xl font-bold">คูปองเสริมช่วงเวลา</h1>
    <p>1 ใบใช้ครั้งเดียวในช่วงเวลาที่ระบุของวันนั้น ตามเวลาไทย สิ้นสุดเมื่อปิดช่วงหรือหลักหมดอายุ ไม่เพิ่มวัน ไม่คิดราคา และไม่เปลี่ยนหลัก</p>
    <p className="text-sm text-amber-800">รุ่นขั้นต่ำ: รองรับเฉพาะหลักออนไลน์เดี่ยวที่พิสูจน์ได้ ไม่รองรับต่ออายุซ้อน วันรวมไม่ตรง หรือการถอนสิทธิ์</p>
    {message && <p role="status">{message}</p>}
    <button disabled={busy} className="btn-blue rounded-lg p-2" onClick={() => void reload().catch(error => setMessage(String(error)))}>โหลดสิทธิ์ใหม่</button>
    {items.map(c => <article key={c.couponId} className="space-y-2 rounded-xl border p-4">
      <h2 className="font-bold">{c.title} #{c.couponId}</h2>
      <p>{c.timeSlot} · หมดอายุ {date(c.expiresAt)}</p>
      <p>{c.active ? `เปิดใช้ถึง ${date(c.activeUntil!)}` : c.usedCount ? "ใช้แล้ว / สิทธิ์ไม่ทำงาน" : "ยังไม่ใช้"}</p>
      {!c.usedCount && <button disabled={busy} className="btn-blue rounded-lg p-2" onClick={() => void send("activate", { couponId: c.couponId })}>เปิดใช้ตอนนี้</button>}
    </article>)}
    {!items.length && <p>ยังไม่มีคูปองเสริมช่วงเวลา</p>}
    {staff && <form onSubmit={grant} className="space-y-3 rounded-xl border p-4">
      <h2 className="font-bold">ADMIN/OWNER แจก 1 ใบ</h2>
      <label className="block">รหัสสมาชิก<input className={input} name="memberCode" required maxLength={80} disabled={busy} /></label>
      <label className="block">ชื่อคูปอง<input className={input} name="title" required maxLength={120} disabled={busy} /></label>
      <label className="block">ช่วงเวลา HH:mm-HH:mm<input className={input} name="timeSlot" placeholder="14:00-22:00" required pattern="[0-9]{2}:[0-9]{2}-[0-9]{2}:[0-9]{2}" disabled={busy} /></label>
      <label className="block">เหตุผล<input className={input} name="reason" required maxLength={240} disabled={busy} /></label>
      <button disabled={busy} className="btn-blue rounded-lg p-2">ตรวจและยืนยันแจก</button>
    </form>}
  </main>;
}
