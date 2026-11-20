"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import WelcomeCoupons from "./WelcomeCoupons";
import type { WelcomeCoupon } from "@/lib/benefits-server";
import type { MemberWallet } from "@/lib/real-member-wallet-server";

const date = (value: string) => new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });

export default function BenefitsWallet({ identity, welcomeCoupons }: { identity: { memberCode: string; fullName: string }; welcomeCoupons: WelcomeCoupon[] }) {
  const [wallet, setWallet] = useState<MemberWallet | null>(null);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [activating, setActivating] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  function reload() {
    setWallet(null); setError(""); setRefresh(value => value + 1);
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/member/wallet", { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "โหลดสิทธิ์ไม่สำเร็จ");
      if (!controller.signal.aborted) { setWallet(result.data); setLoadedAt(Date.now()); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "โหลดสิทธิ์ไม่สำเร็จ"); });
    return () => controller.abort();
  }, [refresh]);
  async function activate(id: number) {
    if (activating !== null || !window.confirm("ยืนยันเปิดใช้คูปอง? หลังเปิดใช้แล้วจะเริ่มนับเวลาตามเงื่อนไขและเริ่มใหม่ไม่ได้")) return;
    setActivating(id); setFeedback(null);
    try {
      const response = await fetch("/api/member/coupons/activate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ couponId: id }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) reload();
        throw Error(result.error || "เปิดใช้ไม่สำเร็จ");
      }
      setFeedback({ text: "เปิดใช้คูปองแล้ว กรุณาติดต่อเจ้าหน้าที่เพื่อใช้สิทธิ์", ok: true });
      reload();
    } catch (cause) {
      setFeedback({ text: cause instanceof Error ? cause.message : "ยังยืนยันผลไม่ได้ กรุณาลองอีกครั้ง", ok: false });
    } finally { setActivating(null); }
  }
  return <main className="mx-auto max-w-3xl space-y-5 px-4 py-24 text-blu-dark">
    <h1 className="text-2xl font-black">กระเป๋าสิทธิ์สมาชิก</h1>
    <p>{identity.fullName} · {identity.memberCode}</p>
    <nav className="flex flex-wrap gap-4 underline"><Link href="/member">บัญชีสมาชิก</Link><Link href="/#packages">ซื้อ / ต่ออายุแพ็กเกจ</Link><Link href="/member/rewards">แลกของรางวัล</Link></nav>
    <WelcomeCoupons coupons={welcomeCoupons} />
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    {feedback && <p role={feedback.ok ? "status" : "alert"} className={feedback.ok ? "" : "text-rose-700"}>{feedback.text}</p>}
    <button className="underline" disabled={activating !== null} onClick={() => { setFeedback(null); reload(); }}>โหลดคูปองใหม่</button>
    {!wallet && !error && <p role="status">กำลังโหลดสิทธิ์จากฐานข้อมูล...</p>}
    <p className="text-sm">คูปองพาเพื่อนและเพิ่มวันให้ติดต่อพนักงานยืนยันใช้สิทธิ์ พร้อมแจ้งรหัสสมาชิก ไม่ถือว่าการเปิดหน้านี้เป็นการใช้คูปอง</p>
    {wallet?.coupons.filter(coupon => coupon.source !== "WELCOME_REGISTRATION").map(coupon => <article key={coupon.id} className="space-y-2 rounded-2xl border bg-white p-5">
      <h2 className="font-bold">{coupon.title}</h2>
      <p>คูปอง #{coupon.id} · ใช้แล้ว {coupon.usedCount}/{coupon.totalQuota}</p>
      <p>{coupon.status === "USED" ? "ใช้ครบแล้ว" : coupon.status === "PENDING_ACTIVATION" ? "รอเปิดใช้" : coupon.status !== "AVAILABLE" || (!coupon.campaignExpiresAt && coupon.expiresAt && loadedAt !== null && Date.parse(coupon.expiresAt) <= loadedAt) ? "หมดอายุ / ไม่พร้อมใช้" : "พร้อมใช้"}</p>
      {coupon.campaignExpiresAt && <>
        <p className="text-sm">หมดอายุแคมเปญ {date(coupon.campaignExpiresAt)} (เวลาไทย)</p>
        <p className="text-sm">{coupon.activationDurationMinutes == null ? "ไม่จำกัดเวลาเพิ่มหลังเปิดใช้" : `อายุหลังเปิดใช้ ${coupon.activationDurationMinutes || 10} นาที`} · ไม่เกินวันหมดอายุแคมเปญ</p>
        {coupon.activatedAt && <p className="text-sm">เปิดใช้เมื่อ {date(coupon.activatedAt)}</p>}
      </>}
      {(!coupon.campaignExpiresAt || coupon.activatedAt) && <p className="text-sm">หมดอายุ {coupon.expiresAt ? date(coupon.expiresAt) : "ไม่กำหนด"}</p>}
      {coupon.status === "PENDING_ACTIVATION" && <button className="rounded border px-3 py-2 font-bold disabled:opacity-50" disabled={activating !== null} onClick={() => void activate(coupon.id)}>{activating === coupon.id ? "กำลังเปิดใช้…" : "เปิดใช้คูปอง"}</button>}
    </article>)}
    {wallet && !wallet.coupons.some(coupon => coupon.source !== "WELCOME_REGISTRATION") && <p>ยังไม่มีคูปองเพิ่มเติมในฐานข้อมูล</p>}
  </main>;
}
