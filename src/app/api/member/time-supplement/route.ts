import { timeSupplement } from "@/lib/time-supplement-server";
export const runtime = "nodejs";
export async function GET(request: Request) { return timeSupplement(request); }
export async function POST(request: Request) { return timeSupplement(request); }
