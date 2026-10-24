"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealReward, RewardsData } from "@/lib/real-rewards-server";

const blank = { title: "", description: "", imageUrl: "", pointCost: 1, stock: 0, isActive: true };
type Draft = typeof blank & { id?: number };
type Pending = { action: "save" | "deliver"; body: Record<string, unknown> };
const input = "w-full rounded-lg border p-2";
const button = "rounded-lg border px-3 py-2 disabled:opacity-40";

export default function AdminRewardsPage() {
  const [data, setData] = useState<RewardsData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expected, setExpected] = useState<RealReward | null>(null);
  const [code, setCode] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [needsRetry, setNeedsRetry] = useState(false);
  const lock = useRef(false);
  const pending = useRef<Pending | null>(null);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/rewards/admin", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "โหลดข้อมูลไม่ได้");
    setData(result.data);
  }, []);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/rewards/admin", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "โหลดข้อมูลไม่ได้");
        if (active) setData(result.data);
      } catch { if (active) setError("โหลดข้อมูลไม่ได้ กรุณาลองใหม่"); }
    }
    void load();
    return () => { active = false; };
  }, []);
  async function mutate(operation?: Pending) {
    if (lock.current || (operation && pending.current)) return;
    if (operation) pending.current = operation;
    if (!pending.current) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const request = pending.current;
      const response = await fetch(`/api/rewards/${request.action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) { pending.current = null; setNeedsRetry(false); }
        throw new Error(result.error || "บันทึกไม่ได้");
      }
      pending.current = null; setNeedsRetry(false); setDraft(null); setExpected(null); setCode("");
      setMessage("บันทึกสำเร็จ");
      await refresh();
    } catch (cause) {
      setNeedsRetry(pending.current !== null);
      setError(cause instanceof Error ? cause.message : "ยังไม่ทราบผล กรุณาลองคำขอเดิม");
    } finally { lock.current = false; setBusy(false); }
  }
  const disabled = busy || needsRetry || !data;
  const records = data?.redemptions.filter(record => (status === "ALL" || record.status === status) &&
    `${record.memberCode} ${record.memberName} ${record.rewardTitle} ${record.rewardCode ?? ""}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <main className="space-y-6 text-blu-dark">
    <h1 className="text-2xl font-black">จัดการรางวัล</h1>
    <p className="text-sm">ข้อมูลจริง · สต็อกที่แสดงคือจำนวนคงเหลือ · ส่งมอบได้เฉพาะ ADMIN / OWNER</p>
    {error && <p role="alert" className="text-rose-700">{error}</p>}{message && <p role="status">{message}</p>}
    <button className={button} disabled={busy} onClick={() => { void refresh().catch(() => setError("โหลดข้อมูลไม่ได้")); }}>โหลดใหม่</button>
    {needsRetry && <div role="status"><p>ยังไม่ทราบผลคำขอ ห้ามเริ่มรายการใหม่จนกว่าจะตรวจสอบคำขอเดิม</p><button className={button} disabled={busy} onClick={() => void mutate()}>ลองคำขอเดิม</button></div>}
    <section className="space-y-3 rounded-2xl border bg-white p-5">
      <h2 className="text-lg font-bold">ส่งมอบรางวัล</h2>
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (window.confirm("ตรวจสอบรหัสและผู้รับแล้ว ยืนยันส่งมอบรางวัล?")) void mutate({ action: "deliver", body: { rewardCode: code.trim(), requestKey: crypto.randomUUID() } }); }}>
        <input aria-label="รหัสรับของ UUID" className={input} required value={code} onChange={event => setCode(event.target.value)} placeholder="รหัสรับของ UUID" disabled={disabled} />
        <button className={button} disabled={disabled}>ยืนยันส่งมอบ</button>
      </form>
      <div className="flex gap-2"><input aria-label="ค้นหาประวัติ" className={input} value={query} onChange={event => setQuery(event.target.value)} placeholder="สมาชิก / รางวัล / รหัส" /><select aria-label="สถานะ" className={input} value={status} onChange={event => setStatus(event.target.value)}><option value="PENDING">รอรับของ</option><option value="COMPLETED">รับแล้ว</option><option value="ALL">ทั้งหมด</option></select></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["สมาชิก", "รางวัล / แต้ม", "รหัส", "สถานะ / วันที่"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{records.map(record => <tr className="border-t" key={record.id}><td className="p-2">{record.memberCode}<br />{record.memberName}</td><td className="p-2">{record.rewardTitle}<br />{record.pointsSpent} แต้ม</td><td className="max-w-48 break-all p-2">{record.rewardCode ?? "รายการเก่า ไม่มีรหัส"}{record.status === "PENDING" && record.rewardCode && <button className={button} disabled={disabled} onClick={() => setCode(record.rewardCode!)}>เลือกรหัส</button>}</td><td className="p-2">{record.status}<br />{new Date(record.redeemedAt).toLocaleString("th-TH")}{record.completedAt && <p>รับ: {new Date(record.completedAt).toLocaleString("th-TH")}</p>}</td></tr>)}</tbody></table></div>
      {data && !records.length && <p>ไม่พบรายการ</p>}
    </section>
    <section className="space-y-4 rounded-2xl border bg-white p-5">
      <div className="flex justify-between"><h2 className="text-lg font-bold">คลังรางวัล</h2><button className={button} disabled={disabled} onClick={() => { setDraft({ ...blank }); setExpected(null); }}>เพิ่มรางวัล</button></div>
      {draft && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void mutate({ action: "save", body: { ...draft, description: draft.description || null, imageUrl: draft.imageUrl || null, ...(expected ? { expected } : {}), requestKey: crypto.randomUUID() } }); }}>
        <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
          <label>ชื่อ<input className={input} required maxLength={120} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>รายละเอียด<textarea className={input} maxLength={2000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
          <label>รูป HTTPS (ไม่บังคับ)<input className={input} type="url" maxLength={2000} value={draft.imageUrl} onChange={event => setDraft({ ...draft, imageUrl: event.target.value })} /></label>
          <label>แต้ม<input className={input} required type="number" min={1} max={1000000} step={1} value={draft.pointCost} onChange={event => setDraft({ ...draft, pointCost: Number(event.target.value) })} /></label>
          <label>สต็อกคงเหลือ<input className={input} required type="number" min={0} max={1000000} step={1} value={draft.stock} onChange={event => setDraft({ ...draft, stock: Number(event.target.value) })} /></label>
          <label><input type="checkbox" checked={draft.isActive} onChange={event => setDraft({ ...draft, isActive: event.target.checked })} /> เปิดให้แลก</label>
          <button className={button}>บันทึก</button><button className={button} type="button" onClick={() => setDraft(null)}>ยกเลิก</button>
        </fieldset>
      </form>}
      {data?.rewards.map(reward => <article key={reward.id} className="flex items-center justify-between gap-3 border-t py-3"><div><strong>{reward.title}</strong><p>{reward.pointCost} แต้ม · เหลือ {reward.stock} · {reward.isActive ? "เปิด" : "ปิด"}</p></div><button className={button} disabled={disabled} onClick={() => { setExpected(reward); setDraft({ ...reward, description: reward.description ?? "", imageUrl: reward.imageUrl ?? "" }); }}>แก้ไข / เปิดปิด</button></article>)}
    </section>
  </main>;
}
