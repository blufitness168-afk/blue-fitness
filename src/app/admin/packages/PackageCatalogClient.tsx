"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PACKAGE_BONUS_POINTS_MAX, packageCatalogDailySlot, type PackageCatalogItem } from "@/lib/package-catalog";

type Draft = Omit<PackageCatalogItem, "price" | "bonusPoints"> & { price: string; bonusPoints: number };
type Pending = { requestKey: string; body: string; id: number };
const inputClass = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:opacity-60 text-sm";
const buttonClass = "rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50";

function draftOf(item: PackageCatalogItem): Draft {
  return { ...item, price: String(item.price), bonusPoints: item.bonusPoints ?? 0 };
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
  const [activeSlot, setActiveSlot] = useState<string>("");
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
    const ranges = [[draft.durationDays, 1, 3660], [draft.friendCoupons, 0, 100], [draft.bonusDays, 0, 365], [draft.bonusPoints, 0, PACKAGE_BONUS_POINTS_MAX]];
    if (ranges.some(([value, min, max]) => !Number.isInteger(value) || value < min || value > max)
      || !draft.name.trim() || !draft.label.trim()
      || !packageCatalogDailySlot(draft.timeSlot)) {
      setMessage("กรุณาตรวจสอบชื่อ ช่วงเวลา จำนวนวัน คูปอง และคะแนนโบนัส");
      return;
    }
    const requestKey = crypto.randomUUID();
    const body = JSON.stringify({
      requestKey, ...(draft.id === 0 ? { action: "create" } : { action: "update", id: draft.id, expectedVersion: draft.version }),
      name: draft.name.trim(), label: draft.label.trim(), durationDays: draft.durationDays,
      timeSlot: draft.timeSlot, price, friendCoupons: draft.friendCoupons,
      bonusDays: draft.bonusDays, bonusPoints: draft.bonusPoints, description: draft.description, isActive: draft.isActive,
    });
    void send({ requestKey, body, id: draft.id });
  }

  function handleAddOrActivateClick() {
    setMessage("");
    setDraft({ id: 0, version: 0, name: "", label: "", description: "", price: "",
      durationDays: 30, timeSlot: selectedSlot || "00:00-24:00", friendCoupons: 0, bonusDays: 0, bonusPoints: 0, isActive: true });
  }

  const disabled = busy || !!pending || loading || needsReload || !!loadError;
  const slots = [...new Set(packages.map(p => p.timeSlot))].sort();
  const selectedSlot = slots.includes(activeSlot) ? activeSlot : "";
  const slotPackages = packages.filter((p) => !selectedSlot || p.timeSlot === selectedSlot);

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6 break-words">
      <header>
        <h1 className="text-2xl font-black text-blu-dark">จัดการแพ็กเกจ</h1>
        <p className="mt-2 text-sm text-slate-600">เพิ่ม แก้ไข และเปิด/ปิดขายแพ็กเกจ ไม่ลบประวัติซื้อ</p>
        <p className="mt-1 text-sm text-slate-600">ราคาใหม่ใช้กับคำสั่งซื้อใหม่ คำสั่งซื้อเก่าที่รอชำระยังคงราคาและสิทธิ์เดิม วันโบนัสเป็นคูปอง ไม่ได้เพิ่มวันสมาชิกอัตโนมัติ</p>
                <p className="mt-1 text-sm text-slate-600">คะแนนโบนัสแพ็กเกจบวกเพิ่มจากคะแนนตามยอดชำระจริง และให้เมื่อยืนยันการชำระสำเร็จ</p>
      </header>

      <label className="block text-sm">กรองช่วงเวลา
        <select aria-label="กรองช่วงเวลา" className={inputClass} value={selectedSlot} onChange={e => setActiveSlot(e.target.value)}>
          <option value="">ทุกช่วงเวลา</option>
          {slots.map(slot => <option key={slot} value={slot}>{slot}</option>)}
        </select>
      </label>

      {message && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">{message}</p>}
      {loadError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{loadError} — กรุณาลองใหม่</p>}

      {pending && (
        <section className="min-w-0 space-y-2 rounded-xl border border-amber-400 bg-amber-50 p-4" aria-label="คำขอที่ยังไม่ทราบผล">
          <p className="text-sm font-semibold">คำขอเดิม: {pending.id === 0 ? "เพิ่มแพ็กเกจใหม่" : `แพ็กเกจ #${pending.id}`}</p>
          <p className="break-all text-xs">UUID: {pending.requestKey}</p>
          <p className="text-sm">เก็บคำขอนี้ในหน้านี้เท่านั้น อย่าปิดหรือรีเฟรชหน้าจนทราบผล</p>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void send(pending)}>{busy ? "กำลังยืนยันผล…" : "ลองคำขอเดิมซ้ำ"}</button>
        </section>
      )}

      {loading && <p role="status" className="text-center text-sm text-slate-500 py-6">กำลังโหลดแพ็กเกจ…</p>}
      {!loading && !loadError && packages.length === 0 && <p className="text-center text-sm text-slate-500 py-6">ไม่พบแพ็กเกจ</p>}

      {/* Cards Grid: Dashed + card first, followed by clean homepage-style package cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 min-w-0">
        {/* First Card: Dashed border with + icon */}
        <button
          type="button"
          disabled={disabled}
          onClick={handleAddOrActivateClick}
          className="relative min-w-0 break-words rounded-2xl border-2 border-dashed border-slate-300 hover:border-blu-slate hover:bg-blu-ice/40 p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-all min-h-[280px] group disabled:opacity-50"
        >
          <div className="w-12 h-12 rounded-full bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center text-slate-500 group-hover:text-blu-slate transition-colors mb-3">
            <svg className="w-6 h-6 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <span className="text-base font-black text-slate-700 group-hover:text-blu-slate tracking-tight">
            เพิ่มแพ็กเกจใหม่
          </span>
          <span className="text-xs text-blu-steel mt-1">
            คลิกเพื่อตั้งค่าและเปิดขาย
          </span>
        </button>

        {/* Package Cards styled identical to Homepage */}
        {slotPackages.map((pkg, index) => {
          const isLast = index === slotPackages.length - 1;
          const isDaily = pkg.durationDays === 1;
          const pricePerDay =
            pkg.durationDays > 1
              ? Math.round(pkg.price / pkg.durationDays)
              : null;

          return (
            <div
              key={pkg.id}
              onClick={() => {
                if (disabled) return;
                setDraft(draftOf(pkg));
                setMessage("");
              }}
              className={`relative min-w-0 break-words bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow flex flex-col justify-between cursor-pointer ${
                !pkg.isActive
                  ? "opacity-60 border border-dashed border-slate-300"
                  : isLast
                    ? "ring-2 ring-blu-yellow"
                    : isDaily
                      ? "ring-1 ring-blu-ocean/40 border border-blu-sky/40"
                      : "ring-2 ring-blu-slate"
              }`}
            >
              {/* Top Badge */}
              <div
                className={`text-center py-1.5 text-xs font-bold tracking-wider uppercase ${
                  !pkg.isActive
                    ? "bg-slate-400 text-white"
                    : isLast
                      ? "bg-blu-yellow text-blu-dark"
                      : isDaily
                        ? "bg-blu-steel text-white"
                        : "bg-blu-slate text-white"
                }`}
              >
                {!pkg.isActive
                  ? "ปิดขาย"
                  : isLast
                    ? "คุ้มที่สุด"
                    : isDaily
                      ? "ทั่วไป"
                      : "ยอดนิยม"}
              </div>

              <div className="p-5 flex flex-col flex-1 justify-between text-center space-y-4">
                {/* 1. Duration & Time Slot */}
                <div>
                  <div className="text-xl font-black text-blu-dark tracking-tight">
                    {pkg.label}
                  </div>
                  <div className="text-xs text-blu-steel font-medium mt-1">
                    {pkg.timeSlot}
                  </div>
                </div>

                {/* 2. Price Section */}
                <div className="py-3.5 px-3 bg-blu-ice/60 rounded-xl border border-blu-sky/40">
                  <div className="text-3xl font-black text-blu-dark tracking-tight">
                    ฿{Math.round(pkg.price).toLocaleString("th-TH")}
                  </div>
                  {pricePerDay ? (
                    <div className="text-[11px] text-blu-steel font-medium mt-1">
                      เฉลี่ยวันละ {pricePerDay} บาท
                    </div>
                  ) : (
                    <div className="text-[11px] text-blu-steel font-medium mt-1">
                      ต่อครั้ง
                    </div>
                  )}
                </div>

                <p className="text-xs text-blu-steel">คะแนนโบนัส {pkg.bonusPoints ?? 0} แต้ม</p>

                {/* 3. Edit Action Button */}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDraft(draftOf(pkg));
                    setMessage("");
                  }}
                  className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer shadow-xs ${
                    !pkg.isActive
                      ? "bg-slate-500 hover:bg-slate-600 text-white"
                      : isLast
                        ? "btn-gold"
                        : isDaily
                          ? "bg-blu-steel hover:bg-blu-slate text-white"
                          : "btn-blue"
                  }`}
                >
                  แก้ไขแพ็กเกจ
                </button>
              </div>
            </div>
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
                  {draft.id === 0 ? "เพิ่มแพ็กเกจใหม่" : `แก้ไขแพ็กเกจ #${draft.id}`}
                </h2>
                <p className="text-xs text-slate-500">{draft.id === 0 ? "รหัสและเวอร์ชันกำหนดโดยเซิร์ฟเวอร์" : `เวอร์ชัน ${draft.version}`}</p>
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
                  <input className={inputClass} value={draft.id || "ระบบกำหนดเมื่อบันทึก"} readOnly />
                </label>
                <label className="min-w-0 text-sm">
                  เวอร์ชัน (แก้ไขไม่ได้)
                  <input className={inputClass} value={draft.version || "รายการใหม่"} readOnly />
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
                  <input required aria-label="ช่วงเวลา" className={inputClass} value={draft.timeSlot}
                    placeholder="00:00-24:00" maxLength={11}
                    onChange={e => setDraft({ ...draft, timeSlot: e.target.value })} />
                  <span className="text-xs text-slate-500">HH:mm-HH:mm ช่วงเดียว ไม่ข้ามคืน (ปิดได้ถึง 24:00)</span>
                </label>
                {([
                  ["durationDays", "จำนวนวัน (1–3660)", 1, 3660],
                  ["friendCoupons", "คูปองพาเพื่อน (0–100)", 0, 100],
                  ["bonusDays", "วันในคูปองโบนัส (0–365)", 0, 365],
                  ["bonusPoints", "คะแนนโบนัสแพ็กเกจ", 0, PACKAGE_BONUS_POINTS_MAX],
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
