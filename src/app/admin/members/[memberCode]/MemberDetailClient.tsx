import Link from "next/link";
import { currentStatus, type getAdminMember } from "@/lib/admin-members-server";
import MemberRoleAction from "../MemberRoleAction";
import OnlineCancellationControls from "./OnlineCancellationControls";

function date(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "—";
}
function Table({ title, headings, rows, navigation }: { title: string; headings: string[]; rows: React.ReactNode[][]; navigation: React.ReactNode }) {
  return <section className="min-w-0 rounded-2xl border bg-white p-5"><h2 className="mb-3 font-bold">{title} (หน้าละ 100 รายการ)</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{headings.map(h => <th key={h} className="whitespace-nowrap p-3">{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-t">{row.map((cell, j) => <td key={j} className="whitespace-nowrap p-3">{cell}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headings.length} className="p-6 text-center">ยังไม่มีประวัติ</td></tr>}</tbody></table></div>{navigation}</section>;
}
export default function MemberDetailClient({ data, callerRole, staffFreeEntitlement, onlineCancellationEnabled = false }: {
  data: NonNullable<Awaited<ReturnType<typeof getAdminMember>>>; callerRole?: string; staffFreeEntitlement?: React.ReactNode; onlineCancellationEnabled?: boolean;
}) {
  const m = data.member;
  const owner = data.callerRole === "OWNER";
  const showOnlineCancellationReview = owner && callerRole === "OWNER";
  const legacyMembership = staffFreeEntitlement && !data.orders.rows.some(order => order.status === "STAFF_TRANSFER");
  function navigation(key: "orders" | "checkins" | "coupons") {
    const history = data[key];
    function href(page: number) {
      const query = new URLSearchParams({ ordersPage: String(data.orders.page), checkinsPage: String(data.checkins.page), couponsPage: String(data.coupons.page) });
      query.set(`${key}Page`, String(page));
      return `/admin/members/${encodeURIComponent(m.memberCode)}?${query}#${key}`;
    }
    return <nav id={key} aria-label={`หน้าประวัติ ${key}`} className="mt-4 flex items-center gap-4 text-sm">
      {history.page > 1 && <Link prefetch={false} href={href(history.page - 1)} className="underline">← ก่อนหน้า</Link>}
      <span>หน้า {history.page}</span>
      {history.hasNext && <Link prefetch={false} href={href(history.page + 1)} className="underline">ถัดไป →</Link>}
    </nav>;
  }
  const fields: [string, React.ReactNode][] = [
    ["รหัสสมาชิก", m.memberCode], ["ชื่อ", m.fullName], ["ชื่อเล่น", m.nickname], ["โทรศัพท์", m.phone],
    ["เพศ", m.gender],
    ["บทบาท", <span key="role" className="inline-flex flex-wrap items-center gap-2"><span>{m.role}</span>{owner && <MemberRoleAction phone={m.phone} currentRole={m.role} callerRole={callerRole === "OWNER" ? data.callerRole : undefined} />}</span>],
    [legacyMembership ? "สถานะสมาชิกเดิม" : "สถานะปัจจุบัน", currentStatus(m, data.asOf)],
    ["วันสมัคร", date(m.createdAt)], [legacyMembership ? "วันหมดอายุเดิม" : "วันหมดอายุ", date(m.expireDate)], ["คะแนน", String(m.points)],
    ["วัน/เดือนเกิด", m.birthDay && m.birthMonth ? `${m.birthDay}/${m.birthMonth}` : null],
    ["ผู้ติดต่อฉุกเฉิน", m.emergencyName], ["เบอร์ฉุกเฉิน", m.emergencyPhone], ["ความสัมพันธ์", m.emergencyRelation],
  ];
  return <div className="min-w-0 space-y-6">
    <Link href="/admin/members" className="text-blu-slate underline">← กลับรายชื่อสมาชิก</Link>
    <h1 className="break-words text-2xl font-black">{m.fullName} <span className="text-base text-blu-steel">{m.memberCode}</span></h1>
    <p className="rounded-xl bg-blu-ice p-4 text-sm">ตารางนี้แสดงข้อมูลจริง การแก้โปรไฟล์ใช้ฟอร์มด้านล่างเมื่อมีสิทธิ์ การต่ออายุและเปลี่ยนเบอร์/รหัสผ่านต้องใช้ขั้นตอนที่กำหนด ไม่สามารถกำหนด PAID วันหมดอายุ คะแนน หรือแจกคูปองจากฟอร์มโปรไฟล์ได้</p>
    <dl className="grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-blu-steel">{label}</dt><dd className="mt-1 break-words font-semibold">{value || "—"}</dd></div>)}</dl>
    {staffFreeEntitlement}
    <Table navigation={navigation("orders")} title="คำสั่งซื้อแพ็กเกจ (ไม่รวมระบบชำระเงินเก่า)" headings={["รหัสคำสั่งซื้อ", "แพ็กเกจ", ...(owner ? ["ยอด"] : []), "สถานะ", "สร้างเมื่อ", "วันเริ่มสิทธิ์", "ช่วงเวลา", ...(owner ? ["ชำระเมื่อ"] : []), "หมดอายุหลังชำระ"]}
      rows={data.orders.rows.map(o => [
        o.id, o.packageName || "ไม่ระบุชื่อแพ็กเกจ",
        ...(owner ? [typeof o.amountSatang === "number" && Number.isFinite(o.amountSatang) ? `${(o.amountSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })} ฿` : "—"] : []),
        // Online PAID history does not carry proof of cancellation eligibility.
        o.status === "PAID" && o.cancelledAt ? `PAID · ยกเลิกแล้ว (${date(o.cancelledAt)})`
          : o.status === "PAID" && showOnlineCancellationReview && onlineCancellationEnabled && m.role === "MEMBER" ? <>
          {o.status}<OnlineCancellationControls key={o.id} orderId={o.id} memberCode={m.memberCode} />
        </> : o.status === "PAID" && showOnlineCancellationReview ? <>
          {o.status}
          <p className="mt-1 w-56 whitespace-normal text-xs text-amber-900">
            <strong className="block">ต้องตรวจสอบก่อนยกเลิก</strong>
            ข้อมูลประวัตินี้ไม่เพียงพอที่จะยืนยันที่มาของสิทธิ์และเงื่อนไขการยกเลิก ยังไม่สามารถยกเลิกจากหน้านี้ได้ และห้ามคืนเงินก่อนยืนยันว่าเข้าเงื่อนไข
          </p>
        </> : o.status === "STAFF_TRANSFER" ? `โอนเงิน · เจ้าหน้าที่บันทึก${o.cancelledAt ? " · ยกเลิกแล้ว" : ""}` : o.status,
        date(o.createdAt), o.membershipStartsAt ? date(o.membershipStartsAt) : "ไม่มีข้อมูลวันเริ่มสิทธิ์",
        o.timeSlot || "—", ...(owner ? [date(o.paidAt)] : []), date(o.membershipExpiresAt),
      ])} />
    <Table navigation={navigation("checkins")} title="ประวัติเช็คอิน" headings={["วันที่/เวลา (ไทย)", "ช่องทาง"]} rows={data.checkins.rows.map(c => [date(c.checkinTime), c.scannerType])} />
    <Table navigation={navigation("coupons")} title="คูปอง" headings={["ชื่อ", "ประเภท", "สถานะปัจจุบัน", "ใช้แล้ว/สิทธิ์ทั้งหมด", "หมดอายุ"]} rows={data.coupons.rows.map(c => [c.title, c.type, c.status === "AVAILABLE" && c.expireDate && Date.parse(c.expireDate) <= data.asOf ? "EXPIRED" : c.status, `${c.usedCount}/${c.totalQuota}`, date(c.expireDate)])} />
  </div>;
}
