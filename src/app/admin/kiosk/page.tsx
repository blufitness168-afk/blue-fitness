import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/server";
import EnterKiosk from "./EnterKiosk";
export default async function Page() {
  const member = await getCurrentMember();
  if (!member || !["ADMIN", "OWNER"].includes(member.role)) redirect("/member/login");
  return <EnterKiosk />;
}
