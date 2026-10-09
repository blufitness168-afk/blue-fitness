import { requireAdminPage } from "@/lib/admin-permissions-server";
import Client from "./MembersClient";

export default async function Page() {
  await requireAdminPage("/admin/members");
  return <Client />;
}
