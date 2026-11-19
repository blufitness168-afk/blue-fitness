import { memberCardRequest } from "@/lib/member-card-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ memberCode: string }> }) {
  return memberCardRequest(request, (await context.params).memberCode);
}
export { handle as GET, handle as PATCH };
