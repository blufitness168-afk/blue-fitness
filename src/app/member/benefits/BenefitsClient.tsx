"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import WelcomeCoupons from "./WelcomeCoupons";
import type { WelcomeCoupon } from "@/lib/benefits-server";
import type { MemberWallet } from "@/lib/real-member-wallet-server";

export default function BenefitsWallet({ identity, welcomeCoupons }: { identity: { memberCode: string; fullName: string }; welcomeCoupons: WelcomeCoupon[] }) {
  const [wallet, setWallet] = useState<MemberWallet | null>(null);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/member/wallet", { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "โหลดสิทธิ์ไม่สำเร็จ");
      if (!controller.signal.aborted) { setWallet(result.data); setLoadedAt(Date.now()); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "โหลดสิทธิ์ไม่สำเร็จ"); });
    return () => controller.abort();
  }, []);
  return <main className="mx-auto max-w-3xl space-y-5 px-4 py-24 text-blu-dark">
    <h1 className="text-2xl font-black">กระเป๋าสิทธิ์สมาชิก</h1>
    <p>{identity.fullName} · {identity.memberCode}</p>
    <nav className="flex flex-wrap gap-4 underline"><Link href="/member">บัญชีสมาชิก</Link><Link href="/#packages">ซื้อ / ต่ออายุแพ็กเกจ</Link><Link href="/member/rewards">แลกของรางวัล</Link></nav>
    <WelcomeCoupons coupons={welcomeCoupons} />
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    {!wallet && !error && <p role="status">กำลังโหลดสิทธิ์จากฐานข้อมูล...</p>}
    <p className="text-sm">คูปองพาเพื่อนและเพิ่มวันให้ติดต่อพนักงานยืนยันใช้สิทธิ์ พร้อมแจ้งรหัสสมาชิก ไม่ถือว่าการเปิดหน้านี้เป็นการใช้คูปอง</p>
    {wallet?.coupons.filter(coupon => coupon.source !== "WELCOME_REGISTRATION").map(coupon => <article key={coupon.id} className="space-y-2 rounded-2xl border bg-white p-5">
      <h2 className="font-bold">{coupon.title}</h2>
      <p>คูปอง #{coupon.id} · ใช้แล้ว {coupon.usedCount}/{coupon.totalQuota}</p>
      <p>{coupon.status === "USED" ? "ใช้ครบแล้ว" : coupon.status !== "AVAILABLE" || (coupon.expiresAt && loadedAt !== null && Date.parse(coupon.expiresAt) <= loadedAt) ? "หมดอายุ / ไม่พร้อมใช้" : "พร้อมใช้"}</p>
      <p className="text-sm">หมดอายุ {coupon.expiresAt ? new Date(coupon.expiresAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "ไม่กำหนด"}</p>
    </article>)}
    {wallet && !wallet.coupons.some(coupon => coupon.source !== "WELCOME_REGISTRATION") && <p>ยังไม่มีคูปองเพิ่มเติมในฐานข้อมูล</p>}
  </main>;
}
