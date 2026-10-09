import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/server";
import AdminShell from "./AdminShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember();
  if (!member) redirect("/member/login");
    if (member.role !== "ADMIN" && member.role !== "OWNER") redirect("/member");
  return <AdminShell role={member.role}>{children}</AdminShell>;
}
