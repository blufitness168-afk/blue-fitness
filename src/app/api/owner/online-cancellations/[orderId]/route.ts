import { onlineCancellationRequest } from "@/lib/online-cancellation-server";

export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ orderId: string }> }) {
  return onlineCancellationRequest(request, (await context.params).orderId);
}
export { handle as GET, handle as POST };
