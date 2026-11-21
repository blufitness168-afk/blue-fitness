import CouponRecipientLink from "./CouponRecipientLink";
import { notFound } from "next/navigation";
import { getAdminMember, type MemberHistoryInput } from "@/lib/admin-members-server";
import Client from "./MemberDetailClient";
import { requireAdminPage } from "@/lib/admin-permissions-server";
import AdminMemberProfileForm from "./AdminMemberProfileForm";
import AdminMemberTimeOverrideForm from "./AdminMemberTimeOverrideForm";
import { getMemberTimeOverride } from "@/lib/member-time-override-server";
import AdminMemberPasswordForm from "./AdminMemberPasswordForm";
import { isAdminPasswordResetEnabled } from "@/lib/admin-member-password-server";
import AdminMemberContactEmailForm from "./AdminMemberContactEmailForm";
import { getMemberContactEmail } from "@/lib/member-contact-email-server";
import MemberCardSection from "./MemberCardSection";
import { StaffAvatarSection } from "./StaffAvatarSection";
import { isStaffFreeEnabled } from "@/lib/staff-free-server";
import StaffFreeSection from "./StaffFreeSection";
import StaffFreeCancellationSection from "./StaffFreeCancellationSection";
import { readStaffFreeCancellationCandidates } from "@/lib/staff-free-cancellation-server";
import StaffFreeEntitlement from "@/components/StaffFreeEntitlement";
import { readStaffFreeTerms } from "@/lib/staff-free-display-server";
import StaffTransferSection from "./StaffTransferSection";
import { staffPaidReadsEnabled } from "@/lib/staff-paid-rollout-server";
import { onlineCancellationEnabled } from "@/lib/online-cancellation-rollout-server";

export default async function Page({ params, searchParams }: { params: Promise<{ memberCode: string }>; searchParams: Promise<MemberHistoryInput> }) {
  const caller = await requireAdminPage("/admin/members");
  const { memberCode } = await params;
  const data = await getAdminMember(memberCode, await searchParams);
  if (!data) notFound();
  const m = data.member;
  const snapshot = { fullName: m.fullName, nickname: m.nickname, gender: m.gender,
    birthDay: m.birthDay, birthMonth: m.birthMonth, emergencyName: m.emergencyName,
    emergencyPhone: m.emergencyPhone, emergencyRelation: m.emergencyRelation };
  const canEdit = (data.callerRole === "ADMIN" && m.role === "MEMBER")
    || (data.callerRole === "OWNER" && ["MEMBER", "ADMIN"].includes(m.role));
  // Migration/guard failures must not appear as an empty, editable contact.
  const canEditTimeOverride = canEdit && m.role === "MEMBER";
  const canUseMemberActions = canEditTimeOverride && m.status === "ACTIVE"
    && caller.role === data.callerRole;
  const showFreeRenewal = canUseMemberActions && isStaffFreeEnabled();
  const showTransferRenewal = canUseMemberActions && staffPaidReadsEnabled() && process.env.ENABLE_STAFF_PAID_TRANSFER === "true";
  const isOwner = caller.role === "OWNER";
  const [contact, timeOverride, staffFreeTerms, cancellationCandidates] = await Promise.all([
    canEdit ? getMemberContactEmail(m.memberCode).catch(() => null) : null,
    canEditTimeOverride ? getMemberTimeOverride(m.memberCode).catch(() => null) : null,
    m.role === "MEMBER" ? readStaffFreeTerms(m.memberCode) : [],
    isOwner && showFreeRenewal ? readStaffFreeCancellationCandidates(m.memberCode) : [],
  ]);
  return <>
    <Client data={data} callerRole={caller.role} onlineCancellationEnabled={isOwner && data.callerRole === "OWNER" && onlineCancellationEnabled()} staffFreeEntitlement={staffFreeTerms.length > 0
      ? <StaffFreeEntitlement terms={staffFreeTerms} /> : undefined} memberActions={canUseMemberActions && (
        <nav aria-label="การจัดการสิทธิ์สมาชิก" className="space-y-2 rounded-2xl border bg-white p-4 text-sm">
          <div className="flex flex-wrap gap-3">
            {showFreeRenewal && <a className="underline" href="#renew-free">ต่ออายุ 0 บาท</a>}
            {showTransferRenewal && <a className="underline" href="#renew-transfer">ต่ออายุแบบโอน</a>}
            <CouponRecipientLink memberCode={m.memberCode} />
          </div>
          <p>ระบบกรอกรหัสผู้รับให้ในแท็บเดิม หากไม่ขึ้นให้กรอก <code className="select-all font-semibold">{m.memberCode}</code> แล้วตรวจสอบสิทธิ์ก่อนยืนยัน</p>
        </nav>
      )} />
    {canEdit && (contact
      ? <AdminMemberContactEmailForm key={`contact:${m.memberCode}:${contact.version}`} memberCode={m.memberCode} contact={contact} />
      : <p role="status" className="mt-6">อีเมลติดต่อยังไม่พร้อมใช้งาน ไม่สามารถอ่านหรือแก้ไขได้ กรุณาติดต่อผู้ดูแล</p>)}
    {canEdit && <AdminMemberProfileForm key={`${m.memberCode}:${JSON.stringify(snapshot)}`} memberCode={m.memberCode} snapshot={snapshot} />}
    {canEditTimeOverride && (timeOverride
      ? <AdminMemberTimeOverrideForm memberCode={m.memberCode} state={timeOverride} />
      : <p role="status" className="mt-6">ช่วงเวลาเข้าใช้เฉพาะสมาชิกยังไม่พร้อมใช้งาน ไม่สามารถอ่านหรือแก้ไขได้</p>)}
    {showFreeRenewal && <div id="renew-free" tabIndex={-1} className="scroll-mt-20">
      <StaffFreeSection key={m.memberCode} memberCode={m.memberCode} />
    </div>}
    {cancellationCandidates.length > 0 && <StaffFreeCancellationSection key={`cancel:${m.memberCode}`} memberCode={m.memberCode} candidates={cancellationCandidates} />}
    {showTransferRenewal && <div id="renew-transfer" tabIndex={-1} className="scroll-mt-20">
      <StaffTransferSection key={`transfer:${m.memberCode}`} memberCode={m.memberCode} mode="transfer" canBackdate={isOwner} />
    </div>}
    {canUseMemberActions && isOwner && process.env.ENABLE_STAFF_PAID_CANCELLATION === "true"
      && <StaffTransferSection key={`transfer-cancel:${m.memberCode}`} memberCode={m.memberCode} mode="cancellation" />}
    {canEdit && <MemberCardSection key={`card:${m.memberCode}`} memberCode={m.memberCode} />}
    {canEdit && caller.memberCode !== m.memberCode && <StaffAvatarSection key={`avatar:${m.memberCode}`} memberCode={m.memberCode} />}
    {isAdminPasswordResetEnabled() && canEdit && caller.memberCode !== m.memberCode && m.status !== "SUSPENDED" && <AdminMemberPasswordForm key={`password:${m.memberCode}`} memberCode={m.memberCode} />}
  </>;
}
