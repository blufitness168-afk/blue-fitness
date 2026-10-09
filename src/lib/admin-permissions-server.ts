import "server-only";
import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/server";
import { adminLanding, canAccessAdminPath } from "./admin-permissions";

export async function requireAdminPage(pathname: string) {
  const member = await getCurrentMember();
  if (!member) redirect("/member/login");
  if (!canAccessAdminPath(member.role, pathname)) redirect(adminLanding(member.role));
  return member;
}
