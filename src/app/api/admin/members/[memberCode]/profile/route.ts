import { updateAdminMemberProfile } from "@/lib/admin-member-profile-server";

export async function PATCH(request: Request, { params }: { params: Promise<{ memberCode: string }> }) {
  const { memberCode } = await params;
  return updateAdminMemberProfile(request, memberCode);
}
