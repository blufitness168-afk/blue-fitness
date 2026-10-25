import Link from "next/link";
import { currentStatus, type getAdminMember } from "@/lib/admin-members-server";

function date(value: string | null) {
  return value ? new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "—";
}
function Table({ title, headings, rows }: { title: string; headings: string[]; rows: React.ReactNode[][] }) {
  return <section className="min-w-0 rounded-2xl border bg-white p-5"><h2 className="mb-3 font-bold">{title} (ล่าสุดสูงสุด 100 รายการ)</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{headings.map(h => <th key={h} className="whitespace-nowrap p-3">{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-t">{row.map((cell, j) => <td key={j} className="whitespace-nowrap p-3">{cell}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headings.length} className="p-6 text-center">ยังไม่มีประวัติ</td></tr>}</tbody></table></div></section>;
}
export default function MemberDetailClient({ data }: { data: NonNullable<Awaited<ReturnType<typeof getAdminMember>>> }) {
  const m = data.member;
  const fields = [
    ["รหัสสมาชิก", m.memberCode], ["ชื่อ", m.fullName], ["ชื่อเล่น", m.nickname], ["โทรศัพท์", m.phone],
    ["เพศ", m.gender], ["บทบาท", m.role], ["สถานะปัจจุบัน", currentStatus(m, data.asOf)],
    ["วันสมัคร", date(m.createdAt)], ["วันหมดอายุ", date(m.expireDate)], ["คะแนน", String(m.points)],
    ["วัน/เดือนเกิด", m.birthDay && m.birthMonth ? `${m.birthDay}/${m.birthMonth}` : null],
    ["ผู้ติดต่อฉุกเฉิน", m.emergencyName], ["เบอร์ฉุกเฉิน", m.emergencyPhone], ["ความสัมพันธ์", m.emergencyRelation],
  ];
  return <div className="min-w-0 space-y-6">
    <Link href="/admin/members" className="text-blu-slate underline">← กลับรายชื่อสมาชิก</Link>
    <h1 className="break-words text-2xl font-black">{m.fullName} <span className="text-base text-blu-steel">{m.memberCode}</span></h1>
    <p className="rounded-xl bg-blu-ice p-4 text-sm">ข้อมูลจริงแบบอ่านอย่างเดียว การต่ออายุต้องผ่านขั้นตอนชำระเงินที่ตรวจสอบแล้ว ไม่สามารถกำหนด PAID หรือวันหมดอายุเองได้ การเปลี่ยนเบอร์/รหัสผ่านต้องใช้ขั้นตอนยืนยันตัวตน ไม่รองรับการแก้ไขหรือแจกคูปองจากหน้านี้</p>
    <dl className="grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-blu-steel">{label}</dt><dd className="mt-1 break-words font-semibold">{value || "—"}</dd></div>)}</dl>
    <Table title="คำสั่งซื้อแพ็กเกจ (ไม่รวมระบบชำระเงินเก่า)" headings={["รหัสคำสั่งซื้อ", "แพ็กเกจ", "ยอด", "สถานะ", "สร้างเมื่อ", "ชำระเมื่อ", "หมดอายุหลังชำระ"]} rows={data.orders.map(o => [o.id, o.packageName || "ไม่ระบุชื่อแพ็กเกจ", `${(o.amountSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })} ฿`, o.status, date(o.createdAt), date(o.paidAt), date(o.membershipExpiresAt)])} />
    <Table title="ประวัติเช็คอิน" headings={["วันที่/เวลา (ไทย)", "ช่องทาง"]} rows={data.checkins.map(c => [date(c.checkinTime), c.scannerType])} />
    <Table title="คูปอง" headings={["ชื่อ", "ประเภท", "สถานะปัจจุบัน", "ใช้แล้ว/สิทธิ์ทั้งหมด", "หมดอายุ"]} rows={data.coupons.map(c => [c.title, c.type, c.status === "AVAILABLE" && c.expireDate && Date.parse(c.expireDate) <= data.asOf ? "EXPIRED" : c.status, `${c.usedCount}/${c.totalQuota}`, date(c.expireDate)])} />
  </div>;
}
