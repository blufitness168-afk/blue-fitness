import Link from "next/link";
import type { getAdminDashboard } from "@/lib/admin-members-server";

function date(value: string) {
  return new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
}
export default function DashboardClient({ data }: { data: Awaited<ReturnType<typeof getAdminDashboard>> }) {
  const s = data.summary;
  const cards = [
    ["สมาชิกทั้งหมด ณ ปัจจุบัน", s.totalMembers.toLocaleString("th-TH")],
    ["สมาชิก ACTIVE ที่ยังไม่หมดอายุ ณ ปัจจุบัน", s.activeMembers.toLocaleString("th-TH")],
    ["สมาชิกสมัครใหม่ในเดือนที่เลือก", s.newMembers.toLocaleString("th-TH")],
    ["จำนวนครั้งเช็คอินในเดือนที่เลือก", s.checkins.toLocaleString("th-TH")],
    ["คำสั่งซื้อ PAID ในเดือนที่เลือก", s.paidOrders.toLocaleString("th-TH")],
    ["ยอดแพ็กเกจ PAID ในเดือนที่เลือก", `${(Number(s.paidSatang) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })} ฿`],
  ];
  return <div className="space-y-6">
    <h1 className="text-2xl font-black text-blu-dark">Dashboard</h1>
    <form action="/admin" className="flex flex-wrap items-end gap-3"><label>เดือน (เวลาไทย)<input type="month" name="month" defaultValue={data.month} className="ml-3 rounded-xl border bg-white p-3" /></label><button className="btn-blue rounded-xl px-5 py-3">แสดงข้อมูล</button></form>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value]) => <section key={label} className="rounded-2xl border bg-white p-5"><h2 className="text-sm text-blu-steel">{label}</h2><p className="mt-3 text-2xl font-black">{value}</p></section>)}</div>
    <p className="rounded-xl bg-blu-ice p-4 text-sm">ยอดแพ็กเกจอิง package_payment_orders สถานะ PAID และวันที่ paid_at เท่านั้น ไม่รวมรายการชำระเงินระบบเก่า ไม่ใช่รายได้รวมธุรกิจ และยังไม่มีข้อมูลรายจ่าย/กำไรสุทธิ</p>
    <section className="rounded-2xl border bg-white p-5"><h2 className="mb-4 font-bold">การชำระแพ็กเกจล่าสุดในเดือนที่เลือก (สูงสุด 10 รายการ)</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["สมาชิก", "แพ็กเกจ", "ยอดชำระ", "วันที่ชำระ"].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{data.sales.map(row => <tr key={row.id} className="border-t"><td className="p-3"><Link href={`/admin/members/${encodeURIComponent(row.memberCode)}`} className="underline">{row.fullName}</Link></td><td className="p-3">{row.packageName || "ไม่ระบุชื่อแพ็กเกจ"}</td><td className="p-3">{(row.amountSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })} ฿</td><td className="p-3">{date(row.paidAt)}</td></tr>)}{!data.sales.length && <tr><td colSpan={4} className="p-4">ไม่มีรายการ</td></tr>}</tbody></table></div></section>
    <section className="rounded-2xl border bg-white p-5"><h2 className="mb-4 font-bold">เช็คอินล่าสุดในเดือนที่เลือก (สูงสุด 10 รายการ)</h2>{data.visits.map(row => <p key={row.id} className="border-t py-3"><Link className="underline" href={`/admin/members/${encodeURIComponent(row.memberCode)}`}>{row.fullName}</Link> · {date(row.checkinTime)}</p>)}{!data.visits.length && <p>ไม่มีรายการ</p>}</section>
    <section className="rounded-2xl border bg-white p-5"><h2 className="mb-4 font-bold">สมาชิกที่จะหมดอายุใน 7 วันนับจากปัจจุบัน (สูงสุด 10 รายการ)</h2>{data.expiring.map(row => <p key={row.memberCode} className="border-t py-3"><Link className="underline" href={`/admin/members/${encodeURIComponent(row.memberCode)}`}>{row.fullName}</Link> · {date(row.expireDate)}</p>)}{!data.expiring.length && <p>ไม่มีรายการ</p>}</section>
  </div>;
}
