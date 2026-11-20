"use client";
import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";

type Account = {
  memberCode: string; status: string; expiresAt: string | null; points: number;
  package: { name: string; timeSlot: string } | null;
  purchases: { id: string; package: { name: string }; amountSatang: number; paidAt: string; pointsEarned: number; cancelledAt?: string; refundSatang?: number }[];
};
const date = (value: string | null, isEn = false) => value ? new Date(value).toLocaleString(isEn ? "en-US" : "th-TH", { timeZone: "Asia/Bangkok" }) : "—";

export default function RealPaymentAccount() {
  const { lang } = useLanguage();
  const isEn = lang === "en";
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/member/payment-account", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw Error(body.error ?? "อ่านบัญชีจริงไม่ได้");
      setAccount(body); setError("");
    } catch (cause) { setAccount(null); setError(cause instanceof Error ? cause.message : "อ่านบัญชีจริงไม่ได้"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    const update = () => { void refresh(); };
    update();
    window.addEventListener("blu-real-payment-updated", update);
    window.addEventListener("focus", update);
    return () => { window.removeEventListener("blu-real-payment-updated", update); window.removeEventListener("focus", update); };
  }, [refresh]);
  return <section className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
    <div className="flex items-center justify-between">
      <h2 className="font-black">{isEn ? "Membership & Payment Status" : "สมาชิก / การชำระเงินจริง"}</h2>
      <button className="text-xs underline disabled:opacity-40 cursor-pointer" disabled={busy} onClick={() => void refresh()}>{isEn ? "Refresh" : "โหลดล่าสุด"}</button>
    </div>
    {error && <p role="alert" className="text-rose-700">{error} — ไม่ใช้ข้อมูล localStorage แทน</p>}
    {busy && <p role="status">{isEn ? "Loading database..." : "กำลังโหลดฐานข้อมูล..."}</p>}
    {account && <>
      <p>{isEn ? "Package: " : "แพ็กเกจ: "}<strong>{account.package?.name ?? (account.purchases.some(p => p.cancelledAt) ? (isEn ? "No current online package" : "ไม่มีแพ็กเกจออนไลน์ปัจจุบัน") : isEn ? "No package purchased yet" : "ยังไม่มีแพ็กเกจที่ชำระผ่านระบบใหม่")}</strong></p>
      <p>{isEn ? "Time Slot: " : "ช่วงเวลา: "}{account.package?.timeSlot ?? "—"}</p>
      <p>{isEn ? "Expires: " : "หมดอายุจริง: "}<strong>{date(account.expiresAt, isEn)}</strong></p>
      <p>{isEn ? "Status: " : "สถานะ: "}{account.status === "EXPIRED" ? (isEn ? "Expired" : "หมดอายุ") : account.status === "ACTIVE" ? (isEn ? "Active" : "ใช้งานได้") : account.status === "SUSPENDED" ? (isEn ? "Suspended" : "ถูกระงับ") : (isEn ? "Inactive / Expired" : "ยังไม่ใช้งาน / หมดอายุ")}</p>
      <p>{isEn ? "Points in DB: " : "แต้มจริงใน DB: "}<strong>{account.points}</strong> {isEn ? "(Redeemable in Member Rewards)" : "(ใช้แลกรางวัลผ่านระบบสมาชิก)"}</p>
      <details>
        <summary className="cursor-pointer font-bold">{isEn ? `Payment History (${account.purchases.length} latest)` : `ประวัติชำระเงินจริง (${account.purchases.length} รายการล่าสุด)`}</summary>
        {account.purchases.map(p => <div key={p.id} className="mt-2 border-t border-emerald-200 pt-2"><p className="font-bold">{p.package.name} • ฿{(p.amountSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</p><p className="text-xs">{date(p.paidAt, isEn)} • {isEn ? `Earned ${p.pointsEarned} pts` : `ได้ ${p.pointsEarned} แต้ม`}<br />{isEn ? "Order " : "คำสั่งซื้อ "}{p.id}</p>{p.cancelledAt && <p className="text-xs text-amber-900">
          {isEn ? "Cancelled · full refund recorded externally: " : "ยกเลิกแล้ว · บันทึกคืนเงินเต็มจำนวนนอกระบบ: "}
          {date(p.cancelledAt, isEn)}{p.refundSatang != null && ` · ฿${(p.refundSatang / 100).toFixed(2)}`}
        </p>}</div>)}
        {!account.purchases.length && <p className="mt-2">{isEn ? "No payments recorded yet" : "ยังไม่มีรายการชำระผ่านระบบใหม่"}</p>}
      </details>
    </>}
  </section>;
}
