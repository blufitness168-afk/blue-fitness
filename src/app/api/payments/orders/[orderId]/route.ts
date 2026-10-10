import { getOrder } from "@/lib/payment-server";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ orderId: string }> }) {
  return getOrder((await context.params).orderId);
}
