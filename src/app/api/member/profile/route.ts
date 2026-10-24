import { getMemberProfile, updateMemberProfile } from "@/lib/member-profile-server";

export const runtime = "nodejs";
export async function GET() { return getMemberProfile(); }
export async function PATCH(request: Request) { return updateMemberProfile(request); }
