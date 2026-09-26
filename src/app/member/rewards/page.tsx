import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/server";
import RewardsClient from "./RewardsClient";

export default async function RewardsPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/member/login");
  return <RewardsClient identity={{ memberCode: member.memberCode, fullName: member.fullName, role: member.role }} />;
}
