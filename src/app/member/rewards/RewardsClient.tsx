"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { RealReward, RewardsData } from "@/lib/real-rewards-server";

export default function RewardsClient({ initialData }: { initialData: RewardsData }) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  // Keep the same UUID after an ambiguous network failure; never spend again to retry.
  const pending = useRef<{ reward: RealReward; requestKey: string } | null>(null);
  const [retryReward, setRetryReward] = useState<RealReward | null>(null);
  async function refresh() {
    const response = await fetch("/api/rewards/member", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "โหลดข้อมูลไม่ได้");
    setData(result.data);
  }
  async function redeem(reward: RealReward) {
    if (lock.current || (pending.current && pending.current.reward.id !== reward.id)) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    pending.current ??= { reward: { ...reward }, requestKey: crypto.randomUUID() };
    setRetryReward(pending.current.reward);
    try {
      const response = await fetch("/api/rewards/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rewardId: pending.current.reward.id, requestKey: pending.current.requestKey }) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) { pending.current = null; setRetryReward(null); }
        throw new Error(result.error || "แลกไม่ได้");
      }
      pending.current = null; setRetryReward(null);
      setMessage(`แลกรางวัลสำเร็จ รหัสรับของ: ${result.data.rewardCode}`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ยังไม่ทราบผล กรุณาลองรายการเดิมอีกครั้ง"); }
    finally { lock.current = false; setBusy(false); }
  }
  return <main className="mx-auto max-w-2xl space-y-6 px-4 py-12 text-blu-dark">
    <Link href="/member" className="underline">กลับบัญชีสมาชิก</Link>
    <h1 className="text-2xl font-black">ร้านรางวัล</h1>
    <p>{data.fullName} · {data.memberCode}</p>
    <p className="rounded-2xl bg-blu-dark p-6 text-xl font-bold text-white">แต้มคงเหลือ {data.points.toLocaleString()}</p>
    <p className="text-sm">แต้มและสต็อกจากฐานข้อมูลจริง · แสดงรหัสให้พนักงานก่อนรับของ</p>
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    {message && <p role="status">{message}</p>}
    {retryReward && <section aria-label="คำขอแลกรางวัลที่ยังไม่ทราบผล" className="space-y-2 rounded-xl border p-4">
      <p role="status">มีคำขอที่ยังไม่ทราบผล: {retryReward.title} · {retryReward.pointCost} แต้ม กรุณาลองคำขอเดิมก่อนเริ่มรายการอื่น และอย่าเพิ่งปิดหน้านี้</p>
      <button disabled={busy} className="btn-gold rounded-xl px-4 py-2 disabled:opacity-40" onClick={() => void redeem(retryReward)}>ลองคำขอเดิม</button>
    </section>}
    <button disabled={busy} className="underline" onClick={() => { void refresh().catch(() => setError("โหลดข้อมูลไม่ได้")); }}>โหลดข้อมูลใหม่</button>
    <section className="grid grid-cols-2 gap-4">{data.rewards.map(reward => <article key={reward.id} className="space-y-3 rounded-2xl border bg-white p-4">
      <h2 className="font-bold">{reward.title}</h2><p className="text-sm">{reward.description}</p>
      <p>{reward.pointCost.toLocaleString()} แต้ม · เหลือ {reward.stock}</p>
      <button className="btn-gold rounded-xl px-4 py-2 disabled:opacity-40" disabled={busy || retryReward !== null || data.points < reward.pointCost || reward.stock <= 0} onClick={() => void redeem(reward)}>แลกรางวัล</button>
    </article>)}{!data.rewards.length && <p>ยังไม่มีรางวัลเปิดให้แลก</p>}</section>
    <section className="space-y-3"><h2 className="text-lg font-bold">ประวัติและรหัสรับของ</h2>{data.redemptions.map(record => <details key={record.id} className="rounded-xl border bg-white p-4">
      <summary>{record.rewardTitle} · {record.pointsSpent} แต้ม · {record.status === "PENDING" ? "รอรับของ" : record.status === "COMPLETED" ? "รับแล้ว" : record.status}</summary>
      <p className="my-2 text-sm">{new Date(record.redeemedAt).toLocaleString("th-TH")}</p>
      {record.rewardCode ? <><p className="my-3 break-all font-mono">{record.rewardCode}</p><QRCodeSVG value={record.rewardCode} size={160} title="รหัสรับของ" /></> : <p>รายการเก่าไม่มีรหัสรับของ</p>}
    </details>)}</section>
  </main>;
}
