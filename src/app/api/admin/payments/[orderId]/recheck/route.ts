import { prepareOwnerRecheck } from "@/lib/payment-server";

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  return prepareOwnerRecheck(request, (await context.params).orderId);
}
