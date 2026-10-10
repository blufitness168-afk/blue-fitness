import { createOrder } from "@/lib/payment-server";
export const runtime = "nodejs";
export async function POST(request: Request) { return createOrder(request); }
