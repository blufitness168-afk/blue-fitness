import { staffFreeRequest } from "@/lib/staff-free-server";

async function handle(request: Request, context: RouteContext<"/api/admin/members/[memberCode]/staff-free">) {
  return staffFreeRequest(request, (await context.params).memberCode);
}

export { handle as GET, handle as POST };
