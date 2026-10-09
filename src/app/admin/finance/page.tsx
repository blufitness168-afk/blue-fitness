import { requireAdminPage } from "@/lib/admin-permissions-server";
import FinanceClient from "./FinanceClient";

export default async function FinancePage() {
  await requireAdminPage("/admin/finance");
  return <FinanceClient />;
}
