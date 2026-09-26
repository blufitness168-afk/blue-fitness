import { json, readBody } from "@/lib/auth/http";
import { validChallengeId, validCode } from "@/lib/auth/policy";
import { SESSION_COOKIE, verifyOtp } from "@/lib/auth/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readBody(request);
  if (!validChallengeId(body?.challengeId) || !validCode(body?.code)) return json({ error: "Invalid request" }, 400);
  try {
    const session = await verifyOtp(body.challengeId, body.code);
    if (!session) return json({ error: "Invalid or expired code" }, 401);
    if (session.purpose === "REGISTER") return json({ ticket: session.ticket });
    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      expires: session.expiresAt,
    });
    return response;
  } catch {
    return json({ error: "Service unavailable" }, 503);
  }
}
