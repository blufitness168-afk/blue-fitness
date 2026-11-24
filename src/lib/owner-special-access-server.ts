import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { boundedBody } from "./payment-server";
import { packageCatalogDailySlot } from "./package-catalog";

const readSchema = z.object({
  active: z.boolean(),
  expiresAt: z.string().nullable(),
  dailySlot: z.string().nullable(),
  note: z.string().nullable(),
  version: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
}).strict();

const setSchema = z.object({
  action: z.literal("SET"),
  requestKey: z.string().uuid(),
  expectedVersion: z.number().int().min(0).max(2147483646),
  dailySlot: z.string().trim().refine(v => !!packageCatalogDailySlot(v)),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  note: z.string().trim().min(1).max(240),
  reason: z.string().trim().min(1).max(240),
}).strict();

const revokeSchema = z.object({
  action: z.literal("REVOKE"),
  requestKey: z.string().uuid(),
  expectedVersion: z.number().int().min(1).max(2147483646),
  reason: z.string().trim().min(1).max(240),
}).strict();

const inputSchema = z.discriminatedUnion("action", [setSchema, revokeSchema]);

export type OwnerSpecialAccessSnapshot = z.infer<typeof readSchema>;

class SpecialAccessDenied extends Error {
  constructor(public status: number) { super("Special access denied"); }
}

async function connection(ownerOnly: boolean) {
  const actor = await getCurrentMember();
  if (!actor) throw new SpecialAccessDenied(401);
  if (actor.status === "SUSPENDED") throw new SpecialAccessDenied(403);
  if (ownerOnly ? actor.role !== "OWNER" : !["ADMIN", "OWNER"].includes(actor.role)) {
    throw new SpecialAccessDenied(403);
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new SpecialAccessDenied(401);
  if (!process.env.DATABASE_URL) throw Error("Special access unavailable");
  return { sql: neon(process.env.DATABASE_URL), digest: createHash("sha256").update(token).digest("hex") };
}

export async function getOwnerSpecialAccess(memberCode: string): Promise<OwnerSpecialAccessSnapshot> {
  if (!memberCode || memberCode.length > 50) throw new SpecialAccessDenied(400);
  const { sql, digest } = await connection(false);
  const rows = await sql`SELECT owner_special_access_read(${digest}, ${memberCode}) AS result`;
  return readSchema.parse(rows[0]?.result);
}

function failure(error: unknown) {
  if (error instanceof SpecialAccessDenied) return json({ error: "ต้องเป็น OWNER เท่านั้น (ADMIN ดูได้อย่างเดียว)" }, error.status);
  const code = (error as { code?: string }).code;
  if (code === "42501") return json({ error: "สิทธิ์หรือ session เปลี่ยน ต้องเป็น OWNER และโหลดหน้าใหม่" }, 403);
  if (code === "23505" || code === "P0001") return json({ error: "ข้อมูลเปลี่ยนหรือ UUID ใช้กับข้อมูลอื่นแล้ว กรุณาโหลดหน้าใหม่" }, 409);
  if (code === "22023") return json({ error: "รูปแบบช่วงเวลา วันหมดอายุ หรือเหตุผลไม่ถูกต้อง" }, 400);
  return json({ error: "ระบบสิทธิ์พิเศษยังไม่พร้อมใช้งานหรือยังยืนยันผลไม่ได้ ส่งคำขอเดิมซ้ำหรือโหลดหน้าใหม่" }, 503);
}

export async function ownerSpecialAccessRequest(request: Request, memberCode: string) {
  if (!["GET", "PATCH"].includes(request.method)) return json({ error: "ไม่รองรับวิธีเรียกนี้" }, 405);
  if (!sameOrigin(request)) return json({ error: "ไม่อนุญาตคำขอจากเว็บไซต์อื่น" }, 403);
  try {
    if (request.method === "GET") {
      if (new URL(request.url).search || request.body !== null) return json({ error: "คำขอไม่ถูกต้อง" }, 400);
      return json({ specialAccess: await getOwnerSpecialAccess(memberCode) });
    }
    const { sql, digest } = await connection(true);
    if (!memberCode || memberCode.length > 50 || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return json({ error: "คำขอไม่ถูกต้อง" }, 400);
    }
    let body: unknown;
    try { body = JSON.parse((await boundedBody(request, 4096)).toString("utf8")); }
    catch { return json({ error: "คำขอไม่ถูกต้องหรือใหญ่เกินกำหนด" }, 400); }
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) return json({ error: "กรุณาระบุช่วงเวลา (เช่น 00:00-24:00) หมายเหตุ และเหตุผลให้ครบถ้วน" }, 400);
    const { requestKey, ...payload } = parsed.data;
    const result = await sql`SELECT owner_special_access_write(${digest}, ${requestKey}::uuid, ${JSON.stringify({ memberCode, ...payload })}::jsonb) AS result`;
    if (result[0]?.result?.ok !== true) throw Error("Unconfirmed special access write");
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
