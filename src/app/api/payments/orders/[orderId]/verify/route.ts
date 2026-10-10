import { verifyOrder } from "@/lib/payment-server";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  return verifyOrder(request, (await context.params).orderId);
}
