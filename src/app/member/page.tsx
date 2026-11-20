import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/server";
import AccountClient from "./AccountClient";
import { readWelcomeCoupons } from "@/lib/benefits-server";
import { readStaffFreeTerms } from "@/lib/staff-free-display-server";

export default async function MemberPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/member/login");
  const [welcomeCoupons, staffFreeTerms] = await Promise.all([
    readWelcomeCoupons(member.id),
    member.role === "MEMBER" ? readStaffFreeTerms() : [],
  ]);
  return <AccountClient welcomeCoupons={welcomeCoupons} staffFreeTerms={staffFreeTerms} identity={{ id: member.id, memberCode: member.memberCode, fullName: member.fullName, phone: member.phone, avatarUrl: member.avatarUrl ?? "", role: member.role, birthDay: member.birthDay, birthMonth: member.birthMonth, registeredAt: member.createdAt.toISOString(), status: member.status }} />;
}
