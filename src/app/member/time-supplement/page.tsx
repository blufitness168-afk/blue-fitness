import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/server";
import TimeSupplementClient from "./TimeSupplementClient";

export default async function TimeSupplementPage() {
  const member = await getCurrentMember();
  if (!member || member.status === "SUSPENDED") redirect("/member/login");
  return <TimeSupplementClient memberId={member.id} staff={member.role === "ADMIN" || member.role === "OWNER"} />;
}
