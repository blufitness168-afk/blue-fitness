import { couponHistory } from "@/lib/r6-coupon-history-server";
export const runtime = "nodejs";
export function GET(request: Request) { return couponHistory(request, true); }
