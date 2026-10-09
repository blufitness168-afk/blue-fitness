import { requireAdminPage } from "@/lib/admin-permissions-server";
import Client from "./DashboardClient";

export default async function Page() {
  await requireAdminPage("/admin");
  return <Client />;
}
