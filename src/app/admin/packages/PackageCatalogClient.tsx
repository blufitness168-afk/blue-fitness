"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PackageCatalogItem } from "@/lib/package-catalog";

type Draft = Omit<PackageCatalogItem, "price"> & { price: string };
type Pending = { requestKey: string; body: string; id: number };
const inputClass = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:opacity-60";
const buttonClass = "rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50";

function draftOf(item: PackageCatalogItem): Draft {
  return { ...item, price: String(item.price) };
}

// Parse decimal digits as satang first; never round an invalid third decimal place.
function priceValue(text: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const satang = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(satang) && satang >= 1 && satang <= 100000000 ? satang / 100 : null;
}

export default function PackageCatalogClient() {
  const [packages, setPackages] = useState<PackageCatalogItem[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [needsReload, setNeedsReload] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const lock = useRef(false);
  const loadLock = useRef(false);

  async function reload() {
    if (loadLock.current) return false;
    loadLock.current = true;
    try {
      const response = await fetch("/api/admin/packages", { cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("โหลดแพ็กเกจไม่สำเร็จ กรุณาลองใหม่");
      const result = await response.json();
      if (!Array.isArray(result?.data?.packages)) throw new Error("รูปแบบข้อมูลแพ็กเกจไม่ถูกต้อง");
      setLoadError("");
      setPackages(result.data.packages);
      setDraft(null);
      setNeedsReload(false);
      return true;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ");
      return false;
    } finally {
      loadLock.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function send(request: Pending) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setPending(request);
    setMessage("");
    try {
      const response = await fetch("/api/admin/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: request.body,
        signal: AbortSignal.timeout(20000),
      });
      if (response.status >= 400 && response.status < 500) {
        setPending(null);
        if (response.status === 409 || response.status === 412) {
          setNeedsReload(true);
          setMessage("เวอร์ชันขัดแย้ง มีผู้แก้ไขข้อมูลแล้ว กรุณากดโหลดข้อมูลล่าสุดและแก้ไขใหม่ ไม่มีการเขียนทับอัตโนมัติ");
        } else {
          setMessage(`คำขอถูกปฏิเสธ (${response.status}) แก้ไขข้อมูลหรือโหลดข้อมูลล่าสุดแล้วลองใหม่`);
        }
        return;
      }
      if (!response.ok) throw new Error("unknown");
      const result = await response.json();
      if (!result || typeof result !== "object" || !("data" in result)) throw new Error("unknown");
      setPending(null);
      setDraft(null);
      setNeedsReload(true);
      setMessage("บันทึกแล้ว กำลังโหลดข้อมูลล่าสุด");
      setLoading(true);
      const refreshed = await reload();
      setMessage(refreshed ? "บันทึกสำเร็จ ใช้ข้อมูลล่าสุดจากเซิร์ฟเวอร์เท่านั้น" : "บันทึกสำเร็จ แต่ยังโหลดข้อมูลล่าสุดไม่ได้ กรุณากดโหลดข้อมูลล่าสุดก่อนแก้ไขต่อ");
    } catch {
      setMessage("ยังไม่ทราบผลการบันทึก ห้ามส่งคำขอใหม่ กดลองคำขอเดิมซ้ำเพื่อยืนยันผล (UUID และข้อมูลเดิม)");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || pending || lock.current || loading || needsReload || loadError) return;
    const price = priceValue(draft.price);
    if (price === null) {
      setMessage("ราคาต้องเป็น 0.01–1,000,000 บาท ทศนิยมไม่เกิน 2 ตำแหน่ง");
      return;
    }
    const ranges = [[draft.durationDays, 1, 3660], [draft.friendCoupons, 0, 100], [draft.bonusDays, 0, 365]];
    if (ranges.some(([value, min, max]) => !Number.isInteger(value) || value < min || value > max)
      || !draft.name.trim() || !draft.label.trim()
      || !["07:00-14:00", "07:00-22:00"].includes(draft.timeSlot)) {
      setMessage("กรุณาตรวจสอบชื่อ ช่วงเวลา และจำนวนวัน/คูปอง");
      return;
    }
    const requestKey = crypto.randomUUID();
    const body = JSON.stringify({
      requestKey, id: draft.id, expectedVersion: draft.version,
      name: draft.name.trim(), label: draft.label.trim(), durationDays: draft.durationDays,
      timeSlot: draft.timeSlot, price, friendCoupons: draft.friendCoupons,
      bonusDays: draft.bonusDays, description: draft.description, isActive: draft.isActive,
    });
    void send({ requestKey, body, id: draft.id });
  }

  const disabled = busy || !!pending || loading || needsReload || !!loadError;
  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-5 break-words">
      <header>
        <h1 className="text-2xl font-bold">จัดการแพ็กเกจ</h1>
        <p className="mt-2 text-sm text-slate-600">แก้ไขแพ็กเกจเดิมเท่านั้น เปิด/ปิดขายได้ ไม่มีการเพิ่มหรือลบ</p>
        <p className="mt-1 text-sm text-slate-600">ราคาใหม่ใช้กับคำสั่งซื้อใหม่ คำสั่งซื้อเก่าที่รอชำระยังคงราคาและสิทธิ์เดิม วันโบนัสเป็นคูปอง ไม่ได้เพิ่มวันสมาชิกอัตโนมัติ</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={loading || busy || !!pending} onClick={() => { setLoading(true); void reload(); }}>โหลดข้อมูลล่าสุด / ยกเลิกการแก้ไข</button>
      </div>
      {message && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">{message}</p>}
      {loadError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{loadError} — ยังไม่สามารถแก้ไขได้ กรุณาโหลดข้อมูลล่าสุด</p>}
      {pending && (
        <section className="min-w-0 space-y-2 rounded-xl border border-amber-400 bg-amber-50 p-4" aria-label="คำขอที่ยังไม่ทราบผล">
          <p className="text-sm font-semibold">คำขอเดิม: แพ็กเกจ #{pending.id}</p>
          <p className="break-all text-xs">UUID: {pending.requestKey}</p>
          <p className="text-sm">เก็บคำขอนี้ในหน้านี้เท่านั้น อย่าปิดหรือรีเฟรชหน้าจนทราบผล</p>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void send(pending)}>{busy ? "กำลังยืนยันผล…" : "ลองคำขอเดิมซ้ำ"}</button>
        </section>
      )}
      {loading && <p role="status">กำลังโหลด…</p>}
      {!loading && !loadError && packages.length === 0 && <p>ไม่พบแพ็กเกจ</p>}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {packages.map((item) => (
          <button key={item.id} type="button" disabled={disabled} onClick={() => { setDraft(draftOf(item)); setMessage(""); }}
            className={`min-w-0 rounded-xl border bg-white p-4 text-left disabled:opacity-60 ${draft?.id === item.id ? "border-blue-600 ring-1 ring-blue-600" : "border-slate-200"}`}>
            <span className="block text-xs text-slate-500">#{item.id} · เวอร์ชัน {item.version} · {item.isActive ? "เปิดขาย" : "ปิดขาย"}</span>
            <span className="mt-1 block font-semibold">{item.name}</span>
            <span className="mt-1 block text-sm">{Number(item.price).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท · {item.durationDays} วัน · {item.timeSlot}</span>
          </button>
        ))}
      </div>
      {draft && (
        <form onSubmit={submit} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-bold">แก้ไขแพ็กเกจ #{draft.id}</h2>
          <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="min-w-0 text-sm">รหัส (แก้ไขไม่ได้)<input className={inputClass} value={draft.id} readOnly /></label>
            <label className="min-w-0 text-sm">เวอร์ชัน (แก้ไขไม่ได้)<input className={inputClass} value={draft.version} readOnly /></label>
            <label className="min-w-0 text-sm">ชื่อ<input required maxLength={200} className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className="min-w-0 text-sm">ป้ายชื่อ<input required maxLength={100} className={inputClass} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
            <label className="min-w-0 text-sm">ราคา (บาท)<input required inputMode="decimal" className={inputClass} value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></label>
            <label className="min-w-0 text-sm">ช่วงเวลา<select aria-label="ช่วงเวลา" className={inputClass} value={draft.timeSlot} onChange={(e) => setDraft({ ...draft, timeSlot: e.target.value as PackageCatalogItem["timeSlot"] })}><option value="07:00-14:00">07:00–14:00</option><option value="07:00-22:00">07:00–22:00</option></select></label>
            {([
              ["durationDays", "จำนวนวัน", 1, 3660],
              ["friendCoupons", "คูปองพาเพื่อน", 0, 100],
              ["bonusDays", "วันในคูปองโบนัส", 0, 365],
            ] as const).map(([key, label, min, max]) => (
              <label key={key} className="min-w-0 text-sm">{label} ({min}–{max})<input required type="number" min={min} max={max} step={1} className={inputClass} value={Number.isNaN(draft[key]) ? "" : draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.valueAsNumber })} /></label>
            ))}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />เปิดขาย</label>
            <label className="min-w-0 text-sm sm:col-span-2">รายละเอียด<textarea maxLength={2000} rows={3} className={inputClass} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
            <button type="submit" className={`${buttonClass} bg-blu-dark text-white sm:col-span-2`}>บันทึกการเปลี่ยนแปลง</button>
          </fieldset>
        </form>
      )}
    </div>
  );
}
