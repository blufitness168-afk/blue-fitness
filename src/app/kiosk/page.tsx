import { redirect } from "next/navigation";
import { requireKioskSession } from "@/lib/auth/server";
import KioskClient from "./KioskClient";
export default async function KioskPage() {
  const current = await requireKioskSession();
  if (!current) redirect("/member/login");
  return <KioskClient expiresAt={current.session.expiresAt.toISOString()} />;
}
