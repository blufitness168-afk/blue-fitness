import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { json, readBody, sameOrigin } from "@/lib/auth/http";
import { getCurrentMember } from "@/lib/auth/server";
import { normalizePhone } from "@/lib/auth/policy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Forbidden" }, 403);
    const owner = await getCurrentMember();
  if (owner?.role !== "OWNER") return json({ error: "Forbidden" }, 403);
  const body = await readBody(request);
  const phone = normalizePhone(body?.phone);
  if (!phone || (body?.role !== "ADMIN" && body?.role !== "MEMBER")) return json({ error: "Invalid request" }, 400);
  try {
    const updated = await db.update(members).set({ role: body.role, updatedAt: new Date() })
      .where(and(eq(members.phone, phone), ne(members.role, "OWNER")))
      .returning({ id: members.id, role: members.role });
    if (updated.length !== 1) return json({ error: "Member not found or protected" }, 404);
    return json({ ok: true });
  } catch {
    return json({ error: "Service unavailable" }, 503);
  }
}
