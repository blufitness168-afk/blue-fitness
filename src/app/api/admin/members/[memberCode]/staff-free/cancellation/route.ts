import { staffFreeCancellationRequest } from "@/lib/staff-free-cancellation-server";

async function handle(request: Request, context: RouteContext<"/api/admin/members/[memberCode]/staff-free/cancellation">) {
  return staffFreeCancellationRequest(request, (await context.params).memberCode);
}

export { handle as GET, handle as POST };
