import { publicPackages } from "@/lib/package-catalog-server";
export const runtime = "nodejs";
export async function GET() { return publicPackages(); }
