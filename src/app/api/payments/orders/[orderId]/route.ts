import { cancelOrder, getOrder } from "@/lib/payment-server";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  return cancelOrder(request, (await context.params).orderId);
}
export async function GET(_request: Request, context: { params: Promise<{ orderId: string }> }) {
  return getOrder((await context.params).orderId);
}
