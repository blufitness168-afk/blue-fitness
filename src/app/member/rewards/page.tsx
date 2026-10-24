import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/server";
import RewardsClient from "./RewardsClient";
import { readRealRewards } from "@/lib/real-rewards-server";

export default async function RewardsPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/member/login");
  return <RewardsClient initialData={await readRealRewards()} />;
}
