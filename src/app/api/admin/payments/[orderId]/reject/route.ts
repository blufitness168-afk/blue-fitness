import { rejectUnresolvedPayment } from "@/lib/payment-operations";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  return rejectUnresolvedPayment(request, (await context.params).orderId);
}
