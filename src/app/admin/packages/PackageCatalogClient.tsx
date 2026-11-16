"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PackageCatalogItem } from "@/lib/package-catalog";

type Draft = Omit<PackageCatalogItem, "price"> & { price: string };
type Pending = { requestKey: string; body: string; id: number };
const inputClass = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:opacity-60 text-sm";
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
          setMessage("เวอร์ชันขัดแย้ง มีผู้แก้ไขข้อมูลแล้ว กรุณาโหลดข้อมูลล่าสุดและแก้ไขใหม่ ไม่มีการเขียนทับอัตโนมัติ");
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
      setMessage(refreshed ? "บันทึกสำเร็จ ใช้ข้อมูลล่าสุดจากเซิร์ฟเวอร์เรียบร้อย" : "บันทึกสำเร็จ แต่ยังโหลดข้อมูลล่าสุดไม่ได้");
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

  function handleAddOrActivateClick() {
    setMessage("");
    const inactive = packages.find((p) => !p.isActive);
    if (inactive) {
      setDraft({ ...draftOf(inactive), isActive: true });
      return;
    }
    setMessage("แพ็กเกจทั้ง 10 รูปแบบเปิดขายอยู่แล้ว สามารถคลิกเลือกการ์ดใดก็ได้เพื่อปรับเปลี่ยนข้อมูล");
  }

  const disabled = busy || !!pending || loading || needsReload || !!loadError;

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6 break-words">
      <header>
        <h1 className="text-2xl font-black text-blu-dark">จัดการแพ็กเกจ</h1>
        <p className="mt-2 text-sm text-slate-600">แก้ไขแพ็กเกจเดิมเท่านั้น เปิด/ปิดขายได้ ไม่มีการเพิ่มหรือลบ</p>
        <p className="mt-1 text-sm text-slate-600">ราคาใหม่ใช้กับคำสั่งซื้อใหม่ คำสั่งซื้อเก่าที่รอชำระยังคงราคาและสิทธิ์เดิม วันโบนัสเป็นคูปอง ไม่ได้เพิ่มวันสมาชิกอัตโนมัติ</p>
      </header>

      {message && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">{message}</p>}
      {loadError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{loadError} — กรุณาลองใหม่</p>}

      {pending && (
        <section className="min-w-0 space-y-2 rounded-xl border border-amber-400 bg-amber-50 p-4" aria-label="คำขอที่ยังไม่ทราบผล">
          <p className="text-sm font-semibold">คำขอเดิม: แพ็กเกจ #{pending.id}</p>
          <p className="break-all text-xs">UUID: {pending.requestKey}</p>
          <p className="text-sm">เก็บคำขอนี้ในหน้านี้เท่านั้น อย่าปิดหรือรีเฟรชหน้าจนทราบผล</p>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void send(pending)}>{busy ? "กำลังยืนยันผล…" : "ลองคำขอเดิมซ้ำ"}</button>
        </section>
      )}

      {loading && <p role="status" className="text-sm text-slate-500">กำลังโหลดแพ็กเกจ…</p>}
      {!loading && !loadError && packages.length === 0 && <p className="text-sm text-slate-500">ไม่พบแพ็กเกจ</p>}

      {/* Cards Grid: Dashed + card first, followed by package cards */}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* First Card: Dashed border with + icon */}
        <button
          type="button"
          disabled={disabled}
          onClick={handleAddOrActivateClick}
          className="group flex min-h-[180px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 p-6 text-center transition-all hover:border-blu-slate hover:bg-blue-50/40 cursor-pointer disabled:opacity-50"
        >
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-colors group-hover:bg-blue-100 group-hover:text-blu-slate">
            <svg className="h-6 w-6 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <span className="font-bold text-slate-700 group-hover:text-blu-slate">
            เพิ่ม / เปิดใช้แพ็กเกจ
          </span>
          <span className="mt-1 text-xs text-slate-500">
            เลือกแพ็กเกจที่ยังปิดขายเพื่อเปิดใช้งาน
          </span>
        </button>

        {/* Existing Package Cards */}
        {packages.map((item) => {
          const isOffPeak = item.timeSlot === "07:00-14:00";
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                setDraft(draftOf(item));
                setMessage("");
              }}
              className={`group relative flex min-h-[180px] flex-col justify-between rounded-2xl border bg-white p-5 text-left transition-all hover:shadow-md cursor-pointer disabled:opacity-60 ${
                draft?.id === item.id
                  ? "border-blu-slate ring-2 ring-blu-slate/30"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div>
                {/* Meta & Badges */}
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1.5">
                  <span className="text-xs font-semibold text-slate-400">
                    #{item.id} · v{item.version}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        isOffPeak
                          ? "bg-amber-100 text-amber-800"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {isOffPeak ? "Off-Peak (07:00-14:00)" : "All-Day (07:00-22:00)"}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        item.isActive
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {item.isActive ? "เปิดขาย" : "ปิดขาย"}
                    </span>
                  </div>
                </div>

                {/* Title & Label */}
                <h3 className="text-base font-bold text-blu-dark group-hover:text-blu-slate transition-colors">
                  {item.name}
                </h3>
                {item.label && item.label !== item.name && (
                  <p className="mt-0.5 text-xs font-medium text-blu-steel">
                    ป้าย: {item.label}
                  </p>
                )}

                {/* Description */}
                {item.description && (
                  <p className="mt-2 text-xs text-slate-500 line-clamp-2">
                    {item.description}
                  </p>
                )}
              </div>

              {/* Pricing & Duration footer */}
              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-black text-blu-dark">
                    ฿{Number(item.price).toLocaleString("th-TH", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span className="text-xs font-semibold text-slate-600">
                    {item.durationDays} วัน
                  </span>
                </div>

                {/* Bonus / coupons if any */}
                {((item.bonusDays ?? 0) > 0 || (item.friendCoupons ?? 0) > 0) && (
                  <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
                    {(item.bonusDays ?? 0) > 0 && (
                      <span className="font-semibold text-emerald-600">
                        + แถม {item.bonusDays} วัน
                      </span>
                    )}
                    {(item.friendCoupons ?? 0) > 0 && (
                      <span className="font-semibold text-blue-600">
                        + พาเพื่อน {item.friendCoupons} ใบ
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Edit Package Modal */}
      {draft && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-package-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setDraft(null);
            }
          }}
        >
          <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h2 id="modal-package-title" className="text-lg font-bold text-blu-dark">
                  แก้ไขแพ็กเกจ #{draft.id}
                </h2>
                <p className="text-xs text-slate-500">เวอร์ชัน {draft.version}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDraft(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
                aria-label="ปิด"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={submit} className="mt-4 space-y-4">
              <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
                <label className="min-w-0 text-sm">
                  รหัส (แก้ไขไม่ได้)
                  <input className={inputClass} value={draft.id} readOnly />
                </label>
                <label className="min-w-0 text-sm">
                  เวอร์ชัน (แก้ไขไม่ได้)
                  <input className={inputClass} value={draft.version} readOnly />
                </label>
                <label className="min-w-0 text-sm">
                  ชื่อ
                  <input
                    required
                    maxLength={200}
                    className={inputClass}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </label>
                <label className="min-w-0 text-sm">
                  ป้ายชื่อ
                  <input
                    required
                    maxLength={100}
                    className={inputClass}
                    value={draft.label}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  />
                </label>
                <label className="min-w-0 text-sm">
                  ราคา (บาท)
                  <input
                    required
                    inputMode="decimal"
                    className={inputClass}
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  />
                </label>
                <label className="min-w-0 text-sm">
                  ช่วงเวลา
                  <select
                    aria-label="ช่วงเวลา"
                    className={inputClass}
                    value={draft.timeSlot}
                    onChange={(e) => setDraft({ ...draft, timeSlot: e.target.value as PackageCatalogItem["timeSlot"] })}
                  >
                    <option value="07:00-14:00">07:00–14:00 (Off-Peak)</option>
                    <option value="07:00-22:00">07:00–22:00 (All-Day)</option>
                  </select>
                </label>
                {([
                  ["durationDays", "จำนวนวัน (1–3660)", 1, 3660],
                  ["friendCoupons", "คูปองพาเพื่อน (0–100)", 0, 100],
                  ["bonusDays", "วันในคูปองโบนัส (0–365)", 0, 365],
                ] as const).map(([key, label, min, max]) => (
                  <label key={key} className="min-w-0 text-sm">
                    {label}
                    <input
                      required
                      type="number"
                      min={min}
                      max={max}
                      step={1}
                      className={inputClass}
                      value={Number.isNaN(draft[key]) ? "" : draft[key]}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.valueAsNumber })}
                    />
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                  />
                  เปิดขาย
                </label>
                <label className="min-w-0 text-sm sm:col-span-2">
                  รายละเอียด
                  <textarea
                    maxLength={2000}
                    rows={3}
                    className={inputClass}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </label>
              </fieldset>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={disabled}
                  className="rounded-xl bg-blu-dark px-5 py-2 text-sm font-bold text-white hover:bg-blu-navy transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {busy ? "กำลังบันทึก…" : "บันทึกการเปลี่ยนแปลง"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
