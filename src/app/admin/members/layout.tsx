import { requireAdminPage } from "@/lib/admin-permissions-server";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAdminPage("/admin/members");
  return children;
}
