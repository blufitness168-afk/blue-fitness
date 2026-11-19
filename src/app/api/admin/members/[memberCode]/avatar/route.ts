import { staffAvatarRequest } from "@/lib/staff-avatar-server";
export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ memberCode: string }> }) {
  return staffAvatarRequest(request, (await context.params).memberCode);
}
export { handle as GET, handle as POST };
