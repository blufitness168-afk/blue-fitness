"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Member = { memberCode: string; fullName: string };
type Visit = Member & { id: number; checkedAt: string; scannerType: string; pointsAwarded: number; notes: string | null };
type Result = { ok: boolean; reason: string; checkinId: number | null; checkedAt: string; member: { name: string } | null };
const reasons: Record<string, string> = { PAID_ENTRY: "เข้าใช้บริการด้วยแพ็กเกจ", FREE_ENTRY: "ใช้สิทธิ์เข้าฟรี", NO_ENTITLEMENT: "ไม่มีสิทธิ์เข้าใช้บริการ", NOT_FOUND: "ไม่พบสมาชิก", SUSPENDED: "สมาชิกถูกระงับ", BOUNCE: "เพิ่งบันทึกการเข้าใช้บริการ กรุณารอสักครู่", CLOSED: "นอกเวลาทำการ", OFF_PEAK: "นอกช่วงเวลาแพ็กเกจ" };
async function api(action: string, body: object) {
  const response = await fetch(`/api/admin/checkin/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "โหลดข้อมูลไม่สำเร็จ");
  return data;
}

export default function CheckinPage() {
  const [code, setCode] = useState("");
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [records, setRecords] = useState<Visit[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ code: string; requestKey: string } | null>(null);
  const processing = useRef(false);
  const historyVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++historyVersion.current;
    try {
      const data = await api("history", { query, page });
      if (version === historyVersion.current) { setRecords(data.records); setHasMore(data.hasMore); }
    } catch (cause) { if (version === historyVersion.current) setError((cause as Error).message); }
  }, [query, page]);
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
    if (!/^BLU-\d{1,12}$/.test(normalized)) { setError("กรุณากรอกรหัสสมาชิก BLU-..."); return; }
    // Preserve the key after ambiguous network failures; retry cannot consume a second entitlement.
    if (pending.current && pending.current.code !== normalized) { setError("กรุณาลองคำขอเดิมให้สำเร็จก่อนเปลี่ยนสมาชิก"); return; }
    pending.current ??= { code: normalized, requestKey: crypto.randomUUID() };
    processing.current = true; setBusy(true); setError(""); setResult(null);
    try {
      const data = await api("scan", pending.current);
      pending.current = null; setResult(data); await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { processing.current = false; setBusy(false); }
  }
  return <div className="space-y-6 p-6">
    <h1 className="text-2xl font-bold">เช็คอินเข้าใช้บริการ</h1>
    <p>บันทึกเข้าเท่านั้น ตรวจสิทธิ์จากฐานข้อมูลจริง ไม่เพิ่มคะแนน</p>
    <form className="flex gap-3" onSubmit={event => { event.preventDefault(); void scan(); }}>
      <input aria-label="รหัสสมาชิก" className="rounded border p-2" value={code} onChange={event => setCode(event.target.value)} placeholder="สแกนหรือกรอก BLU-..." disabled={busy} />
      <button className="rounded bg-blue-700 px-4 py-2 text-white" disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึกเข้า / ลองคำขอเดิม"}</button>
    </form>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {result && <p role="status">{result.member?.name} — {reasons[result.reason] || result.reason}{result.checkinId ? ` (#${result.checkinId})` : ""}</p>}
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">ค้นหาสมาชิก / ประวัติจริง</h2>
      <input aria-label="ค้นหาสมาชิก" className="rounded border p-2" placeholder="ชื่อ รหัส หรือโทรศัพท์ (ค้นหาสมาชิก)" maxLength={100} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />
      <ul>{members.map(member => <li key={member.memberCode}><button className="p-2 underline" disabled={busy} onClick={() => setCode(member.memberCode)}>{member.memberCode} — {member.fullName}</button></li>)}</ul>
      <p className="text-sm">ประวัติค้นด้วยชื่อหรือรหัสสมาชิก แสดงครั้งละ 50 รายการ เวลาไทย</p>
      <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{["เวลา", "สมาชิก", "เครื่องสแกน", "คะแนนจริง", "หมายเหตุ"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead>
        <tbody>{records.map(record => <tr key={record.id}><td className="p-2">{new Date(record.checkedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</td><td className="p-2">{record.memberCode} {record.fullName}</td><td className="p-2">{record.scannerType}</td><td className="p-2">{record.pointsAwarded}</td><td className="p-2">{record.notes}</td></tr>)}</tbody></table></div>
      {!records.length && <p>ไม่พบประวัติ</p>}
      <div className="flex gap-4"><button disabled={page === 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button><span>หน้า {page}</span><button disabled={!hasMore} onClick={() => setPage(page + 1)}>ถัดไป</button><button onClick={() => void load()}>รีเฟรช</button></div>
    </section>
  </div>;
}
