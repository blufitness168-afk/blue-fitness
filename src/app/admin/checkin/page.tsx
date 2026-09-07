"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminScanner, { MockNotice, panelClass, inputClass } from "@/components/AdminScanner";
import { bangkokDay, CHECKIN_STORAGE_KEY, createDemoMembers, evaluateCheckin, parseCheckinRecords, type CheckinMember, type CheckinRecord, type CheckinResult } from "@/lib/checkin";

const timeFormat = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", timeStyle: "medium" });
export default function CheckinPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [members, setMembers] = useState<CheckinMember[]>([]);
  const [records, setRecords] = useState<CheckinRecord[]>([]);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const processing = useRef(false);
  const recent = useRef({ code: "", time: 0 });
  useEffect(() => {
    const load = () => {
      try { setRecords(parseCheckinRecords(localStorage.getItem(CHECKIN_STORAGE_KEY))); setError(""); }
      catch { setRecords([]); setError("อ่านประวัติไม่ได้ หยุดรับสแกนเพื่อป้องกันแต้มซ้ำ กรุณาตรวจสอบข้อมูลและพื้นที่จัดเก็บ"); }
    };
    const initial = new Date();
    // Hydrate the shared roster and browser-only history after SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(initial);
    setMembers(createDemoMembers(initial));
    load();
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    const sync = (event: StorageEvent) => { if (event.key === CHECKIN_STORAGE_KEY || event.key === null) load(); };
    window.addEventListener("storage", sync);
    return () => { window.clearInterval(timer); window.removeEventListener("storage", sync); };
  }, []);
  const scan = useCallback(async (code: string, source: CheckinRecord["source"] = "USB_MANUAL") => {
    const normalized = code.trim().toUpperCase();
    if (processing.current || !members.length || error || (recent.current.code === normalized && Date.now() - recent.current.time < 3000)) return;
    recent.current = { code: normalized, time: Date.now() };
    processing.current = true; setBusy(true);
    try {
      if (!navigator.locks?.request) throw new Error("ต้องใช้ Web Locks ผ่าน HTTPS หรือ localhost");
      await navigator.locks.request(CHECKIN_STORAGE_KEY, { mode: "exclusive" }, () => {
        const history = parseCheckinRecords(localStorage.getItem(CHECKIN_STORAGE_KEY));
        const decision = evaluateCheckin(normalized, members, history, new Date(), source, crypto.randomUUID());
        if (decision.record) {
          const updated = [decision.record, ...history];
          localStorage.setItem(CHECKIN_STORAGE_KEY, JSON.stringify(updated));
          setRecords(updated);
        } else setRecords(history);
        setResult(decision);
      });
    } catch (cause) { setResult({ status: "error", title: "ยังไม่ยืนยันการเช็คอิน", message: cause instanceof Error ? cause.message : "อ่านหรือบันทึกไม่ได้" }); }
    finally { processing.current = false; setBusy(false); }
  }, [members, error]);
  const today = now ? records.filter(r => bangkokDay(new Date(r.checkedAt)) === bangkokDay(now)) : [];
  const filtered = today.filter(r => `${r.fullName} ${r.memberCode}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="mx-auto max-w-6xl space-y-6">
    <header><h1 className="text-2xl font-black">เช็คอินสมาชิก</h1><p className="mt-2 text-sm text-blu-steel">รับเฉพาะรหัสสมาชิก / บัตรแข็ง • {now ? timeFormat.format(now) : "--:--:--"} เวลาไทย</p></header>
    <MockNotice />
    <p className="text-sm text-blu-steel">รายชื่อใช้ร่วมกับหน้าแจกสิทธิ์ แต่แพ็กเกจ/วันหมดอายุและแต้มเช็คอินเป็นชุดทดลองแยกจากกระเป๋ารางวัล: BLU-1015 Off-Peak, BLU-1020 หมดอายุ, BLU-1025 รอชำระ</p>
    {error && <p role="alert" className="rounded-xl bg-rose-100 p-4">{error} <button onClick={() => window.location.reload()} className="underline">โหลดใหม่</button></p>}
    <div className="grid gap-4 sm:grid-cols-3">{[["เข้าใช้วันนี้ (ครั้ง)", today.length], ["สมาชิกวันนี้ (คน)", new Set(today.map(r => r.memberCode)).size], ["แต้มวันนี้", today.reduce((sum, r) => sum + r.points, 0)]].map(([label, value]) => <div key={label} className={panelClass}><p className="text-sm">{label}</p><strong className="text-2xl">{value}</strong></div>)}</div>
    <div className="grid gap-5 lg:grid-cols-2"><div className="space-y-4"><AdminScanner label="สแกนเช็คอิน: BLU-… / CARD-… เท่านั้น" disabled={busy || !!error || !now} onScan={scan} />
      <details className={panelClass}><summary>สมาชิกตัวอย่าง</summary>{members.map(m => <button key={m.memberCode} className="block w-full rounded-xl bg-blu-ice p-3 text-left text-sm disabled:opacity-40" disabled={busy || !!error} onClick={() => void scan(m.memberCode)}>{m.fullName} • {m.memberCode} / {m.cardNumber}<span className="block text-xs">{m.packageName}</span></button>)}</details></div>
      <div className="space-y-4"><section aria-live="polite" className={`${panelClass} ${result?.status === "success" ? "!bg-emerald-50" : result?.status === "warning" ? "!bg-orange-50" : result ? "!bg-rose-50" : ""}`}><h2 className="text-xl font-bold">{result?.title ?? "รอสแกนสมาชิก"}</h2><p>{result?.message ?? "ไม่รับรหัสของรางวัล โค้ดส่วนลด หรือคูปองในหน้านี้"}</p>{result?.member && <div><strong>{result.member.fullName}</strong><p>{result.member.memberCode} • {result.member.packageName}</p><p>แต้มเช็คอินทดลอง: {result.member.points + records.filter(r => r.memberCode === result.member?.memberCode).reduce((sum, r) => sum + r.points, 0)}</p></div>}</section>
      <section className={panelClass}><h2 className="font-bold">กติกาเช็คอิน</h2><ul className="space-y-2 text-sm"><li>Off-Peak 07:00–14:00 / All-Day 07:00–22:00</li><li>นอกสิทธิ์: เตือนสีส้ม ไม่บันทึก/ไม่เพิ่มแต้ม</li><li>เข้าใช้ซ้ำได้ รับแต้มสูงสุด +1 ต่อวันตามเวลาไทย</li><li>กันสแกนรหัสเดิมซ้ำ 3 วินาที</li></ul></section></div></div>
    <section className={panelClass}><h2 className="font-bold">ประวัติวันนี้</h2><input className={inputClass} aria-label="ค้นหาประวัติ" placeholder="ค้นหาชื่อ / รหัสสมาชิก" value={search} onChange={e => setSearch(e.target.value)} /><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["เวลาไทย", "สมาชิก", "ช่องทาง", "แต้ม"].map(t => <th key={t} className="p-3">{t}</th>)}</tr></thead><tbody>{filtered.map(r => <tr key={r.id} className="border-t border-blu-sky/30"><td className="p-3">{timeFormat.format(new Date(r.checkedAt))}</td><td className="p-3">{r.fullName}<p className="text-xs">{r.memberCode}</p></td><td className="p-3">{r.source}</td><td className="p-3">+{r.points}</td></tr>)}{!filtered.length && <tr><td colSpan={4} className="p-5 text-center">ไม่มีรายการ</td></tr>}</tbody></table></div></section>
  </div>;
}
