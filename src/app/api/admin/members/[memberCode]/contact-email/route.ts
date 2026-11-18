import { memberContactEmailRequest } from "@/lib/member-contact-email-server";

type Context = { params: Promise<{ memberCode: string }> };
async function handle(request: Request, { params }: Context) {
  const { memberCode } = await params;
  return memberContactEmailRequest(request, memberCode);
}
export const GET = handle;
export const PATCH = handle;
