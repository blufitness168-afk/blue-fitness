import { ownerSpecialAccessRequest } from "@/lib/owner-special-access-server";

type Context = { params: Promise<{ memberCode: string }> };
async function handle(request: Request, { params }: Context) {
  const { memberCode } = await params;
  return ownerSpecialAccessRequest(request, memberCode);
}
export const GET = handle;
export const PATCH = handle;
