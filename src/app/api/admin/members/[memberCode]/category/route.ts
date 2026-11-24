import { memberCategoryRequest } from "@/lib/member-category-server";

type Context = { params: Promise<{ memberCode: string }> };
async function handle(request: Request, { params }: Context) {
  const { memberCode } = await params;
  return memberCategoryRequest(request, memberCode);
}
export const GET = handle;
export const PATCH = handle;
