import { getAdminMembers, type MemberListInput } from "@/lib/admin-members-server";
import { getMemberCategoriesMap } from "@/lib/member-category-server";
import Client from "./MembersClient";
import { requireAdminPage } from "@/lib/admin-permissions-server";

export default async function Page({ searchParams }: { searchParams: Promise<MemberListInput> }) {
  const caller = await requireAdminPage("/admin/members");
  const params = await searchParams;
  const data = await getAdminMembers(params);
  const categories = await getMemberCategoriesMap(data.members.map(member => member.memberCode));
  return (
    <Client
      data={data}
      callerRole={caller.role}
      categories={categories}
    />
  );
}
