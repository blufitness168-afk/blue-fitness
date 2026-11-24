"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { OwnerSpecialAccessSnapshot } from "@/lib/owner-special-access-server";

function toBangkokLocalInput(iso: string | null): string {
  if (!iso) return "";
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
  return formatted.replace(" ", "T");
}

function thaiDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "ไม่กำหนดวันหมดอายุ";
}

export default function OwnerSpecialAccessForm({
  memberCode,
  snapshot,
}: {
  memberCode: string;
  snapshot: OwnerSpecialAccessSnapshot;
}) {
  const router = useRouter();
  const pending = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  const [slot, setSlot] = useState(snapshot.dailySlot ?? "00:00-24:00");
  const [expiresLocal, setExpiresLocal] = useState(toBangkokLocalInput(snapshot.expiresAt));
  const [noExpiry, setNoExpiry] = useState(snapshot.expiresAt === null);

  async function sendPayload(payload: string, successText: string) {
    inFlight.current = true;
    setLocked(true);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/members/${encodeURIComponent(memberCode)}/special-access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        setMessage(typeof result.error === "string" ? result.error : "ยังยืนยันผลไม่ได้ กรุณาตรวจข้อมูลล่าสุด");
        return;
      }
      setDone(true);
      setMessage(successText);
      router.refresh();
    } catch {
      setMessage("ยังไม่ทราบผล ส่งคำขอเดิมซ้ำได้ หรือโหลดหน้าใหม่เพื่อตรวจสอบ");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function submitSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || done) return;
    if (!pending.current) {
      const fields = new FormData(event.currentTarget);
      let expiresIso: string | null = null;
      if (!noExpiry) {
        const raw = expiresLocal.trim();
        const parsed = new Date(`${raw}+07:00`);
        if (!raw || !Number.isFinite(parsed.getTime())) {
          setMessage("กรุณาระบุวันหมดอายุให้ถูกต้อง หรือติ๊กไม่กำหนดวันหมดอายุ");
          return;
        }
        expiresIso = parsed.toISOString();
      }
      pending.current = JSON.stringify({
        action: "SET",
        requestKey: crypto.randomUUID(),
        expectedVersion: snapshot.version,
        dailySlot: slot.trim(),
        expiresAt: expiresIso,
        note: String(fields.get("note") ?? ""),
        reason: String(fields.get("reason") ?? ""),
      });
    }
    await sendPayload(pending.current, "บันทึกสิทธิ์เข้าใช้พิเศษแล้ว");
  }

  async function revoke() {
    if (inFlight.current || done || !snapshot.active) return;
    const reason = window.prompt("ระบุเหตุผลการยกเลิกสิทธิ์พิเศษ:", "สิ้นสุดสิทธิ์เข้าใช้พิเศษ");
    if (!reason || !reason.trim()) return;
    pending.current = JSON.stringify({
      action: "REVOKE",
      requestKey: crypto.randomUUID(),
      expectedVersion: snapshot.version,
      reason: reason.trim(),
    });
    await sendPayload(pending.current, "ยกเลิกสิทธิ์เข้าใช้พิเศษแล้ว");
  }

  return (
    <section className="mt-6 rounded-2xl border border-blu-sky/50 bg-white p-5" aria-labelledby="owner-special-access-heading">
      <h2 id="owner-special-access-heading" className="font-bold text-blu-dark">สิทธิ์เข้าใช้พิเศษ (OWNER เท่านั้น)</h2>
      <p className="my-2 text-xs text-blu-steel">
        แยกจากระบบแพ็กเกจและการเงิน (0 บาท, ไม่เพิ่มแต้ม, ไม่สร้างรายการบัญชี) สำหรับเทรนเนอร์/พนักงาน หรือผู้ที่เจ้าของอนุมัติเข้ายิมเป็นกรณีพิเศษ
      </p>
      <div className="mb-3 rounded-xl bg-blu-ice p-3 text-sm">
        สถานะปัจจุบัน:{" "}
        {snapshot.active ? (
          <strong className="text-emerald-700">
            เปิดใช้งาน · ช่วงเวลา {snapshot.dailySlot} · {thaiDate(snapshot.expiresAt)} · {snapshot.note}
          </strong>
        ) : (
          <span className="text-blu-steel">ไม่ได้เปิดสิทธิ์พิเศษ</span>
        )}
      </div>
      <form onSubmit={submitSet} className="space-y-3">
        <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-blu-dark">
            ช่วงเวลาเข้าใช้ (เวลาไทย)
            <div className="mt-1 flex gap-2">
              <input
                name="dailySlot"
                required
                maxLength={11}
                placeholder="00:00-24:00"
                value={slot}
                onChange={e => setSlot(e.target.value)}
                className="w-full rounded-lg border bg-white p-2 text-sm font-normal"
              />
              <select
                aria-label="เลือกช่วงเวลาสำเร็จรูป"
                value={["00:00-24:00", "07:00-22:00", "07:00-14:00"].includes(slot) ? slot : ""}
                onChange={e => { if (e.target.value) setSlot(e.target.value); }}
                className="rounded-lg border bg-white p-2 text-xs font-normal"
              >
                <option value="">กำหนดเอง</option>
                <option value="00:00-24:00">00:00-24:00</option>
                <option value="07:00-22:00">07:00-22:00</option>
                <option value="07:00-14:00">07:00-14:00</option>
              </select>
            </div>
          </label>
          <div className="space-y-1 text-sm font-semibold text-blu-dark">
            <label className="block">
              วันหมดอายุ (เวลาไทย)
              <input
                type="datetime-local"
                disabled={noExpiry}
                value={noExpiry ? "" : expiresLocal}
                onChange={e => setExpiresLocal(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-white p-2 text-sm font-normal disabled:bg-slate-100"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-xs font-normal text-blu-steel">
              <input
                type="checkbox"
                checked={noExpiry}
                onChange={e => setNoExpiry(e.target.checked)}
              />
              เว้นว่าง (ไม่กำหนดวันหมดอายุ)
            </label>
          </div>
          <label className="text-sm font-semibold text-blu-dark">
            หมายเหตุสิทธิ์
            <input
              name="note"
              required
              maxLength={240}
              defaultValue={snapshot.note ?? ""}
              placeholder="เช่น เทรนเนอร์ประจำยิม"
              className="mt-1 w-full rounded-lg border bg-white p-2 text-sm font-normal"
            />
          </label>
          <label className="text-sm font-semibold text-blu-dark">
            เหตุผลการอนุมัติ / แก้ไข
            <input
              name="reason"
              required
              maxLength={240}
              placeholder="เช่น อนุมัติสิทธิ์เข้ายิมพนักงานโดย OWNER"
              className="mt-1 w-full rounded-lg border bg-white p-2 text-sm font-normal"
            />
          </label>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy || done} className="rounded-lg bg-blu-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "กำลังบันทึก…" : done ? "บันทึกแล้ว" : locked ? "ส่งคำขอเดิมซ้ำ" : "บันทึกสิทธิ์พิเศษ (OWNER)"}
          </button>
          {snapshot.active && !locked && (
            <button type="button" disabled={busy} onClick={() => void revoke()} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
              ยกเลิกสิทธิ์พิเศษ
            </button>
          )}
          {locked && (
            <button type="button" disabled={busy} onClick={() => window.location.reload()} className="text-sm underline">
              โหลดข้อมูลล่าสุด / เริ่มใหม่
            </button>
          )}
        </div>
        {message && <p role="status" className="text-sm">{message}</p>}
      </form>
    </section>
  );
}
