import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/server";
import BenefitsClient from "./BenefitsClient";

export default async function BenefitsPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/member/login");
  return <BenefitsClient identity={{ memberCode: member.memberCode, fullName: member.fullName }} />;
}
