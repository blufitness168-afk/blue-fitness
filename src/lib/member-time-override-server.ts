import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { boundedBody } from "./payment-server";
import { packageCatalogDailySlot } from "./package-catalog";

const memberCodeSchema = z.string().regex(/^BLU-[0-9]{1,12}$/);
const slot = z.string().refine(value => packageCatalogDailySlot(value) !== null);
const version = z.number().int().min(0).max(2147483647);
const writeSchema = z.object({
  requestKey: z.uuidv4(), expectedOrderId: z.uuid(), expectedVersion: version,
  timeSlot: slot.nullable(), reason: z.string().trim().min(1).max(240).refine(value => !value.includes("\0")),
}).strict();
const stateSchema = z.object({
  version, entitlement: z.object({ orderId: z.uuid(), expiresAt: z.iso.datetime({ offset: true }),
    baseSlot: slot, overrideSlot: slot.nullable() }).strict().nullable(),
}).strict();
export type MemberTimeOverride = z.infer<typeof stateSchema>;

class OverrideDenied extends Error {
  constructor(public status: number) { super("Override access denied"); }
}
async function connection() {
  const actor = await getCurrentMember();
  if (!actor) throw new OverrideDenied(401);
  if (actor.status === "SUSPENDED" || !["ADMIN", "OWNER"].includes(actor.role)) throw new OverrideDenied(403);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new OverrideDenied(401);
  if (!process.env.DATABASE_URL) throw Error("Override unavailable");
  return { sql: neon(process.env.DATABASE_URL), digest: createHash("sha256").update(token).digest("hex") };
}
export async function getMemberTimeOverride(memberCode: string): Promise<MemberTimeOverride> {
  if (!memberCodeSchema.safeParse(memberCode).success) throw new OverrideDenied(400);
  const { sql, digest } = await connection();
  const rows = await sql`SELECT public.r3_override_read(${digest},${memberCode}) AS state`;
  return stateSchema.parse(rows[0]?.state);
}
export async function memberTimeOverrideRequest(request: Request, memberCode: string) {
  if (!sameOrigin(request)) return json({ error: "ไม่อนุญาตคำขอจากเว็บไซต์อื่น" }, 403);
  if (request.method !== "GET" && request.method !== "PATCH") return json({ error: "ไม่รองรับวิธีเรียกนี้" }, 405);
  if (!memberCodeSchema.safeParse(memberCode).success || new URL(request.url).search) return json({ error: "คำขอไม่ถูกต้อง" }, 400);
  try {
    if (request.method === "GET") return json({ state: await getMemberTimeOverride(memberCode) });
    const { sql, digest } = await connection();
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "คำขอไม่ถูกต้อง" }, 400);
    let payload: unknown;
    try { payload = JSON.parse((await boundedBody(request, 4096)).toString("utf8")); }
    catch { return json({ error: "คำขอไม่ถูกต้องหรือใหญ่เกินกำหนด" }, 400); }
    const parsed = writeSchema.safeParse(payload);
    if (!parsed.success) return json({ error: "ระบุช่วงเวลา เหตุผล และข้อมูลเวอร์ชันที่ถูกต้อง" }, 400);
    const { requestKey, ...fields } = parsed.data;
    const rows = await sql`SELECT public.r3_override_write(${digest},${requestKey}::uuid,${JSON.stringify({ memberCode, ...fields })}::jsonb) AS result`;
    if (rows[0]?.result?.ok !== true || !version.safeParse(rows[0]?.result?.version).success) throw Error("Unconfirmed override write");
    return json({ ok: true, version: rows[0].result.version });
  } catch (error) {
    if (error instanceof OverrideDenied) return json({ error: "ไม่มีสิทธิ์จัดการช่วงเวลาสมาชิก" }, error.status);
    const code = (error as { code?: string } | null)?.code;
    if (code === "42501") return json({ error: "สิทธิ์หรือเซสชันเปลี่ยน กรุณาโหลดหน้าใหม่" }, 403);
    if (code === "P0002") return json({ error: "ไม่พบสมาชิก" }, 404);
    if (code === "40001" || code === "23505") return json({ error: "สิทธิ์แพ็กเกจหรือข้อมูลเปลี่ยน กรุณาโหลดใหม่ก่อนแก้ไข" }, 409);
    if (code === "22023") return json({ error: "ช่วงเวลาไม่ถูกต้องหรือไม่มีการเปลี่ยนแปลง" }, 400);
    return json({ error: "ยังยืนยันผลไม่ได้ กรุณาส่งคำขอเดิมซ้ำหรือโหลดข้อมูลใหม่" }, 503);
  }
}
