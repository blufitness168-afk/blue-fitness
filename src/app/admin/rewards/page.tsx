"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminScanner from "@/components/AdminScanner";
import type { AdminRewardsHistory, RealReward } from "@/lib/real-rewards-server";

const blank = { title: "", description: "", imageUrl: "", pointCost: 1, stock: 0, isActive: true };
type Draft = typeof blank & { id?: number };
type Pending = { action: "save" | "deliver"; body: Record<string, unknown> };
const input = "w-full rounded-lg border p-2";
const button = "rounded-lg border px-3 py-2 disabled:opacity-40";
const initialFilters = { status: "PENDING", memberCode: "", memberName: "", rewardCode: "" };
type Search = typeof initialFilters & { scan?: string; packageDays?: number | "UNKNOWN" };
const thaiDateTime = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

export default function AdminRewardsPage() {
  const [data, setData] = useState<AdminRewardsHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [filters, setFilters] = useState(initialFilters);
  const [packageDays, setPackageDays] = useState("");
  const [unknownPackage, setUnknownPackage] = useState(false);
  const [page, setPage] = useState(0);
  const [scanResult, setScanResult] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expected, setExpected] = useState<RealReward | null>(null);
  const [code, setCode] = useState("");
  const applied = useRef<{ search: Search; cursors: (number | null)[] }>({ search: initialFilters, cursors: [null] });
  const activeRead = useRef<AbortController | null>(null);
  const [needsRetry, setNeedsRetry] = useState(false);
  const lock = useRef(false);
  const pending = useRef<Pending | null>(null);
  const load = useCallback((search: Search, cursors: (number | null)[]) => {
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    applied.current = { search, cursors };
    return fetch("/api/rewards/admin-history", {
      method: "POST", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...search, beforeId: cursors[cursors.length - 1] }),
    }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "โหลดข้อมูลไม่ได้");
      if (!controller.signal.aborted) {
        setData(result.data);
        setPage(cursors.length - 1);
        setScanResult(Boolean(search.scan));
      }
    }).catch(cause => {
      if (!controller.signal.aborted) {
        setData(null);
        setHistoryError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่ได้ กรุณาลองใหม่");
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, []);
  function searchHistory(search: Search, cursors: (number | null)[]) {
    setLoading(true); setHistoryError(""); setCode("");
    return load(search, cursors);
  }
  const refresh = () => searchHistory(applied.current.search, [null]);
  useEffect(() => {
    void load(initialFilters, [null]);
    return () => activeRead.current?.abort();
  }, [load]);
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
  async function uploadImage(file: File) {
    if (lock.current || pending.current) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("เลือกรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 5MB"); return;
    }
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/rewards/upload", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || typeof result.url !== "string") throw new Error(result.error || "อัปโหลดไม่ได้");
      setDraft(current => current ? { ...current, imageUrl: result.url } : null);
      setMessage("อัปโหลดรูปแล้ว กรุณากดบันทึกรางวัล");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "อัปโหลดไม่ได้ กรุณาลองใหม่"); }
    finally { lock.current = false; setBusy(false); }
  }
  const disabled = busy || loading || needsRetry || !data;
  const records = loading ? [] : data?.redemptions ?? [];
  return <main className="space-y-6 text-blu-dark">
    <h1 className="text-2xl font-black">จัดการรางวัล</h1>
    <p className="text-sm">ข้อมูลจริง · สต็อกที่แสดงคือจำนวนคงเหลือ · ส่งมอบได้เฉพาะ ADMIN / OWNER</p>
    {error && <p role="alert" className="text-rose-700">{error}</p>}{message && <p role="status">{message}</p>}
    <button className={button} disabled={busy || loading} onClick={() => void refresh()}>โหลดใหม่</button>
    {needsRetry && <div role="status"><p>ยังไม่ทราบผลคำขอ ห้ามเริ่มรายการใหม่จนกว่าจะตรวจสอบคำขอเดิม</p><button className={button} disabled={busy} onClick={() => void mutate()}>ลองคำขอเดิม</button></div>}
    <section className="space-y-3 rounded-2xl border bg-white p-5">
      <h2 className="text-lg font-bold">ส่งมอบรางวัล</h2>
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (window.confirm("ตรวจสอบรหัสและผู้รับแล้ว ยืนยันส่งมอบรางวัล?")) void mutate({ action: "deliver", body: { rewardCode: code.trim(), requestKey: crypto.randomUUID() } }); }}>
        <input aria-label="รหัสรับของ" className={input} required maxLength={50} value={code} onChange={event => setCode(event.target.value)} placeholder="UUID หรือ BLU-RW-…" disabled={disabled} />
        <button className={button} disabled={disabled}>ยืนยันส่งมอบ</button>
      </form>
      <AdminScanner label="สแกนเพื่อค้นเท่านั้น: BLU-RW / UUID / BLU / CARD" disabled={busy || loading || needsRetry} onScan={scan => {
        setFilters({ ...initialFilters, status: "ALL" }); setPackageDays(""); setUnknownPackage(false);
        return searchHistory({ ...initialFilters, status: "ALL", scan }, [null]);
      }} />
      <form className="space-y-2" onSubmit={event => {
        event.preventDefault();
        void searchHistory({ ...filters, packageDays: unknownPackage ? "UNKNOWN" : packageDays ? Number(packageDays) : undefined }, [null]);
      }}>
        <fieldset disabled={busy || loading} className="grid gap-2 sm:grid-cols-2">
          <label>รหัสสมาชิก<input className={input} maxLength={50} value={filters.memberCode} onChange={event => setFilters({ ...filters, memberCode: event.target.value })} placeholder="BLU-…" /></label>
          <label>ชื่อสมาชิก<input className={input} maxLength={120} value={filters.memberName} onChange={event => setFilters({ ...filters, memberName: event.target.value })} /></label>
          <label>รหัสรางวัล<input className={input} maxLength={50} value={filters.rewardCode} onChange={event => setFilters({ ...filters, rewardCode: event.target.value })} placeholder="UUID หรือ BLU-RW-…" /></label>
          <label>สถานะ<select className={input} value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="PENDING">รอรับของ</option><option value="COMPLETED">รับแล้ว</option><option value="ALL">ทั้งหมด</option></select></label>
          <label>ประเภทแพ็กเกจ (จำนวนวัน)<input type="number" min={1} max={3660} step={1} className={input} disabled={unknownPackage} value={packageDays} onChange={event => setPackageDays(event.target.value)} /></label>
          <label className="self-end py-2"><input type="checkbox" checked={unknownPackage} onChange={event => setUnknownPackage(event.target.checked)} /> ไม่พบหลักฐานซื้อออนไลน์ก่อนแลก</label>
          <div className="flex gap-2"><button className={button}>ค้นหา</button><button className={button} type="button" onClick={() => { setFilters(initialFilters); setPackageDays(""); setUnknownPackage(false); void searchHistory(initialFilters, [null]); }}>ล้างตัวกรอง</button></div>
        </fieldset>
        <p className="text-xs">ตัวกรองแพ็กเกจอิงระยะเวลาจากรายการซื้อออนไลน์ที่ยืนยันก่อนหรือ ณ เวลาแลก ไม่ใช่แพ็กเกจที่มีผล ณ เวลาแลก และไม่รวมการซื้อหน้าร้าน</p>
      </form>
      {loading && <p role="status">กำลังโหลดประวัติ…</p>}
      {historyError && <p role="alert" className="text-rose-700">{historyError}</p>}
      {!loading && data && !data.cardSearchAvailable && <p className="text-xs">ฐานข้อมูลนี้ยังไม่รองรับ CARD กรุณาใช้รหัส BLU</p>}
      {!loading && data && scanResult && <p className="text-sm">ผลการค้นจากเครื่องสแกน · แสดงทุกสถานะ</p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["สมาชิก", "รางวัล / แต้ม", "รหัส", "สถานะ / วันที่"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{records.map(record => <tr className="border-t" key={record.id}><td className="p-2">{record.memberCode}<br />{record.memberName}</td><td className="p-2">{record.rewardTitle}<br />{record.pointsSpent} แต้ม</td><td className="max-w-48 break-all p-2">{record.rewardCode ?? "รายการเก่า ไม่มีรหัส"}{record.status === "PENDING" && record.rewardCode && <button className={button} disabled={disabled} onClick={() => setCode(record.rewardCode!)}>เลือกรหัส</button>}</td><td className="p-2">{record.status}<br />{thaiDateTime.format(new Date(record.redeemedAt))}{record.completedAt && <p>รับ: {thaiDateTime.format(new Date(record.completedAt))}</p>}</td></tr>)}</tbody></table></div>
      {!loading && data && <>
        {!records.length && <p>ไม่พบรายการ</p>}
        <nav className="flex items-center gap-3" aria-label="หน้าประวัติรางวัล">
          <button className={button} disabled={busy || page === 0} onClick={() => void searchHistory(applied.current.search, applied.current.cursors.slice(0, -1))}>ก่อนหน้า</button>
          <span>หน้า {page + 1}</span>
          <button className={button} disabled={busy || data.nextBeforeId === null} onClick={() => {
            if (data.nextBeforeId !== null) void searchHistory(applied.current.search, [...applied.current.cursors, data.nextBeforeId]);
          }}>ถัดไป</button>
        </nav>
      </>}
    </section>
    <section className="space-y-4 rounded-2xl border bg-white p-5">
      <div className="flex justify-between"><h2 className="text-lg font-bold">คลังรางวัล</h2><button className={button} disabled={disabled} onClick={() => { setDraft({ ...blank }); setExpected(null); }}>เพิ่มรางวัล</button></div>
      {draft && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void mutate({ action: "save", body: { ...draft, description: draft.description || null, imageUrl: draft.imageUrl || null, ...(expected ? { expected } : {}), requestKey: crypto.randomUUID() } }); }}>
        <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
          <label>ชื่อ<input className={input} required maxLength={120} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>รายละเอียด<textarea className={input} maxLength={2000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
          <label>เลือกรูปรางวัล (JPG, PNG, WebP ไม่เกิน 5MB)<input className={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadImage(file); }} /></label>
          <label>รูป HTTPS (ไม่บังคับ)<input className={input} type="url" maxLength={2000} value={draft.imageUrl} onChange={event => setDraft({ ...draft, imageUrl: event.target.value })} /></label>
          {draft.imageUrl && <p className="text-sm">มีรูปรางวัลแล้ว · รูปจะผูกกับรางวัลเมื่อกดบันทึก</p>}
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
