import { requireAdminPage } from "@/lib/admin-permissions-server";
import PackageCatalogClient from "./PackageCatalogClient";

export default async function PackagesPage() {
  await requireAdminPage("/admin/packages");
  return <PackageCatalogClient />;
}
