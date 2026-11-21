import { createCheckoutCampaign } from "@/lib/r6-checkout-campaign-server";

export const runtime = "nodejs";
export async function POST(request: Request) { return createCheckoutCampaign(request); }
