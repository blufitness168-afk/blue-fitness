import { notFound } from "next/navigation";
import { getAdminMember, type MemberHistoryInput } from "@/lib/admin-members-server";
import Client from "./MemberDetailClient";
import { requireAdminPage } from "@/lib/admin-permissions-server";
import AdminMemberProfileForm from "./AdminMemberProfileForm";

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
  return <>
    <Client data={data} callerRole={caller.role} />
    {canEdit && <AdminMemberProfileForm key={`${m.memberCode}:${JSON.stringify(snapshot)}`} memberCode={m.memberCode} snapshot={snapshot} />}
  </>;
}
