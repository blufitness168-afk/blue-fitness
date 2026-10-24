import { getAdminDashboard } from "@/lib/admin-members-server";
import Client from "./DashboardClient";
import { requireAdminPage } from "@/lib/admin-permissions-server";

export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdminPage("/admin");
  const { month } = await searchParams;
  return <Client data={await getAdminDashboard(typeof month === "string" ? month : undefined)} />;
}
