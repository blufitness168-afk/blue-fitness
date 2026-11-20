import { requireAdminPage } from "@/lib/admin-permissions-server";
import FinanceClient from "./FinanceClient";
import FinanceImport from "./FinanceImport";
import { readRealFinance } from "@/lib/real-finance-server";

export default async function FinancePage() {
  await requireAdminPage("/admin/finance");
  const data = await readRealFinance();
  if (process.env.FINANCE_IMPORT_ENABLED !== "1") return <FinanceClient initialData={data} />;
  return <div className="mx-auto max-w-375 space-y-6">
    <FinanceImport />
    <FinanceClient key={data.audit[0]?.id ?? 0} initialData={data} />
  </div>;
}
