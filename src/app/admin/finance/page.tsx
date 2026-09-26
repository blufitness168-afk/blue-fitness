import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/server";
import FinanceClient from "./FinanceClient";

export default async function FinancePage() {
  const member = await getCurrentMember();
  if (!member) redirect("/member/login");
  if (member.role !== "OWNER") redirect("/admin");
  return <FinanceClient />;
}
