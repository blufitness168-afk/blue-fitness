import { resetAdminMemberPassword } from "@/lib/admin-member-password-server";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ memberCode: string }> }) {
  const { memberCode } = await params;
  return resetAdminMemberPassword(request, memberCode);
}
