import { memberTimeOverrideRequest } from "@/lib/member-time-override-server";

type Context = { params: Promise<{ memberCode: string }> };
async function handle(request: Request, { params }: Context) {
  return memberTimeOverrideRequest(request, (await params).memberCode);
}
export const GET = handle;
export const PATCH = handle;
