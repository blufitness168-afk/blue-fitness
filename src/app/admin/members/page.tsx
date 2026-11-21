import { getAdminMembers, type MemberListInput } from "@/lib/admin-members-server";
import Client from "./MembersClient";
import { requireAdminPage } from "@/lib/admin-permissions-server";

export default async function Page({ searchParams }: { searchParams: Promise<MemberListInput> }) {
  const caller = await requireAdminPage("/admin/members");
  const params = await searchParams;
  return (
    <Client
      data={await getAdminMembers(params)}
      callerRole={caller.role}
    />
  );
}
