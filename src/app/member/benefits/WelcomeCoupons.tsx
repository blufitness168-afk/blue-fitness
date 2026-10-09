"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WelcomeCoupon } from "@/lib/benefits-server";

export default function WelcomeCoupons({ coupons }: { coupons: WelcomeCoupon[] }) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [consumed, setConsumed] = useState<number[]>([]);
  async function redeem(id: number) {
    if (pending.current || !window.confirm("ยืนยันใช้สิทธิ์เข้าฟรี 1 ครั้งตอนนี้? สิทธิ์จะถูกใช้ทันทีและเรียกคืนไม่ได้ ยังไม่เชื่อมเครื่องสแกนหรือประตูหน้าร้าน")) return;
    pending.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/member/coupons/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ couponId: id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "ใช้สิทธิ์ไม่สำเร็จ");
      setConsumed(previous => [...previous, id]); setMessage(result.message);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "ยังยืนยันผลไม่ได้ กรุณาโหลดหน้าใหม่"); }
    finally { router.refresh(); pending.current = false; setBusy(false); }
  }
  return <section className="space-y-3 rounded-2xl border border-blu-sky bg-white p-5">
    <h2 className="text-lg font-black">คูปองต้อนรับจากฐานข้อมูลจริง</h2>
    <p className="text-sm">เข้าฟรี 1 ครั้ง ภายใน 30 วันหลังสมัคร ไม่ต้องมีแพ็กเกจ • ใช้ได้เฉพาะเจ้าของบัญชี</p>
    <p className="text-xs text-amber-700">การกดยืนยันจะใช้คูปองและบันทึกสิทธิ์เข้าในฐานข้อมูลทันที เป็นการยืนยันเอง ยังไม่เชื่อมเครื่องสแกน ประตู หรือประวัติเช็กอิน mock ของแอดมิน</p>
    {message && <p role="status" className="text-sm">{message}</p>}
    {!coupons.length && <p className="text-sm">ไม่พบคูปองต้อนรับของบัญชีนี้ ระบบจะไม่สร้างสิทธิ์จากข้อมูล mock</p>}
    {coupons.map(c => {
      const used = consumed.includes(c.id) || c.status === "USED" || c.usedCount >= c.totalQuota;
      const expired = c.expired;
      return <article key={c.id} className="space-y-2 rounded-xl bg-blu-ice p-4">
        <h3 className="font-bold">{c.title}</h3>
        <p className="text-xs">หมดอายุ {new Date(c.expiresAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p>
        <p>{used ? "ใช้แล้ว" : expired ? "หมดอายุ" : "ยังไม่ใช้ • 1 ครั้ง"}</p>
        {!used && !expired && <button disabled={busy} onClick={() => void redeem(c.id)} className="btn-blue rounded-xl px-4 py-2 text-sm disabled:opacity-50">{busy ? "กำลังยืนยัน…" : "ยืนยันใช้สิทธิ์เข้าฟรี 1 ครั้ง"}</button>}
      </article>;
    })}
  </section>;
}
