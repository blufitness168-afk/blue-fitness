import { getPaymentAccount } from "@/lib/payment-server";
export const runtime = "nodejs";
export async function GET() { return getPaymentAccount(); }
