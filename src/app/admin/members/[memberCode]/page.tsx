import { requireAdminPage } from "@/lib/admin-permissions-server";
import Client from "./MemberDetailClient";

export default async function Page({ params }: { params: Promise<{ memberCode: string }> }) {
  await requireAdminPage("/admin/members");
  return <Client params={params} />;
}
