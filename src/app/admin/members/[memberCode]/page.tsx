import { notFound } from "next/navigation";
import { getAdminMember, type MemberHistoryInput } from "@/lib/admin-members-server";
import Client from "./MemberDetailClient";
import { requireAdminPage } from "@/lib/admin-permissions-server";
import AdminMemberProfileForm from "./AdminMemberProfileForm";
import AdminMemberPasswordForm from "./AdminMemberPasswordForm";
import { isAdminPasswordResetEnabled } from "@/lib/admin-member-password-server";
import AdminMemberContactEmailForm from "./AdminMemberContactEmailForm";
import { getMemberContactEmail } from "@/lib/member-contact-email-server";
import MemberCardSection from "./MemberCardSection";
import { StaffAvatarSection } from "./StaffAvatarSection";

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
  const contact = canEdit ? await getMemberContactEmail(m.memberCode).catch(() => null) : null;
  return <>
    <Client data={data} callerRole={caller.role} />
    {canEdit && (contact
      ? <AdminMemberContactEmailForm key={`contact:${m.memberCode}:${contact.version}`} memberCode={m.memberCode} contact={contact} />
      : <p role="status" className="mt-6">อีเมลติดต่อยังไม่พร้อมใช้งาน ไม่สามารถอ่านหรือแก้ไขได้ กรุณาติดต่อผู้ดูแล</p>)}
    {canEdit && <AdminMemberProfileForm key={`${m.memberCode}:${JSON.stringify(snapshot)}`} memberCode={m.memberCode} snapshot={snapshot} />}
    {canEdit && <MemberCardSection key={`card:${m.memberCode}`} memberCode={m.memberCode} />}
    {canEdit && caller.memberCode !== m.memberCode && <StaffAvatarSection key={`avatar:${m.memberCode}`} memberCode={m.memberCode} />}
    {isAdminPasswordResetEnabled() && canEdit && caller.memberCode !== m.memberCode && m.status !== "SUSPENDED" && <AdminMemberPasswordForm key={`password:${m.memberCode}`} memberCode={m.memberCode} />}
  </>;
}
