import { staffPaidCancellationRequest } from "@/lib/staff-paid-cancellation-server";

export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ memberCode: string }> }) {
  return staffPaidCancellationRequest(request, (await context.params).memberCode);
}
export { handle as GET, handle as POST };
