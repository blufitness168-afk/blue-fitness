import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/server";
import AccountClient from "./AccountClient";

export default async function MemberPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/member/login");
  return <AccountClient identity={{ id: member.id, memberCode: member.memberCode, fullName: member.fullName, phone: member.phone, avatarUrl: member.avatarUrl ?? "", role: member.role, birthDay: member.birthDay, birthMonth: member.birthMonth, registeredAt: member.createdAt.toISOString(), status: member.status }} />;
}
