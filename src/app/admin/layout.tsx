import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/server";
import AdminShell from "./AdminShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember();
  if (!member || (member.role !== "ADMIN" && member.role !== "OWNER")) redirect("/member/login");
  return <AdminShell role={member.role}>{children}</AdminShell>;
}
