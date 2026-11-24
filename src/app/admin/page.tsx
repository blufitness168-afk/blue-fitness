import { getAdminDashboard } from "@/lib/admin-members-server";
import Client from "./DashboardClient";
import { requireAdminPage } from "@/lib/admin-permissions-server";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string | string[];
    date?: string | string[];
    dateFrom?: string | string[];
    dateTo?: string | string[];
    month?: string | string[];
    monthFrom?: string | string[];
    monthTo?: string | string[];
    year?: string | string[];
  }>;
}) {
  await requireAdminPage("/admin");
  const params = await searchParams;
  return <Client data={await getAdminDashboard(params)} />;
}
