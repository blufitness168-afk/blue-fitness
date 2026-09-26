import { json } from "@/lib/auth/http";
import { getCurrentMember } from "@/lib/auth/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const member = await getCurrentMember();
    if (!member) return json({ member: null });
    return json({ member: { fullName: member.fullName, phone: member.phone, memberCode: member.memberCode, role: member.role, avatarUrl: member.avatarUrl } });
  } catch {
    return json({ error: "Service unavailable" }, 503);
  }
}
