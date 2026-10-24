import { financeAction } from "@/lib/real-finance-server";
export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ action: string }> }) {
  return financeAction(request, (await context.params).action);
}
export { handle as GET, handle as POST };
