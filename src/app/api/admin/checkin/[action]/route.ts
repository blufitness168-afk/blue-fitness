import { realCheckinAction } from "@/lib/real-checkin-server";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  return realCheckinAction(request, (await context.params).action);
}
