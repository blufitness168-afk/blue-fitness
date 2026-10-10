import { providerDiagnostics } from "@/lib/payment-operations";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) { return providerDiagnostics(request); }
