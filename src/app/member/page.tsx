import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/server";
import AccountClient from "./AccountClient";
import { readWelcomeCoupons } from "@/lib/benefits-server";

export default async function MemberPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/member/login");
  const welcomeCoupons = await readWelcomeCoupons(member.id);
  return <AccountClient welcomeCoupons={welcomeCoupons} identity={{ id: member.id, memberCode: member.memberCode, fullName: member.fullName, phone: member.phone, avatarUrl: member.avatarUrl ?? "", role: member.role, birthDay: member.birthDay, birthMonth: member.birthMonth, registeredAt: member.createdAt.toISOString(), status: member.status }} />;
}
