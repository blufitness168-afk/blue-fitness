import { requireAdminPage } from "@/lib/admin-permissions-server";
import FinanceClient from "./FinanceClient";
import { readRealFinance } from "@/lib/real-finance-server";

export default async function FinancePage() {
  await requireAdminPage("/admin/finance");
  const data = await readRealFinance();
  return <FinanceClient initialData={data} />;
}
