"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MEMBER_CATEGORY_LABELS, type MemberCategory, type MemberCategorySnapshot } from "@/lib/member-category-server";

export default function AdminMemberCategoryForm({
  memberCode,
  snapshot,
}: {
  memberCode: string;
  snapshot: MemberCategorySnapshot;
}) {
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
      pending.current = JSON.stringify({
        requestKey: crypto.randomUUID(),
        expectedVersion: snapshot.version,
        category: String(fields.get("category") ?? "MEMBER"),
        reason: String(fields.get("reason") ?? ""),
      });
    }
    inFlight.current = true;
    setLocked(true);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/members/${encodeURIComponent(memberCode)}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: pending.current,
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        setMessage(typeof result.error === "string" ? result.error : "ยังยืนยันผลไม่ได้ กรุณาตรวจข้อมูลล่าสุด");
        return;
      }
      setDone(true);
      setMessage("บันทึกประเภทบุคคลแล้ว");
      router.refresh();
    } catch {
      setMessage("ยังไม่ทราบผล ส่งคำขอเดิมซ้ำได้ หรือโหลดหน้าใหม่เพื่อตรวจสอบ");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-blu-sky/40 bg-white p-5" aria-labelledby="member-category-heading">
      <h2 id="member-category-heading" className="font-bold text-blu-dark">ประเภทบุคคล (สมาชิก / เทรนเนอร์ / พนักงาน / อื่น ๆ)</h2>
      <p className="my-2 text-xs text-blu-steel">
        ใช้จัดหมวดหมู่และกรองในหน้ารายชื่อเท่านั้น ไม่เปลี่ยนสิทธิ์เข้าระบบและไม่ให้สิทธิ์เข้ายิม (ปัจจุบัน: {MEMBER_CATEGORY_LABELS[snapshot.category as MemberCategory] ?? snapshot.category})
      </p>
      <form onSubmit={submit} className="space-y-3">
        <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-blu-dark">
            ประเภทบุคคล
            <select name="category" defaultValue={snapshot.category} className="mt-1 w-full rounded-lg border bg-white p-2 text-sm font-normal">
              {Object.entries(MEMBER_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-blu-dark">
            เหตุผลการแก้ไข
            <input name="reason" required maxLength={240} placeholder="เช่น เทรนเนอร์ประจำยิม" className="mt-1 w-full rounded-lg border bg-white p-2 text-sm font-normal" />
          </label>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy || done} className="rounded-lg bg-blu-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "กำลังบันทึก…" : done ? "บันทึกแล้ว" : locked ? "ส่งคำขอเดิมซ้ำ" : "บันทึกประเภทบุคคล"}
          </button>
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
