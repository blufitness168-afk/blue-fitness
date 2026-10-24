import { getAdminMembers } from "@/lib/admin-members-server";
import Client from "./MembersClient";
import { requireAdminPage } from "@/lib/admin-permissions-server";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireAdminPage("/admin/members");
  const params = await searchParams;
  return <Client data={await getAdminMembers(typeof params.q === "string" ? params.q : "", typeof params.page === "string" ? params.page : "1")} />;
}
