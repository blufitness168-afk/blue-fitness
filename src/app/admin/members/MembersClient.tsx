import Link from "next/link";
import { currentPackageDurations, currentStatus, memberListCategories, memberListGenders, type getAdminMembers } from "@/lib/admin-members-server";
import MemberRoleAction from "./MemberRoleAction";
import MembersExportButton from "./MembersExportButton";

export default function MembersClient({
  data,
  callerRole,
  categories = {},
}: {
  data: Awaited<ReturnType<typeof getAdminMembers>>;
  callerRole?: string;
  categories?: Record<string, string>;
}) {
  const owner = data.callerRole === "OWNER";
  const { filters } = data;
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  const href = (page: number) => `/admin/members?${new URLSearchParams([...params, ["page", String(page)]])}`;
  const fieldClass = "mt-1 block w-full rounded-xl border p-3";
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-2xl font-black text-blu-dark">สมาชิก</h1>
      <MembersExportButton queryString={params.toString()} />
    </header>
    <form key={params.toString()} action="/admin/members" method="get" className="space-y-4 rounded-2xl border bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {([
          ["q", "ค้นหาชื่อ รหัสสมาชิก หรือเบอร์โทร", 100],
          ["name", "ชื่อ / นามสกุล (ค้นจากชื่อเต็ม)", 100],
          ["code", "รหัสสมาชิก", 50],
          ["phone", "เบอร์โทร", 20],
        ] as const).map(([key, label, limit]) => <label key={key}>{label}<input name={key} defaultValue={filters[key]} maxLength={limit} className={fieldClass} /></label>)}
        <label>เพศ<select name="gender" defaultValue={filters.gender} className={fieldClass}>
          <option value="">ทั้งหมด</option>
          {Object.entries(memberListGenders).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>ประเภทบุคคล<select name="category" defaultValue={filters.category ?? ""} className={fieldClass}>
          <option value="">ทั้งหมด</option>
          {Object.entries(memberListCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 font-bold">วันที่สร้างบัญชีสมาชิก (เวลาไทย)</legend>
        <label>ตั้งแต่<input type="date" name="from" defaultValue={filters.from} className={fieldClass} /></label>
        <label>ถึง (รวมวันสิ้นสุด)<input type="date" name="to" defaultValue={filters.to} className={fieldClass} /></label>
        <label>เดือน<input type="month" name="month" defaultValue={filters.month} className={fieldClass} /></label>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2" aria-describedby="member-current-package-hint">
        <legend className="mb-2 font-bold">แพ็กเกจที่มีสิทธิ์ปัจจุบัน</legend>
        <label>ประเภทตามระยะเวลา<select name="currentDuration" defaultValue={filters.currentDuration} className={fieldClass}>
          <option value="">ทุกระยะเวลา</option>
          {Object.entries(currentPackageDurations).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>ช่วงเวลาตามแพ็กเกจ<input name="currentSlot" placeholder="07:00-14:00" defaultValue={filters.currentSlot} maxLength={11} className={fieldClass} /></label>
        <p id="member-current-package-hint" className="text-xs text-blu-steel sm:col-span-2">ใช้แพ็กเกจหลักที่เริ่มแล้ว ยังไม่หมดอายุ และตรวจสอบได้เท่านั้น ไม่รวมสิทธิ์เสริม การปรับช่วงเวลารายบุคคล หรือประวัติซื้อ</p>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2" aria-describedby="member-purchase-hint">
        <legend className="mb-2 font-bold">แพ็กเกจที่เคยชำระออนไลน์</legend>
        <label>ประเภทตามป้ายแพ็กเกจ<input name="packageLabel" placeholder="เช่น 1 เดือน" defaultValue={filters.packageLabel} maxLength={100} className={fieldClass} /></label>
        <label>ช่วงเวลาตามแพ็กเกจ<input name="slot" placeholder="07:00-14:00" defaultValue={filters.slot} maxLength={11} className={fieldClass} /></label>
        <p id="member-purchase-hint" className="text-xs text-blu-steel sm:col-span-2">กรอกให้ตรงกับที่บันทึกตอนซื้อ จับคู่จากออเดอร์เดียวกัน (รวมที่คืนเงินภายหลัง) ไม่ใช่สิทธิ์ปัจจุบัน</p>
      </fieldset>
      <label className="block max-w-xs">เดือนรายงานวงจรสมาชิก (เวลาไทย)<input type="month" name="reportMonth" defaultValue={filters.reportMonth} className={fieldClass} /></label>
      <p className="text-xs text-blu-steel">เดือนรายงานไม่ใช่เดือนสร้างบัญชีและไม่เปลี่ยนรายชื่อที่ค้นได้</p>
      <div className="flex items-center gap-4">
        <button className="btn-blue rounded-xl px-6 py-3">ค้นหา</button>
        <Link href="/admin/members">ล้างตัวกรอง</Link>
      </div>
    </form>
    {data.invalid && <p role="alert" className="text-red-700">ตัวกรองไม่ถูกต้อง กรุณาตรวจรูปแบบและลำดับวันที่ แล้วค้นหาใหม่</p>}
    {data.currentUnavailable && <p role="alert" className="text-red-700">ยังตรวจสอบแพ็กเกจที่มีสิทธิ์ปัจจุบันไม่ได้ ฐานข้อมูลยังไม่มีตัวอ่านสิทธิ์ที่รองรับ</p>}
    <p>พบ {data.total.toLocaleString("th-TH")} รายการ · หน้า {data.page} / {data.pages}</p>
    {data.monthly.length > 0 && <section aria-labelledby="members-monthly-title" className="rounded-2xl border bg-white p-4">
      <h2 id="members-monthly-title" className="font-bold">จำนวนบัญชีที่สร้างรายเดือนตามตัวกรอง (สูงสุด 12 เดือนที่พบ)</h2>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {data.monthly.map(({ month, total }) => <li key={month}>{month}: {total.toLocaleString("th-TH")} บัญชี</li>)}
      </ul>
    </section>}
    {data.lifecycle && <section aria-labelledby="members-lifecycle-title" className="space-y-2 rounded-2xl border bg-white p-4">
      <h2 id="members-lifecycle-title" className="font-bold">สรุปวงจรสมาชิก · {data.lifecycle.month}</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {["ผู้ซื้อใหม่ (รวมกลับมาซื้อหลังเกิน 90 วัน)", "สมาชิกเดิมต่ออายุ", "พ้นสภาพ (เกิน 30 วันหลังหมดอายุ)"].map(label =>
          <div key={label}><dt>{label}</dt><dd className="font-semibold">ข้อมูลไม่พอ</dd></div>)}
        <div><dt>แพ็กเกจหลักใกล้หมดอายุใน 30 วัน</dt><dd className="font-semibold">{data.lifecycle.nearExpiry === null ? "ไม่พร้อม" : `${data.lifecycle.nearExpiry.toLocaleString("th-TH")} คน`}</dd></div>
      </dl>
      <p className="text-xs text-blu-steel">ยังไม่มีประวัติสิทธิ์ครบพอสำหรับสามกลุ่มแรก จำนวนบัญชีที่สร้างไม่ใช่จำนวนผู้ซื้อใหม่</p>
      {data.lifecycle.nearExpiryAsOf ? <p className="text-xs text-blu-steel">นับคนไม่ซ้ำตามตัวกรอง เฉพาะเทอมหลักที่ยืนยันได้ ณ {new Date(data.lifecycle.nearExpiryAsOf).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} (เวลาไทย) ไม่รวมสิทธิ์ในอนาคตหรือข้อมูลที่พิสูจน์ไม่ได้</p>
        : <p className="text-xs text-blu-steel">ยอดใกล้หมดอายุใช้ได้เฉพาะเดือนปัจจุบันเมื่อฐานข้อมูลมีตัวอ่านสิทธิ์ที่รองรับ ไม่ใช้วันหมดอายุบัญชีเดาย้อนหลัง</p>}
    </section>}
    <div className="overflow-x-auto rounded-2xl border bg-white"><table className="w-full text-left text-sm">
      <thead><tr>{["ชื่อ", "รหัสสมาชิก", "ประเภทบุคคล", "โทรศัพท์", "สถานะปัจจุบัน", "หมดอายุ", "บทบาท", ...(owner ? ["ปรับสิทธิ์"] : [])].map(label => <th key={label} className="whitespace-nowrap p-4">{label}</th>)}</tr></thead>
      <tbody>{data.members.map(member => {
        const categoryKey = (categories[member.memberCode] ?? "MEMBER") as keyof typeof memberListCategories;
        return <tr key={member.memberCode} className="border-t">
        <td className="p-4"><Link className="font-bold text-blu-slate underline" href={`/admin/members/${encodeURIComponent(member.memberCode)}`}>{member.fullName}</Link></td>
        <td className="p-4 font-mono">{member.memberCode}</td>
        <td className="p-4">{memberListCategories[categoryKey] ?? "สมาชิก"}</td>
        <td className="p-4">{member.phone}</td>
        <td className="p-4">{currentStatus(member, data.asOf)}</td>
        <td className="p-4">{member.expireDate ? new Date(member.expireDate).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" }) : "—"}</td>
        <td className="p-4">{member.role}</td>
        {owner && <td className="p-4 whitespace-nowrap"><MemberRoleAction phone={member.phone} currentRole={member.role} callerRole={callerRole === "OWNER" ? data.callerRole : undefined} /></td>}
      </tr>;
      })}{!data.members.length && <tr><td colSpan={owner ? 8 : 7} className="p-8 text-center">ไม่พบสมาชิก</td></tr>}</tbody>
    </table></div>
    <nav aria-label="หน้ารายชื่อสมาชิก" className="flex gap-5">{data.page > 1 && <Link href={href(data.page - 1)}>← ก่อนหน้า</Link>}{data.page < data.pages && <Link href={href(data.page + 1)}>ถัดไป →</Link>}</nav>
    <p className="text-xs text-blu-steel">ข้อมูลจากฐานข้อมูลจริง · สถานะหมดอายุคำนวณจากวันหมดอายุปัจจุบัน ไม่ใช่สถิติย้อนหลัง</p>
  </div>;
}
