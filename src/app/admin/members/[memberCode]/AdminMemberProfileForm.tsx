"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AdminMemberProfileSnapshot } from "@/lib/admin-member-profile-server";

type Props = { memberCode: string; snapshot: AdminMemberProfileSnapshot };
export default function AdminMemberProfileForm({ memberCode, snapshot }: Props) {
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
      const text = (key: string) => String(fields.get(key) ?? "").trim();
      pending.current = JSON.stringify({
        requestKey: crypto.randomUUID(), reason: text("reason"), expected: snapshot,
        profile: { fullName: text("fullName"), nickname: text("nickname"), gender: text("gender"),
          birthDay: Number(text("birthDay")), birthMonth: Number(text("birthMonth")),
          emergencyName: text("emergencyName"), emergencyPhone: text("emergencyPhone"), emergencyRelation: text("emergencyRelation") },
      });
    }
    inFlight.current = true;
    setLocked(true); setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/members/${encodeURIComponent(memberCode)}/profile`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: pending.current,
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        setMessage(typeof result.error === "string" ? result.error : "บันทึกไม่สำเร็จ กรุณาโหลดหน้าใหม่");
        return;
      }
      setDone(true); setMessage("บันทึกแล้ว กำลังโหลดข้อมูลล่าสุด");
      router.refresh();
    } catch {
      setMessage("ยังไม่ทราบผลบันทึก กดส่งคำขอเดิมซ้ำได้ (ใช้ UUID และข้อมูลเดิม) หรือโหลดหน้าใหม่เพื่อตรวจสอบ");
    } finally { inFlight.current = false; setBusy(false); }
  }
  const inputClass = "mt-1 w-full rounded-lg border p-2";
  const texts = [
    ["fullName", "ชื่อ–นามสกุล", 100], ["nickname", "ชื่อเล่น", 50],
    ["emergencyName", "ผู้ติดต่อฉุกเฉิน", 100], ["emergencyPhone", "เบอร์ฉุกเฉิน", 20],
    ["emergencyRelation", "ความสัมพันธ์", 50],
  ] as const;
  return <section className="mt-6 rounded-2xl border bg-white p-5" aria-labelledby="edit-member-profile">
    <h2 id="edit-member-profile" className="font-bold">แก้ไขข้อมูลโปรไฟล์ {memberCode}</h2>
    <p className="my-3 text-sm">ฟอร์มนี้แก้เฉพาะชื่อ ชื่อเล่น เพศ วัน/เดือนเกิด และผู้ติดต่อฉุกเฉิน พร้อมบันทึกเหตุผล ไม่เปลี่ยนเบอร์สมาชิก สิทธิ์ หรือข้อมูลการเงิน</p>
    <form onSubmit={submit}>
      <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
        {texts.map(([key, label, max]) => <label key={key} className="text-sm">{label}
          <input name={key} defaultValue={snapshot[key] ?? ""} maxLength={max} minLength={key === "fullName" ? 2 : undefined}
            required={key === "fullName"} type={key === "emergencyPhone" ? "tel" : "text"}
            pattern={key === "emergencyPhone" ? "0[0-9]{8,9}" : undefined} className={inputClass} />
        </label>)}
        <label className="text-sm">เพศ<select name="gender" defaultValue={snapshot.gender} className={inputClass} required>
          <option value="MALE">ชาย</option><option value="FEMALE">หญิง</option><option value="OTHER">อื่น ๆ</option>
        </select></label>
        <label className="text-sm">วันเกิด (ไม่เก็บปี)<input name="birthDay" type="number" min={1} max={31} step={1}
          defaultValue={snapshot.birthDay ?? ""} required className={inputClass} /></label>
        <label className="text-sm">เดือนเกิด<input name="birthMonth" type="number" min={1} max={12} step={1}
          defaultValue={snapshot.birthMonth ?? ""} required className={inputClass} /></label>
        <label className="text-sm sm:col-span-2">เหตุผลการแก้ไข (ไม่ใส่รหัสผ่านหรือข้อมูลลับ)
          <textarea name="reason" required maxLength={240} className={inputClass} />
        </label>
      </fieldset>
      <div className="mt-4 flex flex-wrap gap-4">
        <button type="submit" disabled={busy || done} className="rounded-lg bg-blu-navy px-4 py-2 text-white disabled:opacity-50">
          {busy ? "กำลังบันทึก…" : done ? "บันทึกแล้ว" : locked ? "ส่งคำขอเดิมซ้ำ" : "บันทึกโปรไฟล์"}
        </button>
        {locked && <button type="button" disabled={busy} onClick={() => window.location.reload()} className="underline">โหลดข้อมูลล่าสุด / เริ่มแก้ใหม่</button>}
      </div>
      <p role="status" className="mt-3 text-sm">{message}</p>
    </form>
  </section>;
}
