"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WelcomeCoupon } from "@/lib/benefits-server";

export default function WelcomeCoupons({ coupons, lang = "th" }: { coupons: WelcomeCoupon[]; lang?: "th" | "en" }) {
  const isEn = lang === "en";
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [consumed, setConsumed] = useState<number[]>([]);
  async function redeem(id: number) {
    const confirmText = isEn
      ? "Confirm using your 1 free entry now? This action cannot be undone."
      : "ยืนยันใช้สิทธิ์เข้าฟรี 1 ครั้งตอนนี้? สิทธิ์จะถูกใช้ทันทีและเรียกคืนไม่ได้";
    if (pending.current || !window.confirm(confirmText)) return;
    pending.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/member/coupons/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ couponId: id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? (isEn ? "Failed to redeem coupon" : "ใช้สิทธิ์ไม่สำเร็จ"));
      setConsumed(previous => [...previous, id]); setMessage(result.message);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : isEn ? "Could not confirm result. Please reload the page." : "ยังยืนยันผลไม่ได้ กรุณาโหลดหน้าใหม่"); }
    finally { router.refresh(); pending.current = false; setBusy(false); }
  }
  return <section className="space-y-3 rounded-2xl border border-blu-sky bg-white p-5">
    <h2 className="text-lg font-black">{isEn ? "Welcome Coupon" : "คูปองต้อนรับจากฐานข้อมูลจริง"}</h2>
    <p className="text-sm">{isEn ? "1 free entry within 30 days of registration. No package required • Account owner only." : "เข้าฟรี 1 ครั้ง ภายใน 30 วันหลังสมัคร ไม่ต้องมีแพ็กเกจ • ใช้ได้เฉพาะเจ้าของบัญชี"}</p>
    <p className="text-xs text-amber-700">{isEn ? "Confirming will immediately redeem this coupon and record your free entry in the database." : "การกดยืนยันจะใช้คูปองและบันทึกสิทธิ์เข้าใช้บริการในฐานข้อมูลทันที เป็นการยืนยันด้วยตนเอง"}</p>
    {message && <p role="status" className="text-sm">{message}</p>}
    {!coupons.length && <p className="text-sm">{isEn ? "No welcome coupon found for this account." : "ไม่พบคูปองต้อนรับของบัญชีนี้"}</p>}
    {coupons.map(c => {
      const used = consumed.includes(c.id) || c.status === "USED" || c.usedCount >= c.totalQuota;
      const expired = c.expired;
      return <article key={c.id} className="space-y-2 rounded-xl bg-blu-ice p-4">
        <h3 className="font-bold">{c.title}</h3>
        <p className="text-xs">{isEn ? "Expires" : "หมดอายุ"} {new Date(c.expiresAt).toLocaleString(isEn ? "en-GB" : "th-TH", { timeZone: "Asia/Bangkok" })}</p>
        <p>{used ? (isEn ? "Used" : "ใช้แล้ว") : expired ? (isEn ? "Expired" : "หมดอายุ") : (isEn ? "Available • 1 use" : "ยังไม่ใช้ • 1 ครั้ง")}</p>
        {!used && !expired && <button disabled={busy} onClick={() => void redeem(c.id)} className="btn-blue rounded-xl px-4 py-2 text-sm disabled:opacity-50">{busy ? (isEn ? "Confirming..." : "กำลังยืนยัน…") : (isEn ? "Use 1 Free Entry" : "ยืนยันใช้สิทธิ์เข้าฟรี 1 ครั้ง")}</button>}
      </article>;
    })}
  </section>;
}
