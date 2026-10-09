import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/server";
import BenefitsClient from "./BenefitsClient";
import { readWelcomeCoupons } from "@/lib/benefits-server";

export default async function BenefitsPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/member/login");
  const welcomeCoupons = await readWelcomeCoupons(member.id);
    return <BenefitsClient welcomeCoupons={welcomeCoupons} identity={{ memberCode: member.memberCode, fullName: member.fullName }} />;
}
