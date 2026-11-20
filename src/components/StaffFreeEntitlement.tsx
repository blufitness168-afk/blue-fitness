import type { StaffFreeDisplayTerm } from "@/lib/staff-free-display-server";

const labels = {
  SCHEDULED: ["กำหนดไว้ — ยังไม่เริ่ม", "Scheduled — not started"],
  ACTIVE: ["อยู่ในช่วงสิทธิ์", "Active term"],
  BLOCKED: ["ถูกระงับการใช้สิทธิ์ช่วงนี้", "Blocked for this term"],
  SUPERSEDED: ["รายการออนไลน์มีผลแทนสิทธิ์นี้", "Superseded by an online purchase"],
} as const;

export default function StaffFreeEntitlement({ terms, isEn = false }: { terms: StaffFreeDisplayTerm[]; isEn?: boolean }) {
  if (!terms.length) return null;
  const date = new Intl.DateTimeFormat(isEn ? "en-US" : "th-TH", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok",
  });
  return <section className="rounded-2xl border border-blu-sky/40 bg-white p-5">
    <h2 className="font-bold">{terms.some(term => term.source === "STAFF_TRANSFER")
      ? (isEn ? "Staff-issued transfer renewal" : "สิทธิ์ต่ออายุแบบโอนผ่านเจ้าหน้าที่")
      : (isEn ? "Staff-issued free extension" : "สิทธิ์ต่ออายุฟรีโดยเจ้าหน้าที่")}</h2>
    <ul className="mt-2 divide-y text-sm">
      {terms.map((term, index) => <li key={`${term.startsAt}:${index}`} className="space-y-1 py-3">
        <p className="break-words font-semibold">{term.packageName} · {labels[term.status][isEn ? 1 : 0]}</p>
        <p>{isEn ? "Term starts: " : "เริ่มสิทธิ์: "}<time dateTime={term.startsAt}>{date.format(new Date(term.startsAt))}</time></p>
        <p>{isEn ? "Term ends: " : "สิ้นสุดสิทธิ์: "}<time dateTime={term.endsAt}>{date.format(new Date(term.endsAt))}</time></p>
        <p>{isEn ? "Recorded daily slot (Bangkok): " : "ช่วงเวลาที่บันทึกไว้ (เวลาไทย): "}{term.dailySlot}</p>
      </li>)}
    </ul>
    <p className="text-sm text-blu-slate">{isEn
      ? "Shown as of page load. Entry is verified at check-in."
      : "ข้อมูล ณ ตอนโหลดหน้า ระบบจะตรวจสิทธิ์เข้าใช้ตอนเช็กอิน"}</p>
  </section>;
}
