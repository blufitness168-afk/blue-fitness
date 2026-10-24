import { getRealMemberWallet } from "@/lib/real-member-wallet-server";

export const runtime = "nodejs";
export async function GET() { return getRealMemberWallet(); }
