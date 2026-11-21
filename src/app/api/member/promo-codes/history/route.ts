import { promoHistory } from "@/lib/r6-promo-history-server";
export const runtime = "nodejs";
export function GET(request: Request) { return promoHistory(request, false); }
