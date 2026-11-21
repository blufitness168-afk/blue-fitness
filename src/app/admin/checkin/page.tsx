"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import AdminDashboardChart, { type ChartDatum, type ChartSeries } from "@/components/AdminDashboardCharts";
import ManualVisitForm from "./ManualVisitForm";

type Member = { memberCode: string; fullName: string };
type Visit = Member & { id: number; checkedAt: string; scannerType: string; pointsAwarded: number; notes: string | null; exitedAt: string | null; durationSeconds: number | null; snapshot: { reason: string; usedTimeSlot: string | null; mainTimeSlot: string | null; package: { name?: string } | null; supplement: { timeSlot: string } | null; serviceType?: string; packageSource?: string; staffSaleId?: string | null } | null };
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

const hourlySeries: ChartSeries[] = [
  { key: "entries", label: "จำนวนครั้งเข้า", color: "#2563eb" },
];

export default function CheckinPage() {
  const [code, setCode] = useState("");
    const [direction, setDirection] = useState<"IN" | "OUT">("IN");
  const [outSupported, setOutSupported] = useState<boolean | null>(null);
  const [manualSupported, setManualSupported] = useState(false);
  const [manualStaffSupported, setManualStaffSupported] = useState(false);
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
  const [exporting, setExporting] = useState(false);
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
              setManualStaffSupported(data.manualStaffSupported === true);
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
  const exportXlsx = async () => {
    if (exporting) return;
    setExporting(true);
    setError("");
    try {
      const search = new URLSearchParams();
      if (query) search.set("query", query);
      if (from) search.set("from", `${from}+07:00`);
      if (to) search.set("to", `${to}+07:00`);
      const response = await fetch(`/api/admin/checkin/export?${search.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "ส่งออกไม่สำเร็จ");
      }
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "checkins.xlsx";
      const url = URL.createObjectURL(await response.blob());
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ส่งออกไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  };
  const hourlyMap = new Map(hourly.map((item) => [Number(item.hour), Number(item.entries)]));
  const hourlyChartData: ChartDatum[] = Array.from({ length: 24 }, (_, hour) => ({
    label: `${String(hour).padStart(2, "0")}:00`,
    values: { entries: hourlyMap.get(hour) ?? 0 },
  }));
  return <div className="space-y-6 p-4 sm:p-6">
    <div>
      <h1 className="text-2xl font-black text-blu-dark">เช็คอินเข้าใช้บริการ</h1>
      <p className="mt-1 text-xs text-blu-steel">ตรวจสิทธิ์เข้าใช้เดิม ไม่เพิ่มคะแนน ประวัติเก่าไม่มีเวลาออก = ไม่ทราบระยะเวลา</p>
    </div>
    {outSupported === false && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">ระบบปัจจุบันรองรับ IN เท่านั้น — ยังไม่เปิด OUT และไม่สร้างเวลาออกย้อนหลัง</p>}
    <form className="flex flex-wrap items-center gap-3 rounded-2xl border border-blu-sky/40 bg-white p-4 shadow-sm" onSubmit={event => { event.preventDefault(); void scan(); }}>
      <select aria-label="เข้าออก" className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-blu-dark" value={direction} disabled={busy || retryPending} onChange={event => setDirection(event.target.value as "IN" | "OUT")}><option value="IN">IN เข้า</option><option value="OUT" disabled={outSupported === false}>OUT ออก{outSupported === false ? " (ยังไม่รองรับ)" : ""}</option></select>
      <input aria-label="รหัสสมาชิก" className="min-w-56 flex-1 rounded-xl border bg-white px-3 py-2 text-sm sm:flex-initial" value={code} onChange={event => setCode(event.target.value)} placeholder="สแกน BLU-... / CARD-..." disabled={busy} />
      <button className="btn-blue rounded-xl px-5 py-2.5 text-sm disabled:opacity-50" disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก / ลองคำขอเดิม"}</button>
    </form>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-600">{error}</p>}
    {result && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{result.member?.name} — {reasons[result.reason] || result.reason}{result.checkinId ? ` (#${result.checkinId})` : ""}</p>}
    {manualSupported && <ManualVisitForm staffSupported={manualStaffSupported} onSaved={load} />}
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black text-blu-dark">ค้นหาสมาชิก / ประวัติจริง</h2>
        <button
          type="button"
          onClick={() => void exportXlsx()}
          disabled={exporting}
          className="btn-blue inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {exporting ? "กำลังส่งออก…" : "Export .xlsx"}
        </button>
      </div>
      <div className="space-y-3 rounded-2xl border border-blu-sky/40 bg-white p-4 shadow-sm">
        <input aria-label="ค้นหาสมาชิก" className="w-full max-w-md rounded-xl border bg-white px-3 py-2 text-sm" placeholder="ชื่อ รหัส หรือโทรศัพท์ (ค้นหาสมาชิก)" maxLength={100} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />
        {members.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {members.map(member => (
              <li key={member.memberCode}>
                <button type="button" className="rounded-lg border border-blu-sky/50 bg-blu-ice/60 px-3 py-1.5 text-xs font-semibold text-blu-dark hover:bg-blu-ice" disabled={busy} onClick={() => setCode(member.memberCode)}>
                  {member.memberCode} — {member.fullName}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-blu-dark">
          <label className="flex items-center gap-2">ตั้งแต่ (เวลาไทย)<input type="datetime-local" className="rounded-xl border bg-white px-3 py-2 text-sm font-normal" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label>
          <label className="flex items-center gap-2">ก่อน (เวลาไทย)<input type="datetime-local" className="rounded-xl border bg-white px-3 py-2 text-sm font-normal" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} /></label>
        </div>
        <p className="text-xs text-blu-steel">กรองเวลาเข้า: รวมตั้งแต่ ไม่รวมเวลาสิ้นสุด แสดงครั้งละ 50 รายการ เวลาไทย</p>
      </div>
      <AdminDashboardChart
        title="จำนวนครั้งเข้าใช้บริการรายชั่วโมง (24 ชั่วโมง)"
        subtitle="นับจำนวนครั้งการเข้า (ไม่ใช่จำนวนคนอยู่ในยิมแบบเรียลไทม์) รวมทุกหน้าตามตัวกรองปัจจุบัน"
        data={hourlyChartData}
        series={hourlySeries}
        type="line"
        valueFormatter={(value) => value.toLocaleString("th-TH")}
      />
      <div className="overflow-x-auto rounded-2xl border border-blu-sky/40 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-blu-sky/40 bg-blu-ice/70 text-xs font-bold text-blu-dark">
            <tr>
              {["เวลาเข้า", "เวลาออก / ระยะเวลา", "แพ็กเกจ / ช่วงเวลา ณ ครั้งบริการ", "สมาชิก", "เครื่องสแกน", "คะแนนจริง", "หมายเหตุ"].map(label => (
                <th className="whitespace-nowrap px-4 py-3" key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-blu-sky/30">
            {records.map(record => (
              <tr key={record.id} className="hover:bg-blu-ice/30">
                <td className="whitespace-nowrap px-4 py-3 align-top">{new Date(record.checkedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</td>
                <td className="px-4 py-3 align-top">{record.exitedAt ? `${new Date(record.exitedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} / ${Math.floor(Number(record.durationSeconds) / 60)} นาที` : "ไม่มีเวลาออก / ไม่ทราบระยะเวลา"}</td>
                <td className="px-4 py-3 align-top">{record.snapshot ? `${record.snapshot.package?.name || (record.snapshot.reason === "MANUAL_PAIR" ? "ไม่ทราบแพ็กเกจ" : record.snapshot.reason)} / ${record.snapshot.usedTimeSlot || "—"}${record.snapshot.supplement ? ` / สิทธิ์เสริม ${record.snapshot.supplement.timeSlot}` : ""}` : "ข้อมูลเก่า ไม่มี snapshot"}{record.snapshot?.reason === "MANUAL_PAIR" && record.snapshot.staffSaleId && <div className="mt-1 break-all text-xs text-blu-steel">{record.snapshot.packageSource === "STAFF_TRANSFER" ? "รายการขายโอนโดยพนักงาน" : "รายการฟรีโดยพนักงาน"}{manualStaffSupported && ` · ${record.snapshot.staffSaleId}`}</div>}</td>
                <td className="px-4 py-3 align-top"><span className="font-mono font-semibold text-blu-dark">{record.memberCode}</span> {record.fullName}</td>
                <td className="whitespace-nowrap px-4 py-3 align-top">{record.snapshot?.reason === "MANUAL_PAIR" ? `บันทึกย้อนหลัง / ${record.snapshot.serviceType}` : record.scannerType}</td>
                <td className="whitespace-nowrap px-4 py-3 align-top">{record.pointsAwarded}</td>
                <td className="px-4 py-3 align-top text-xs text-blu-steel">{record.notes}</td>
              </tr>
            ))}
            {!records.length && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-blu-steel">ไม่พบประวัติ</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="rounded-xl border border-blu-sky/50 bg-white px-4 py-2 text-xs font-semibold hover:bg-blu-ice disabled:opacity-40" disabled={page === 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
        <span className="text-xs font-semibold text-blu-dark">หน้า {page}</span>
        <button type="button" className="rounded-xl border border-blu-sky/50 bg-white px-4 py-2 text-xs font-semibold hover:bg-blu-ice disabled:opacity-40" disabled={!hasMore} onClick={() => setPage(page + 1)}>ถัดไป</button>
        <button type="button" className="rounded-xl border border-blu-sky/50 bg-white px-4 py-2 text-xs font-semibold hover:bg-blu-ice" onClick={() => void load()}>รีเฟรช</button>
      </div>
    </section>
  </div>;
}
