"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ManualVisitForm from "./ManualVisitForm";

type Member = { memberCode: string; fullName: string };
type Visit = Member & { id: number; checkedAt: string; scannerType: string; pointsAwarded: number; notes: string | null; exitedAt: string | null; durationSeconds: number | null; snapshot: { reason: string; usedTimeSlot: string | null; mainTimeSlot: string | null; package: { name?: string } | null; supplement: { timeSlot: string } | null; serviceType?: string } | null };
type Result = { ok: boolean; reason: string; checkinId: number | null; checkedAt: string; member: { name: string } | null };
const reasons: Record<string, string> = { PAID_ENTRY: "เข้าใช้บริการด้วยแพ็กเกจ", FREE_ENTRY: "ใช้สิทธิ์เข้าฟรี", NO_ENTITLEMENT: "ไม่มีสิทธิ์เข้าใช้บริการ", NOT_FOUND: "ไม่พบสมาชิก", SUSPENDED: "สมาชิกถูกระงับ", BOUNCE: "เพิ่งบันทึกการเข้าใช้บริการ กรุณารอสักครู่", CLOSED: "นอกเวลาทำการ", OFF_PEAK: "นอกช่วงเวลาแพ็กเกจ", EXIT: "บันทึกออกแล้ว", NO_OPEN_VISIT: "ไม่มีรายการเข้า R7 ที่ยังไม่ออก", ALREADY_IN: "ยังไม่ได้บันทึกออกจากครั้งก่อน" };
async function api(action: string, body: object) {
  const response = await fetch(`/api/admin/checkin/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "โหลดข้อมูลไม่สำเร็จ"), {
    operationUnavailable: response.status === 422 && data.reason === "OUT_UNSUPPORTED" && data.operationUnavailable === true,
  });
  return data;
}

export default function CheckinPage() {
  const [code, setCode] = useState("");
    const [direction, setDirection] = useState<"IN" | "OUT">("IN");
  const [outSupported, setOutSupported] = useState<boolean | null>(null);
  const [manualSupported, setManualSupported] = useState(false);
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [hourly, setHourly] = useState<{ hour: number; entries: number }[]>([]);
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [records, setRecords] = useState<Visit[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
    const [retryPending, setRetryPending] = useState(false);
  const pending = useRef<{ code: string; direction: "IN" | "OUT"; requestKey: string } | null>(null);
  const processing = useRef(false);
  const historyVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++historyVersion.current;
    try {
      const data = await api("history", { query, page, from: from ? `${from}+07:00` : "", to: to ? `${to}+07:00` : "" });
      if (version === historyVersion.current) {
              setRecords(data.records); setHasMore(data.hasMore); setHourly(data.hourly);
                            setManualSupported(data.manualSupported === true);
              if (typeof data.outSupported === "boolean") {
                setOutSupported(data.outSupported);
                if (!data.outSupported && !pending.current) setDirection("IN");
              }
            }
    } catch (cause) { if (version === historyVersion.current) setError((cause as Error).message); }
  }, [query, page, from, to]);
  useEffect(() => {
      const timer = setTimeout(() => { void load(); }, 0);
      return () => { clearTimeout(timer); };
    }, [load]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (!query.trim()) { setMembers([]); return; }
      void api("members", { query }).then(data => { if (active) setMembers(data.members); }).catch(cause => { if (active) setError(cause.message); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  async function scan() {
    if (processing.current) return;
    const normalized = code.trim().toUpperCase();
    if (!/^(?:BLU-\d{1,12}|CARD-[0-9]{1,95})$/.test(normalized)) { setError("กรุณากรอก BLU-... หรือ CARD-ตามด้วยตัวเลข"); return; }
    // Preserve the key after ambiguous network failures; retry cannot consume a second entitlement.
    if (pending.current && (pending.current.code !== normalized || pending.current.direction !== direction)) { setError("กรุณาลองคำขอเดิมให้สำเร็จก่อนเปลี่ยนสมาชิก"); return; }
    pending.current ??= { code: normalized, direction, requestKey: crypto.randomUUID() };
        setRetryPending(true);
    processing.current = true; setBusy(true); setError(""); setResult(null);
    try {
      const data = await api("scan", pending.current);
      pending.current = null; setRetryPending(false); setResult(data);
      if (typeof data.outSupported === "boolean") setOutSupported(data.outSupported);
      await load();
    } catch (cause) {
      if ((cause as Error & { operationUnavailable?: boolean }).operationUnavailable === true) {
        // Only the server's explicit pre-write unsupported response can release this request.
        pending.current = null; setRetryPending(false); setOutSupported(false); setDirection("IN");
      }
      setError((cause as Error).message);
    }
    finally { processing.current = false; setBusy(false); }
  }
  return <div className="space-y-6 p-6">
    <h1 className="text-2xl font-bold">เช็คอินเข้าใช้บริการ</h1>
    <p>ตรวจสิทธิ์เข้าใช้เดิม ไม่เพิ่มคะแนน ประวัติเก่าไม่มีเวลาออก = ไม่ทราบระยะเวลา</p>
    {outSupported === false && <p role="status">ระบบปัจจุบันรองรับ IN เท่านั้น — ยังไม่เปิด OUT และไม่สร้างเวลาออกย้อนหลัง</p>}
    <form className="flex gap-3" onSubmit={event => { event.preventDefault(); void scan(); }}>
      <select aria-label="เข้าออก" value={direction} disabled={busy || retryPending} onChange={event => setDirection(event.target.value as "IN" | "OUT")}><option value="IN">IN เข้า</option><option value="OUT" disabled={outSupported === false}>OUT ออก{outSupported === false ? " (ยังไม่รองรับ)" : ""}</option></select>
            <input aria-label="รหัสสมาชิก" className="rounded border p-2" value={code} onChange={event => setCode(event.target.value)} placeholder="สแกน BLU-... / CARD-..." disabled={busy} />
      <button className="rounded bg-blue-700 px-4 py-2 text-white" disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก / ลองคำขอเดิม"}</button>
    </form>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {result && <p role="status">{result.member?.name} — {reasons[result.reason] || result.reason}{result.checkinId ? ` (#${result.checkinId})` : ""}</p>}
    {manualSupported && <ManualVisitForm onSaved={load} />}
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">ค้นหาสมาชิก / ประวัติจริง</h2>
      <input aria-label="ค้นหาสมาชิก" className="rounded border p-2" placeholder="ชื่อ รหัส หรือโทรศัพท์ (ค้นหาสมาชิก)" maxLength={100} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />
      <ul>{members.map(member => <li key={member.memberCode}><button className="p-2 underline" disabled={busy} onClick={() => setCode(member.memberCode)}>{member.memberCode} — {member.fullName}</button></li>)}</ul>
      <div className="flex flex-wrap gap-3"><label>ตั้งแต่ (เวลาไทย)<input type="datetime-local" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label><label>ก่อน (เวลาไทย)<input type="datetime-local" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} /></label></div>
            <p className="text-sm">กรองเวลาเข้า: รวมตั้งแต่ ไม่รวมเวลาสิ้นสุด แสดงครั้งละ 50 รายการ เวลาไทย</p>
            <figure><figcaption>จำนวนครั้งเข้ารายชั่วโมง (ไม่ใช่จำนวนคนในยิม) ตาม filter ทุกหน้า</figcaption><div className="flex h-40 items-end gap-1" aria-label="จำนวนครั้งเข้าครบ 24 ชั่วโมง">{hourly.map(item => <div key={item.hour} className="flex min-w-0 flex-1 flex-col items-center text-xs" title={`${item.hour}:00 — ${item.entries} ครั้ง`}><span>{item.entries}</span><div className="w-full bg-blue-600" style={{ height: `${item.entries / Math.max(1, ...hourly.map(h => h.entries)) * 100}px`, minHeight: 1 }} /><span>{item.hour}</span></div>)}</div></figure>
      <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{["เวลาเข้า", "เวลาออก / ระยะเวลา", "แพ็กเกจ / ช่วงเวลา ณ ครั้งบริการ", "สมาชิก", "เครื่องสแกน", "คะแนนจริง", "หมายเหตุ"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead>
        <tbody>{records.map(record => <tr key={record.id}><td className="p-2">{new Date(record.checkedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</td><td className="p-2">{record.exitedAt ? `${new Date(record.exitedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} / ${Math.floor(Number(record.durationSeconds) / 60)} นาที` : "ไม่มีเวลาออก / ไม่ทราบระยะเวลา"}</td><td className="p-2">{record.snapshot ? `${record.snapshot.package?.name || (record.snapshot.reason === "MANUAL_PAIR" ? "ไม่ทราบแพ็กเกจ" : record.snapshot.reason)} / ${record.snapshot.usedTimeSlot || "—"}${record.snapshot.supplement ? ` / สิทธิ์เสริม ${record.snapshot.supplement.timeSlot}` : ""}` : "ข้อมูลเก่า ไม่มี snapshot"}</td><td className="p-2">{record.memberCode} {record.fullName}</td><td className="p-2">{record.snapshot?.reason === "MANUAL_PAIR" ? `บันทึกย้อนหลัง / ${record.snapshot.serviceType}` : record.scannerType}</td><td className="p-2">{record.pointsAwarded}</td><td className="p-2">{record.notes}</td></tr>)}</tbody></table></div>
      {!records.length && <p>ไม่พบประวัติ</p>}
      <div className="flex gap-4"><button disabled={page === 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button><span>หน้า {page}</span><button disabled={!hasMore} onClick={() => setPage(page + 1)}>ถัดไป</button><button onClick={() => void load()}>รีเฟรช</button></div>
    </section>
  </div>;
}
