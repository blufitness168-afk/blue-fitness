"use client";

import { useEffect, useState, type ReactNode } from "react";
import { couponGroups, couponKinds, couponStatuses, type CouponHistoryPage } from "@/lib/r6-coupon-history";

const date = (value: string | null) => value ? new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "ไม่ระบุ";
const control = "rounded border px-2 py-1 disabled:opacity-50";
const options = (labels: Record<string, string>) => Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>);

export default function R6CouponHistory({ staff = false, refresh = 0, fallback, actions }: {
  staff?: boolean; refresh?: number; fallback?: ReactNode; actions?: (row: CouponHistoryPage["rows"][number]) => ReactNode;
}) {
  const [location, setLocation] = useState({ filters: "", cursors: [null] as (number | null)[], attempt: 0 });
  const [response, setResponse] = useState<{ key: string; data?: CouponHistoryPage; error?: string; notInstalled?: boolean }>();
  const { filters, cursors, attempt } = location;
  const before = cursors.at(-1) ?? null;
  const key = `${staff}:${filters}:${before}:${attempt}:${refresh}`;
  const current = response?.key === key ? response : undefined;
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(filters);
    if (before !== null) params.set("before", String(before));
    const endpoint = staff ? "/api/admin/benefits/history" : "/api/member/coupons/history";
    fetch(`${endpoint}?${params}`, { cache: "no-store", signal: controller.signal }).then(async res => {
      const result = await res.json();
      if (controller.signal.aborted) return;
      setResponse(res.ok ? { key, data: result.data } : {
        key, error: result.error || "โหลดประวัติคูปองไม่ได้", notInstalled: res.status === 404 && result.notInstalled === true,
      });
    }).catch(() => { if (!controller.signal.aborted) setResponse({ key, error: "โหลดประวัติคูปองไม่ได้" }); });
    return () => controller.abort();
  }, [before, filters, key, staff]);
  if (current?.notInstalled && fallback) return <>{fallback}</>;
  const page = current?.data;
  return <section className="space-y-3">
    <h2 className="font-bold">ประวัติคูปอง</h2>
    <form className="flex flex-wrap gap-2 items-end" onSubmit={event => {
      event.preventDefault();
      const params = new URLSearchParams();
      for (const [name, value] of new FormData(event.currentTarget)) if (String(value).trim()) params.set(name, String(value).trim());
      setLocation(old => ({ filters: params.toString(), cursors: [null], attempt: old.attempt + 1 }));
    }}>
      {staff && <label>รหัสสมาชิก <input className={control} name="memberCode" placeholder="BLU-123" maxLength={16} /></label>}
      <label>ชื่อ/โค้ดคูปอง <input className={control} name="q" maxLength={120} /></label>
      <label>ประเภท <select className={control} name="kind"><option value="">ทุกประเภท</option>{options(couponKinds)}</select></label>
      <label>สถานะ <select className={control} name="status"><option value="">ทุกสถานะ</option>{options(couponStatuses)}</select></label>
      {staff && <label>กลุ่มแพ็กเกจตอนแจก <select className={control} name="days"><option value="">ทุกกลุ่ม</option>{options(couponGroups)}</select></label>}
      <button className={control}>ค้นหา</button>
      <button type="reset" className={control} onClick={() => setLocation(old => ({ filters: "", cursors: [null], attempt: old.attempt + 1 }))}>ล้างตัวกรอง</button>
    </form>
    {!current && <p role="status">กำลังโหลดประวัติ…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {page?.rows.length === 0 && <p>ไม่พบคูปองตามตัวกรอง</p>}
    {page?.rows.map(row => <article key={row.id} className="rounded border p-3 space-y-1">
      <h3 className="font-bold">#{row.id} {row.title}{row.code && ` · ${row.code}`}</h3>
      {staff && <p>{row.member_code} {row.full_name} · {row.recipient_duration_days ? `${row.recipient_duration_days} วัน` : "ไม่ทราบแพ็กเกจตอนแจก"}</p>}
      <p>{couponKinds[row.kind] ?? row.kind} · {couponStatuses[row.status] ?? row.status} · ใช้ {row.used_count}/{row.total_quota}</p>
      {row.description && <p className="whitespace-pre-wrap break-words">{row.description}</p>}
      <p className="text-sm">ออก {date(row.created_at)} · หมดอายุ {date(row.expire_date)} · ใช้ล่าสุด {date(row.used_at)}</p>
      {row.campaign_expires_at && <p className="text-sm">กำหนดแคมเปญ {date(row.campaign_expires_at)} · {row.activated_at ? `เปิดใช้ ${date(row.activated_at)}` : row.activation_duration_minutes == null ? "ไม่จำกัดเวลาเพิ่มหลังเปิดใช้" : `${row.activation_duration_minutes || 10} นาทีหลังเปิดใช้`}</p>}
      {row.use_times.length > 1 && <details className="text-sm"><summary>เวลาที่ใช้แต่ละครั้ง</summary>
        <ol className="list-decimal ps-5">{row.use_times.map((time, index) => <li key={`${time}:${index}`}>{date(time)}</li>)}</ol>
      </details>}
      {actions?.(row)}
    </article>)}
    <nav aria-label="หน้าประวัติคูปอง" className="flex gap-2">
      <button className={control} disabled={cursors.length < 2} onClick={() => setLocation(old => ({ ...old, cursors: old.cursors.slice(0, -1) }))}>ก่อนหน้า</button>
      <button className={control} disabled={!page?.nextBefore} onClick={() => {
        if (page?.nextBefore) setLocation(old => ({ ...old, cursors: [...old.cursors, page.nextBefore] }));
      }}>ถัดไป</button>
    </nav>
  </section>;
}
