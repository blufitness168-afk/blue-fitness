import { staffPaidTransferRequest } from "@/lib/staff-paid-transfer-server";

export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ memberCode: string }> }) {
  return staffPaidTransferRequest(request, (await context.params).memberCode);
}
export { handle as GET, handle as POST };
