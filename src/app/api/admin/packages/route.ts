import { adminPackages } from "@/lib/package-catalog-server";
export const runtime = "nodejs";
export async function GET(request: Request) { return adminPackages(request); }
export async function POST(request: Request) { return adminPackages(request); }
