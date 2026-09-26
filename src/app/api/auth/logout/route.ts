import { json, sameOrigin } from "@/lib/auth/http";
import { revokeCurrentSession, SESSION_COOKIE } from "@/lib/auth/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Invalid request" }, 403);
  try {
    await revokeCurrentSession();
    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch {
    return json({ error: "Service unavailable" }, 503);
  }
}
