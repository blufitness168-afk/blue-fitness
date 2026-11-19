"use client";
import { useRef, useState, type FormEvent } from "react";
import type { StaffAvatarSnapshot } from "@/lib/staff-avatar-server";

export function StaffAvatarForm({ memberCode, initial }: { memberCode: string; initial: StaffAvatarSnapshot }) {
  const pending = useRef<FormData | null>(null);
  const [busy, setBusy] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!pending.current) {
      const body = new FormData(event.currentTarget);
      body.set("requestKey", crypto.randomUUID());
      body.set("expectedVersion", String(initial.version));
      pending.current = body;
    }
    setBusy(true); setFrozen(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/members/${encodeURIComponent(memberCode)}/avatar`, { method: "POST", body: pending.current, signal: AbortSignal.timeout(80000) });
      const result = await response.json();
      if (response.ok && result.ok === true) { window.location.reload(); return; }
      setMessage(result.error || "ยังยืนยันผลไม่ได้ ส่งคำขอเดิมซ้ำหรือโหลดใหม่");
    } catch { setMessage("ยังยืนยันผลไม่ได้ รอ 90 วินาที แล้วส่งคำขอเดิมซ้ำหรือโหลดใหม่เพื่อตรวจสอบ"); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-white/10 p-4">
    <h3 className="font-semibold">เปลี่ยนรูปสมาชิกโดยเจ้าหน้าที่</h3>
    <p className="text-sm">JPG / PNG / WebP ไม่เกิน 5MB การกดบันทึกจะส่งรูปไป Cloudinary และอาจใช้โควตาบริการ</p>
    <p className="text-sm">เวอร์ชัน {initial.version} · แหล่งข้อมูล {initial.source === "STAFF_UPLOAD" ? "เจ้าหน้าที่อัปโหลด" : "ข้อมูลเดิม"}</p>
    <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={busy || frozen} className="space-y-3">
        <label className="block">รูปใหม่<input className="block" name="file" type="file" accept="image/jpeg,image/png,image/webp" required /></label>
        <label className="block">เหตุผล<input className="block rounded bg-slate-800 p-2" name="reason" required maxLength={240} /></label>
      </fieldset>
      <button type="submit" disabled={busy} className="rounded bg-blue-700 px-4 py-2 disabled:opacity-40">{busy ? "กำลังบันทึก…" : frozen ? "ส่งคำขอเดิมซ้ำ" : "อัปโหลดและบันทึก"}</button>
      {frozen && <button type="button" disabled={busy} onClick={() => window.location.reload()} className="ml-3 underline">โหลดใหม่เพื่อตรวจสอบ</button>}
      <p role="status" aria-live="polite">{message}</p>
    </form>
  </section>;
}
