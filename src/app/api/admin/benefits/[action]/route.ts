import { benefitsAdminAction } from "@/lib/real-benefits-admin-server";
export const runtime = "nodejs";
type Context = { params: Promise<{ action: string }> };
export async function GET(request: Request, context: Context) {
  return benefitsAdminAction(request, (await context.params).action);
}
export async function POST(request: Request, context: Context) {
  return benefitsAdminAction(request, (await context.params).action);
}
