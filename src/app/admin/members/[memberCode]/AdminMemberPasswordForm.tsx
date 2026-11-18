"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function AdminMemberPasswordForm({ memberCode }: { memberCode: string }) {
  const router = useRouter();
  const pending = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const sending = useRef(false);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || done) return;
    if (!pending.current) {
      const fields = new FormData(event.currentTarget);
      const password = String(fields.get("password") ?? "");
      if (password !== fields.get("confirmPassword")) { setMessage("รหัสผ่านไม่ตรงกัน"); return; }
      const reason = String(fields.get("reason") ?? "").trim();
      if (!reason || reason.includes(password)) { setMessage("กรอกเหตุผลโดยไม่ใส่รหัสผ่าน"); return; }
      pending.current = JSON.stringify({ requestKey: crypto.randomUUID(), reason, password });
      setLocked(true);
      form.current?.reset();
    }
    sending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/members/${encodeURIComponent(memberCode)}/password`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: pending.current,
        cache: "no-store", redirect: "error",
      });
      const data: unknown = await response.json();
      if (response.ok && data && typeof data === "object" && "ok" in data && data.ok === true) {
        pending.current = null;
        form.current?.reset();
        setDone(true);
        setMessage("ตั้งรหัสผ่านสำเร็จ และเพิกถอน session / OTP ตั้งรหัสผ่านเดิมแล้ว (หากเป็นการส่งซ้ำ คือผลสำเร็จของคำขอเดิม)");
        router.refresh();
      } else {
        // Only render locally defined messages; never echo arbitrary response data.
        setMessage(response.status === 429 ? "เกินขีดจำกัด กรุณารอแล้วเริ่มใหม่ หรือตรวจผลคำขอเดิม"
          : response.status === 409 ? "คำขอถูกจอง/ขัดแย้ง/หมดอายุ ส่งซ้ำได้เฉพาะ body เดิม; หากไม่สำเร็จให้รอ 2 นาทีแล้วเริ่มใหม่"
          : response.status === 403 || response.status === 401 ? "ไม่มีสิทธิ์ หรือ session เปลี่ยน กรุณาโหลดหน้าใหม่"
          : "ยังยืนยันผลไม่ได้ ส่งคำขอเดิมเพื่อตรวจผล");
      }
    } catch { setMessage("ยังยืนยันผลไม่ได้ ส่งคำขอเดิมเพื่อตรวจผล"); }
    finally { sending.current = false; setBusy(false); }
  }

  return <section className="mt-6 rounded-2xl border border-white/10 p-5">
    <h2 className="text-lg font-bold">ตั้งรหัสผ่านใหม่โดยเจ้าหน้าที่</h2>
    <p className="my-2 text-sm text-gray-400">รหัสผ่าน 10–128 ตัวอักษร ดูรหัสเดิมไม่ได้ เมื่อสำเร็จสมาชิกต้องเข้าสู่ระบบใหม่ ห้ามใส่รหัสผ่านหรือ OTP ในเหตุผล</p>
    <form ref={form} onSubmit={submit} autoComplete="off">
      <fieldset disabled={locked} className="grid gap-3">
        <label>รหัสผ่านใหม่<input className="block w-full rounded border p-2" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /></label>
        <label>ยืนยันรหัสผ่านใหม่<input className="block w-full rounded border p-2" name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /></label>
        <label>เหตุผล<textarea className="block w-full rounded border p-2" name="reason" maxLength={240} required /></label>
      </fieldset>
      <p role="status" className="my-3 text-sm">{message}</p>
      <button className="rounded border px-4 py-2" disabled={busy || done} type="submit">{busy ? "กำลังส่ง…" : locked ? "ตรวจผลด้วยคำขอเดิม" : "ยืนยันตั้งรหัสผ่าน"}</button>
      {locked && <button className="ml-3 rounded border px-4 py-2" type="button" disabled={busy} onClick={() => { pending.current = null; form.current?.reset(); window.location.reload(); }}>ทิ้งคำขอในหน้านี้ / โหลดใหม่</button>}
    </form>
    <p className="mt-2 text-xs text-gray-400">คำขอคง body เดิมในหน่วยความจำของหน้านี้เท่านั้น ไม่บันทึกลง browser storage; การโหลดใหม่ทำให้ตรวจผลด้วย UUID เดิมไม่ได้ และไม่ยกเลิกงานที่ server รับไปแล้ว</p>
  </section>;
}
