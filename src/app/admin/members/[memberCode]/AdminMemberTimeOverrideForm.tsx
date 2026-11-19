"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { MemberTimeOverride } from "@/lib/member-time-override-server";
import { packageCatalogDailySlot } from "@/lib/package-catalog";

type Props = { memberCode: string; state: MemberTimeOverride };
export default function AdminMemberTimeOverrideForm({ memberCode, state }: Props) {
  return <section aria-label="ช่วงเวลาเข้าใช้เฉพาะสมาชิก">
    <h2 className="font-semibold">ช่วงเวลาเข้าใช้เฉพาะสมาชิก</h2>
    {!state.entitlement ? <p>ไม่พบสิทธิ์แพ็กเกจปัจจุบันที่ยืนยันได้ จึงแก้ช่วงเวลาไม่ได้</p> :
      <OverrideEditor key={`${memberCode}:${state.entitlement.orderId}:${state.version}`} memberCode={memberCode}
        version={state.version} entitlement={state.entitlement} />}
  </section>;
}

function OverrideEditor({ memberCode, version, entitlement }: { memberCode: string; version: number;
  entitlement: NonNullable<MemberTimeOverride["entitlement"]> }) {
  const router = useRouter();
  const pending = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [phase, setPhase] = useState<"edit" | "sending" | "retry" | "refresh">("edit");
  const [message, setMessage] = useState("");

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || phase === "refresh") return;
    if (!pending.current) {
      const fields = new FormData(event.currentTarget);
      const timeSlot = fields.get("action") === "clear" ? null : String(fields.get("timeSlot") ?? "");
      const reason = String(fields.get("reason") ?? "").trim();
      if (!reason || (timeSlot !== null && !packageCatalogDailySlot(timeSlot))) {
        setMessage("ระบุเหตุผลและช่วงเวลา HH:MM-HH:MM ให้ถูกต้อง"); return;
      }
      pending.current = JSON.stringify({ requestKey: crypto.randomUUID(), expectedOrderId: entitlement.orderId,
        expectedVersion: version, timeSlot, reason });
    }
    inFlight.current = true;
    setPhase("sending"); setMessage("");
    try {
      const response = await fetch(`/api/admin/members/${encodeURIComponent(memberCode)}/time-override`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: pending.current,
      });
      const result = await response.json();
      if (response.ok && result.ok === true) {
        setMessage("บันทึกแล้ว กำลังโหลดข้อมูลล่าสุด"); setPhase("refresh"); router.refresh();
      } else if (response.status === 400) {
        pending.current = null; setPhase("edit"); setMessage(result.error ?? "ข้อมูลไม่ถูกต้อง");
      } else {
        setPhase(response.status >= 500 ? "retry" : "refresh");
        setMessage(result.error ?? "ยังยืนยันผลไม่ได้");
      }
    } catch {
      setPhase("retry"); setMessage("ยังไม่ทราบผล ส่งคำขอเดิมซ้ำได้");
    } finally { inFlight.current = false; }
  }

  return <form onSubmit={send} className="space-y-2">
    <p>ช่วงเวลาแพ็กเกจ {entitlement.baseSlot} · ช่วงเวลาเฉพาะ {entitlement.overrideSlot ?? "ไม่ได้กำหนด"}</p>
    <p>ใช้เวลาไทย ไม่รวมเวลาปิด และไม่มีผลต่อวันหมดอายุหรือสิทธิ์เสริม</p>
    <fieldset disabled={phase !== "edit"} className="grid gap-2">
      <label>การเปลี่ยนแปลง <select name="action"><option value="set">กำหนดช่วงเวลา</option>
        {entitlement.overrideSlot && <option value="clear">กลับไปใช้ช่วงเวลาแพ็กเกจ</option>}
      </select></label>
      <label>ช่วงเวลา (HH:MM-HH:MM) <input name="timeSlot" maxLength={11}
        defaultValue={entitlement.overrideSlot ?? entitlement.baseSlot} /></label>
      <label>เหตุผล <input name="reason" required maxLength={240} /></label>
    </fieldset>
    <button type="submit" disabled={phase === "sending" || phase === "refresh"}>
      {phase === "retry" ? "ส่งคำขอเดิมซ้ำ" : "บันทึกช่วงเวลา"}
    </button>
    {(phase === "retry" || phase === "refresh") && <button type="button" onClick={() => window.location.reload()}>โหลดข้อมูลใหม่</button>}
    {message && <p role="status">{message}</p>}
  </form>;
}
