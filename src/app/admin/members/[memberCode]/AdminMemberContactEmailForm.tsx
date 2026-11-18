"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { MemberContactEmail } from "@/lib/member-contact-email-server";

export default function AdminMemberContactEmailForm({ memberCode, contact }: { memberCode: string; contact: MemberContactEmail }) {
  const router = useRouter();
  const pending = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || done) return;
    if (!pending.current) {
      const fields = new FormData(event.currentTarget);
      pending.current = JSON.stringify({ requestKey: crypto.randomUUID(), expectedVersion: contact.version,
        email: String(fields.get("email") ?? ""), reason: String(fields.get("reason") ?? "") });
    }
    inFlight.current = true;
    setLocked(true); setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/members/${encodeURIComponent(memberCode)}/contact-email`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: pending.current,
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        setMessage(typeof result.error === "string" ? result.error : "ยังยืนยันผลไม่ได้ กรุณาตรวจข้อมูลล่าสุด");
        return;
      }
      setDone(true); setMessage("บันทึกอีเมลติดต่อแล้ว"); router.refresh();
    } catch { setMessage("ยังไม่ทราบผล ส่งคำขอเดิมซ้ำได้ หรือโหลดหน้าใหม่เพื่อตรวจสอบ"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="mt-6 rounded-2xl border bg-white p-5" aria-labelledby="member-contact-email">
    <h2 id="member-contact-email" className="font-bold">อีเมลติดต่อ (ไม่บังคับ)</h2>
    <p className="my-3 text-sm">ใช้เก็บข้อมูลติดต่อเท่านั้น ไม่ใช้เข้าสู่ระบบ กู้รหัสผ่าน ส่งอีเมล หรือยืนยันความเป็นเจ้าของ เว้นว่างเพื่อล้างค่า ไม่เปลี่ยนข้อมูลโปรไฟล์หรือการเงิน</p>
    <p className="mb-3 text-sm">ปัจจุบัน: {contact.email ?? "ยังไม่ระบุ"}</p>
    <form onSubmit={submit}>
      <fieldset disabled={locked} className="grid gap-3">
        <label>อีเมลติดต่อ<input name="email" type="email" maxLength={254} defaultValue={contact.email ?? ""}
          className="mt-1 w-full rounded-lg border p-2" autoComplete="off" /></label>
        <label>เหตุผลการแก้ไข (ไม่ใส่รหัสผ่านหรือข้อมูลลับ)<textarea name="reason" required maxLength={240}
          className="mt-1 w-full rounded-lg border p-2" /></label>
      </fieldset>
      <div className="mt-4 flex gap-4">
        <button type="submit" disabled={busy || done} className="rounded-lg bg-blu-navy px-4 py-2 text-white disabled:opacity-50">
          {busy ? "กำลังบันทึก…" : done ? "บันทึกแล้ว" : locked ? "ส่งคำขอเดิมซ้ำ" : "บันทึกอีเมลติดต่อ"}
        </button>
        {locked && <button type="button" disabled={busy} onClick={() => window.location.reload()} className="underline">โหลดข้อมูลล่าสุด / เริ่มใหม่</button>}
      </div>
      <p role="status" className="mt-3 text-sm">{message}</p>
    </form>
  </section>;
}
