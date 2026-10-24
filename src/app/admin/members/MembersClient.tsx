import Link from "next/link";
import { currentStatus, type getAdminMembers } from "@/lib/admin-members-server";

export default function MembersClient({ data }: { data: Awaited<ReturnType<typeof getAdminMembers>> }) {
  const href = (page: number) => `/admin/members?${new URLSearchParams({ q: data.query, page: String(page) })}`;
  return <div className="space-y-6">
    <h1 className="text-2xl font-black text-blu-dark">สมาชิก</h1>
    <form action="/admin/members" className="flex flex-wrap gap-3">
      <label className="flex-1">ค้นหาชื่อ รหัสสมาชิก หรือเบอร์โทร<input name="q" defaultValue={data.query} maxLength={100} className="mt-2 block w-full rounded-xl border p-3" /></label>
      <button className="btn-blue self-end rounded-xl px-6 py-3">ค้นหา</button>
    </form>
    <p>พบ {data.total.toLocaleString("th-TH")} รายการ · หน้า {data.page} / {data.pages}</p>
    <div className="overflow-x-auto rounded-2xl border bg-white"><table className="w-full text-left text-sm">
      <thead><tr>{["ชื่อ", "รหัสสมาชิก", "โทรศัพท์", "สถานะปัจจุบัน", "หมดอายุ", "บทบาท"].map(label => <th key={label} className="whitespace-nowrap p-4">{label}</th>)}</tr></thead>
      <tbody>{data.members.map(member => <tr key={member.memberCode} className="border-t">
        <td className="p-4"><Link className="font-bold text-blu-slate underline" href={`/admin/members/${encodeURIComponent(member.memberCode)}`}>{member.fullName}</Link></td>
        <td className="p-4 font-mono">{member.memberCode}</td><td className="p-4">{member.phone}</td>
        <td className="p-4">{currentStatus(member, data.asOf)}</td>
        <td className="p-4">{member.expireDate ? new Date(member.expireDate).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" }) : "—"}</td><td className="p-4">{member.role}</td>
      </tr>)}{!data.members.length && <tr><td colSpan={6} className="p-8 text-center">ไม่พบสมาชิก</td></tr>}</tbody>
    </table></div>
    <nav aria-label="หน้ารายชื่อสมาชิก" className="flex gap-5">{data.page > 1 && <Link href={href(data.page - 1)}>← ก่อนหน้า</Link>}{data.page < data.pages && <Link href={href(data.page + 1)}>ถัดไป →</Link>}</nav>
    <p className="text-xs text-blu-steel">ข้อมูลจากฐานข้อมูลจริง · สถานะหมดอายุคำนวณจากวันหมดอายุปัจจุบัน ไม่ใช่สถิติย้อนหลัง</p>
  </div>;
}
