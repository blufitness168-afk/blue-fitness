"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { z } from "zod";

const timestamp = z.iso.datetime({ offset: true });
const amount = z.number().int().positive().max(100_000_000);
const points = z.number().int().nonnegative();
const term = { startsAt: timestamp, endsAt: timestamp };
const packageName = z.string().min(1).max(200);
const dailySlot = z.string().min(1);
const offer = z.strictObject({ ...term, source: z.literal("ONLINE_PAID"), orderId: z.uuid(),
  packageId: z.number().int().positive(), catalogVersion: z.number().int().positive(), packageName, dailySlot, amountSatang: amount });
const candidate = z.strictObject({ ...term, saleId: z.uuid(), packageName, amountSatang: amount, pointsToReverse: points });
const transferReply = z.object({ offer: offer.nullable() });
const cancellationReply = z.object({ candidates: z.array(candidate) });
const transferReceipt = z.object({ receipt: z.strictObject({ ...term, source: z.literal("STAFF_TRANSFER"), saleId: z.uuid(),
  amountSatang: amount, dailySlot, pointsEarned: points, occurredAt: timestamp, recordedAt: timestamp }) });
const cancellationReceipt = z.object({ receipt: z.strictObject({ saleId: z.uuid(), source: z.literal("STAFF_TRANSFER_REFUND"),
  status: z.literal("CANCELLED"), cancelledAt: timestamp, refundSatang: amount, pointsReversed: points }) });

type Selection = z.infer<typeof offer> | z.infer<typeof candidate>;
type Props = { memberCode: string } & ({ mode: "transfer"; canBackdate: boolean } | { mode: "cancellation" });

const date = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const baht = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });
const formatDate = (value: string) => date.format(new Date(value));
const formatAmount = (satang: number) => baht.format(satang / 100);
const button = "rounded border px-3 py-2 disabled:opacity-50";

export default function StaffTransferSection(props: Props) {
  const { memberCode, mode } = props;
  const cancellation = mode === "cancellation";
  const url = `/api/admin/members/${encodeURIComponent(memberCode)}/staff-transfer${cancellation ? "/cancellation" : ""}`;
  const router = useRouter();
  const [options, setOptions] = useState<z.infer<typeof candidate>[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const [review, setReview] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(false);
  const pending = useRef<string | null>(null);
  const blocked = useRef(false);

  async function preview() {
    if (active.current || pending.current || blocked.current) return;
    active.current = true;
    setBusy(true);
    setOptions([]);
    setSelected(null);
    setMessage("");
    try {
      const response = await fetch(url, { cache: "no-store", redirect: "error" });
      if (!response.ok) throw Error("Preview unavailable");
      const data: unknown = await response.json();
      if (cancellation) {
        const { candidates } = cancellationReply.parse(data);
        setOptions(candidates);
        if (!candidates.length) setMessage("ไม่พบเทอมโอนที่เข้าเงื่อนไขยกเลิก");
      } else {
        const { offer } = transferReply.parse(data);
        setSelected(offer);
        if (!offer) setMessage("ไม่พบแพ็กเกจที่เข้าเงื่อนไขต่ออายุแบบโอน");
      }
    } catch {
      setMessage("ยังไม่พร้อมตรวจรายการ กรุณาตรวจสิทธิ์หรือเซสชันแล้วลองใหม่");
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || blocked.current || !selected) return;
    const replay = pending.current !== null;
    if (!replay) {
      const fields = new FormData(event.currentTarget);
      const reason = String(fields.get("reason") ?? "").trim();
      if (!reason || reason.length > 240 || reason.includes("\0")) {
        setMessage("กรุณาระบุเหตุผล 1–240 ตัวอักษร");
        return;
      }
      if (fields.get("confirmed") !== "on") {
        setMessage(cancellation ? "กรุณายืนยันว่าได้คืนเงินเต็มจำนวนนอกระบบแล้ว" : "กรุณายืนยันว่าได้รับเงินโอนแล้ว");
        return;
      }
      const localTime = props.mode === "transfer" && props.canBackdate ? String(fields.get("transferAt") ?? "") : "";
      // datetime-local has no zone; this field always represents Thai local time.
      const transferAt = localTime ? `${localTime}:00+07:00` : undefined;
      if (transferAt && !timestamp.safeParse(transferAt).success) {
        setMessage("เวลาโอนย้อนหลังไม่ถูกต้อง");
        return;
      }
      const requestKey = crypto.randomUUID();
      pending.current = JSON.stringify("saleId" in selected
        ? { requestKey, saleId: selected.saleId, reason, confirmedFullExternalRefund: true }
        : { requestKey, offer: selected, reason, confirmedTransfer: true, transferAt });
    }
    active.current = true;
    setBusy(true);
    setMessage("");
    let confirmed = false;
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: pending.current, cache: "no-store", redirect: "error" });
      if (response.ok) {
        const data: unknown = await response.json();
        if ("saleId" in selected) {
          const { receipt } = cancellationReceipt.parse(data);
          if (receipt.saleId !== selected.saleId.toLowerCase() || receipt.refundSatang !== selected.amountSatang
            || receipt.pointsReversed !== selected.pointsToReverse) throw Error("Unexpected cancellation receipt");
          setMessage(`ยกเลิกเทอมแล้ว — เลขรายการ ${receipt.saleId} · บันทึกยอดคืนเงินนอกระบบ ${formatAmount(receipt.refundSatang)} · ถอน ${receipt.pointsReversed} คะแนน`);
        } else {
          const { receipt } = transferReceipt.parse(data);
          if (receipt.amountSatang !== selected.amountSatang || receipt.dailySlot !== selected.dailySlot
            || Date.parse(receipt.startsAt) !== Date.parse(selected.startsAt)
            || Date.parse(receipt.endsAt) !== Date.parse(selected.endsAt)) throw Error("Unexpected transfer receipt");
          setMessage(`บันทึกต่ออายุแบบโอนแล้ว — เลขรายการ ${receipt.saleId} · ${formatAmount(receipt.amountSatang)} · ได้รับ ${receipt.pointsEarned} คะแนน`);
        }
        confirmed = true;
      } else if (response.status === 409 || response.status === 400) {
        // Do not allow a new key after an ambiguous attempt or a rejected refund record.
        if (cancellation || replay) {
          blocked.current = true;
          setReview(true);
          setMessage(cancellation
            ? "ยืนยันการยกเลิกไม่ได้ ให้เจ้าของตรวจสอบรายการ ห้ามคืนเงินซ้ำ"
            : "ยืนยันผลรายการเดิมไม่ได้ ให้เจ้าของตรวจสอบก่อนบันทึกใหม่");
        } else {
          setMessage("บันทึกไม่ได้ กรุณาตรวจข้อมูลและตรวจสิทธิ์ใหม่ก่อนส่งอีกครั้ง");
        }
      } else {
        throw Error("Unconfirmed write");
      }
      pending.current = null;
      setRetry(false);
      setSelected(null);
      setOptions([]);
    } catch {
      setRetry(true);
      setMessage(cancellation
        ? "ยังยืนยันผลไม่ได้ ให้ส่งคำขอเดิมซ้ำจากหน้านี้ ห้ามคืนเงินซ้ำ"
        : "ยังยืนยันผลไม่ได้ ให้ส่งคำขอเดิมซ้ำจากหน้านี้ ห้ามสร้างรายการใหม่");
    } finally {
      active.current = false;
      setBusy(false);
    }
    if (confirmed) router.refresh();
  }

  return <section className="rounded-xl border bg-white p-4">
    <h2 className="font-bold">{cancellation ? "ยกเลิกเทอมต่ออายุแบบโอน" : "บันทึกต่ออายุแบบโอนผ่านเจ้าหน้าที่"}</h2>
    <p className="mb-3 text-sm">{cancellation
      ? "เฉพาะเทอมโอนที่ยังไม่เริ่ม ระบบไม่โอนเงินคืน ให้บันทึกเมื่อคืนเงินเต็มจำนวนนอกระบบแล้วเท่านั้น"
      : "ตรวจแพ็กเกจและยอดจากระบบก่อนบันทึก เฉพาะเงินโอนที่ได้รับแล้ว"}</p>
    <button type="button" className={button} disabled={busy || retry || review} onClick={preview}>
      {cancellation ? "ตรวจเทอมที่ยกเลิกได้" : "ตรวจสิทธิ์ต่ออายุแบบโอน"}
    </button>
    {!selected && options.map(option => <div key={option.saleId} className="mt-3 space-y-1">
      <p>{option.packageName} — {formatDate(option.startsAt)} ถึง {formatDate(option.endsAt)} (เวลาไทย)</p>
      <p>{formatAmount(option.amountSatang)} · ถอน {option.pointsToReverse} คะแนน · เลขรายการ {option.saleId}</p>
      <button type="button" className={button} disabled={busy || retry || review} onClick={() => { setSelected(option); setMessage(""); }}>เลือกเทอมนี้</button>
    </div>)}
    {selected && <form className="mt-3 space-y-2" onSubmit={submit}>
      <p>{selected.packageName} — {formatDate(selected.startsAt)} ถึง {formatDate(selected.endsAt)} (เวลาไทย)</p>
      {"saleId" in selected
        ? <p>ยอดคืนเต็มจำนวน {formatAmount(selected.amountSatang)} · ถอน {selected.pointsToReverse} คะแนน · เลขรายการ {selected.saleId}</p>
        : <p>ยอดโอน {formatAmount(selected.amountSatang)} · ช่วงเข้าใช้ {selected.dailySlot} (เวลาไทย)</p>}
      <fieldset disabled={busy || retry} className="space-y-2">
        <label className="block">เหตุผล <input className="rounded border p-2" name="reason" required maxLength={240} /></label>
        {props.mode === "transfer" && props.canBackdate && <label className="block">
          เวลาโอนย้อนหลัง (เวลาไทย, ไม่บังคับ) <input className="rounded border p-2" type="datetime-local" name="transferAt" />
        </label>}
        <label className="block"><input type="checkbox" name="confirmed" required /> {cancellation
          ? "ยืนยันว่าได้คืนเงินเต็มจำนวนนอกระบบแล้ว" : "ยืนยันว่าได้รับเงินโอนตามยอดนี้แล้ว"}</label>
      </fieldset>
      <button type="submit" className={button} disabled={busy}>{retry ? "ส่งคำขอเดิมซ้ำ" : cancellation ? "บันทึกการยกเลิก" : "บันทึกการต่ออายุ"}</button>{" "}
      <button type="button" className={button} disabled={busy || retry} onClick={() => { setSelected(null); setMessage(""); }}>กลับ</button>
    </form>}
    <p className="mt-2 text-sm" role="status">{message}</p>
  </section>;
}
