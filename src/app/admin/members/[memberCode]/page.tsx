import { notFound } from "next/navigation";
import { getAdminMember } from "@/lib/admin-members-server";
import Client from "./MemberDetailClient";
import { requireAdminPage } from "@/lib/admin-permissions-server";

export default async function Page({ params }: { params: Promise<{ memberCode: string }> }) {
  await requireAdminPage("/admin/members");
  const { memberCode } = await params;
  const data = await getAdminMember(memberCode);
  if (!data) notFound();
  return <Client data={data} />;
}
