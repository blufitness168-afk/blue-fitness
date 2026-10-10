"use client";
import { useCallback, useEffect, useState } from "react";

type Account = {
  memberCode: string; status: string; expiresAt: string | null; points: number;
  package: { name: string; timeSlot: string } | null;
  purchases: { id: string; package: { name: string }; amountSatang: number; paidAt: string; pointsEarned: number }[];
};
const date = (value: string | null) => value ? new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "—";
export default function RealPaymentAccount() {
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
    <div className="flex items-center justify-between"><h2 className="font-black">สมาชิก / การชำระเงินจริง</h2><button className="text-xs underline disabled:opacity-40" disabled={busy} onClick={() => void refresh()}>โหลดล่าสุด</button></div>
    {error && <p role="alert" className="text-rose-700">{error} — ไม่ใช้ข้อมูล localStorage แทน</p>}
    {busy && <p role="status">กำลังโหลดฐานข้อมูล...</p>}
    {account && <><p>แพ็กเกจ: <strong>{account.package?.name ?? "ยังไม่มีแพ็กเกจที่ชำระผ่านระบบใหม่"}</strong></p><p>ช่วงเวลา: {account.package?.timeSlot ?? "—"}</p><p>หมดอายุจริง: <strong>{date(account.expiresAt)}</strong></p><p>สถานะ: {account.status === "EXPIRED" ? "หมดอายุ" : account.status === "ACTIVE" ? "ใช้งานได้" : account.status === "SUSPENDED" ? "ถูกระงับ" : "ยังไม่ใช้งาน / หมดอายุ"}</p><p>แต้มจริงใน DB: <strong>{account.points}</strong> (แยกจากร้านแลกแต้มทดลอง)</p>
      <details><summary className="cursor-pointer font-bold">ประวัติชำระเงินจริง ({account.purchases.length} รายการล่าสุด)</summary>{account.purchases.map(p => <div key={p.id} className="mt-2 border-t border-emerald-200 pt-2"><p className="font-bold">{p.package.name} • ฿{(p.amountSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</p><p className="text-xs">{date(p.paidAt)} • ได้ {p.pointsEarned} แต้ม<br />คำสั่งซื้อ {p.id}</p></div>)}{!account.purchases.length && <p className="mt-2">ยังไม่มีรายการชำระผ่านระบบใหม่</p>}</details>
    </>}
  </section>;
}
