import { randomBytes } from "node:crypto";
import { json, readBody } from "@/lib/auth/http";
import { normalizePhone } from "@/lib/auth/policy";
import { sendOtp } from "@/lib/auth/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readBody(request);
  const phone = normalizePhone(body?.phone);
  if (!phone) return json({ error: "Invalid request" }, 400);
  try {
    const result = await sendOtp(phone);
    // Do not disclose whether a member exists or the rate limit was hit.
    return json({ challengeId: result?.challengeId ?? randomBytes(16).toString("hex") }, 202);
  } catch {
    return json({ error: "Service unavailable" }, 503);
  }
}
