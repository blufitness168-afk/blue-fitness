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
  const canUseStaffTransfer = canEditTimeOverride && m.status === "ACTIVE"
    && caller.role === data.callerRole;
  const isOwner = caller.role === "OWNER";
  const [contact, timeOverride, staffFreeTerms, cancellationCandidates] = await Promise.all([
    canEdit ? getMemberContactEmail(m.memberCode).catch(() => null) : null,
    canEditTimeOverride ? getMemberTimeOverride(m.memberCode).catch(() => null) : null,
    m.role === "MEMBER" ? readStaffFreeTerms(m.memberCode) : [],
    caller.role === "OWNER" && data.callerRole === "OWNER" && m.role === "MEMBER" && m.status === "ACTIVE" && isStaffFreeEnabled()
      ? readStaffFreeCancellationCandidates(m.memberCode) : [],
  ]);
  return <>
    <Client data={data} callerRole={caller.role} onlineCancellationEnabled={isOwner && data.callerRole === "OWNER" && onlineCancellationEnabled()} staffFreeEntitlement={staffFreeTerms.length > 0
      ? <StaffFreeEntitlement terms={staffFreeTerms} /> : undefined} />
    {canEdit && (contact
      ? <AdminMemberContactEmailForm key={`contact:${m.memberCode}:${contact.version}`} memberCode={m.memberCode} contact={contact} />
      : <p role="status" className="mt-6">อีเมลติดต่อยังไม่พร้อมใช้งาน ไม่สามารถอ่านหรือแก้ไขได้ กรุณาติดต่อผู้ดูแล</p>)}
    {canEdit && <AdminMemberProfileForm key={`${m.memberCode}:${JSON.stringify(snapshot)}`} memberCode={m.memberCode} snapshot={snapshot} />}
    {canEditTimeOverride && (timeOverride
      ? <AdminMemberTimeOverrideForm memberCode={m.memberCode} state={timeOverride} />
      : <p role="status" className="mt-6">ช่วงเวลาเข้าใช้เฉพาะสมาชิกยังไม่พร้อมใช้งาน ไม่สามารถอ่านหรือแก้ไขได้</p>)}
    {canEditTimeOverride && isStaffFreeEnabled() && <StaffFreeSection key={m.memberCode} memberCode={m.memberCode} />}
    {cancellationCandidates.length > 0 && <StaffFreeCancellationSection key={`cancel:${m.memberCode}`} memberCode={m.memberCode} candidates={cancellationCandidates} />}
    {canUseStaffTransfer && process.env.ENABLE_STAFF_PAID_TRANSFER === "true"
      && <StaffTransferSection key={`transfer:${m.memberCode}`} memberCode={m.memberCode} mode="transfer" canBackdate={isOwner} />}
    {canUseStaffTransfer && isOwner && process.env.ENABLE_STAFF_PAID_CANCELLATION === "true"
      && <StaffTransferSection key={`transfer-cancel:${m.memberCode}`} memberCode={m.memberCode} mode="cancellation" />}
    {canEdit && <MemberCardSection key={`card:${m.memberCode}`} memberCode={m.memberCode} />}
    {canEdit && caller.memberCode !== m.memberCode && <StaffAvatarSection key={`avatar:${m.memberCode}`} memberCode={m.memberCode} />}
    {isAdminPasswordResetEnabled() && canEdit && caller.memberCode !== m.memberCode && m.status !== "SUSPENDED" && <AdminMemberPasswordForm key={`password:${m.memberCode}`} memberCode={m.memberCode} />}
  </>;
}
