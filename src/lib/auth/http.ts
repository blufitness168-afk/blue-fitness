import "server-only";
import { NextResponse } from "next/server";

export function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!sameOrigin(request)) return null;
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return null;
  if (Number(request.headers.get("content-length")) > 1024) return null;
  try {
    const text = await request.text();
    if (text.length > 1024) return null;
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  // Reject cross-site browser requests even if the Origin header is omitted.
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  return !origin || origin === new URL(request.url).origin;
}
