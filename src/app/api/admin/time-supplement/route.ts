import { timeSupplement } from "@/lib/time-supplement-server";
export const runtime = "nodejs";
export async function POST(request: Request) { return timeSupplement(request, true); }
