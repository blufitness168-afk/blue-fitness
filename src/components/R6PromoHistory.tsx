"use client";

import { useEffect, useState, type ReactNode } from "react";
import { couponGroups } from "@/lib/r6-coupon-history";
import { promoStatuses, type PromoHistoryPage } from "@/lib/r6-promo-history";

const date = (value: string) => new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
const baht = (satang: number) => `${(satang / 100).toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
const control = "rounded border px-2 py-1 disabled:opacity-50";

export default function R6PromoHistory({ staff = false, refresh = 0, fallback, actions }: {
  staff?: boolean; refresh?: number; fallback?: ReactNode; actions?: (row: PromoHistoryPage["rows"][number]) => ReactNode;
}) {
  const [location, setLocation] = useState({ filters: "", cursors: [null] as (number | null)[], attempt: 0 });
  const [response, setResponse] = useState<{ key: string; data?: PromoHistoryPage; error?: string; notInstalled?: boolean }>();
  const { filters, cursors, attempt } = location;
  const before = cursors.at(-1) ?? null;
  const key = `${staff}:${filters}:${before}:${attempt}:${refresh}`;
  const current = response?.key === key ? response : undefined;
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(filters);
    if (before !== null) params.set("before", String(before));
    fetch(`/api/${staff ? "admin" : "member"}/promo-codes/history?${params}`, { cache: "no-store", signal: controller.signal }).then(async res => {
      const result = await res.json();
      if (!controller.signal.aborted) setResponse(res.ok ? { key, data: result.data } : {
        key, error: result.error || "โหลดประวัติโปรโมโค้ดไม่ได้", notInstalled: res.status === 404 && result.notInstalled === true,
      });
    }).catch(() => { if (!controller.signal.aborted) setResponse({ key, error: "โหลดประวัติโปรโมโค้ดไม่ได้" }); });
    return () => controller.abort();
  }, [before, filters, key, staff]);
  if (current?.notInstalled && fallback) return <>{fallback}</>;
  const page = current?.data;
  return <section className="space-y-3">
    <h2 className="font-bold">{staff ? "ประวัติมอบหมายและใช้โปรโมโค้ด" : "โปรโมโค้ดของฉัน"}</h2>
    {!staff && <p className="text-sm">กรอกโค้ดในหน้าซื้อแพ็กเกจ ระบบจะตรวจเงื่อนไขและโควตาก่อนสร้างคำสั่งซื้อ</p>}
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault();
      const params = new URLSearchParams();
      for (const [name, value] of new FormData(event.currentTarget)) if (String(value).trim()) params.set(name, String(value).trim());
      setLocation(old => ({ filters: params.toString(), cursors: [null], attempt: old.attempt + 1 }));
    }}>
      {staff && <label>รหัสสมาชิก <input className={control} name="memberCode" placeholder="BLU-123" maxLength={16} /></label>}
      <label>ชื่อโปร <input className={control} name="name" maxLength={120} /></label>
      <label>โค้ดส่วนลด <input className={control} name="code" maxLength={40} /></label>
      <label>สถานะ <select className={control} name="status"><option value="">ทุกสถานะ</option>{Object.entries(promoStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>กลุ่มแพ็กเกจตอนแจก <select className={control} name="days"><option value="">ทุกกลุ่ม</option>{Object.entries(couponGroups).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className={control}>ค้นหา</button>
      <button type="reset" className={control} onClick={() => setLocation(old => ({ filters: "", cursors: [null], attempt: old.attempt + 1 }))}>ล้างตัวกรอง</button>
    </form>
    {!current && <p role="status">กำลังโหลดโปรโมโค้ด…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {page?.rows.length === 0 && <p>ไม่พบโปรโมโค้ดตามตัวกรอง</p>}
    {page?.rows.map(row => <article key={row.id} className="space-y-1 rounded border p-3">
      <h3 className="font-bold">{row.title} · <code className="select-all">{row.code}</code></h3>
      <p>{row.full_name} · {row.member_code} · {row.recipient_duration_days == null ? "ไม่ทราบแพ็กเกจตอนแจก" : `${row.recipient_duration_days} วันตอนแจก`}</p>
      <p>ลด {row.discount_type === "PERCENT" ? `${row.discount_value}%` : baht(row.discount_value)}{row.max_discount_satang != null && ` · ลดสูงสุด ${baht(row.max_discount_satang)}`} · {promoStatuses[row.status]}</p>
      {row.description && <p className="whitespace-pre-wrap break-words">{row.description}</p>}
      <p className="text-sm">ยอดก่อนลด {baht(row.min_satang)} – {row.max_satang == null ? "ไม่จำกัด" : baht(row.max_satang)} · {row.eligible_package_ids ? `เฉพาะแพ็กเกจ ${row.eligible_package_ids.map(id => `#${id}`).join(", ")}` : "ทุกแพ็กเกจที่เปิดขาย"}</p>
      <p className="text-sm">ออก {date(row.issued_at)} · หมดอายุ {date(row.expires_at)}{row.used_at && ` · ยืนยันการใช้ ${date(row.used_at)}`}</p>
      {actions?.(row)}
    </article>)}
    <nav aria-label="หน้าประวัติโปรโมโค้ด" className="flex gap-2">
      <button className={control} disabled={cursors.length < 2} onClick={() => setLocation(old => ({ ...old, cursors: old.cursors.slice(0, -1) }))}>ก่อนหน้า</button>
      <button className={control} disabled={!page?.nextBefore} onClick={() => {
        if (page?.nextBefore) setLocation(old => ({ ...old, cursors: [...old.cursors, page.nextBefore] }));
      }}>ถัดไป</button>
    </nav>
  </section>;
}
