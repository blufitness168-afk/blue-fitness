import { kioskAction } from "@/lib/kiosk-server";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  return kioskAction(request, (await context.params).action);
}
