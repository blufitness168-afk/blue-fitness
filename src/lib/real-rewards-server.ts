import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, readBody } from "./auth/http";

export type RealReward = { id: number; title: string; description: string | null; imageUrl: string | null; pointCost: number; stock: number; isActive: boolean };
export type RealRedemption = { id: number; rewardId: number; rewardTitle: string; rewardCode: string | null; pointsSpent: number; status: string; redeemedAt: string; completedAt: string | null; memberCode: string; memberName: string };
export type RewardsData = { points: number; memberCode: string; fullName: string; rewards: RealReward[]; redemptions: RealRedemption[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const integer = (value: unknown, min: number, max = 1000000) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;

export function rewardPayload(action: string, body: Record<string, unknown>): Record<string, unknown> | null {
  if (action === "redeem") return integer(body.rewardId, 1, 2147483647) ? { rewardId: body.rewardId } : null;
  if (action === "deliver") return typeof body.rewardCode === "string" && uuid.test(body.rewardCode) ? { rewardCode: body.rewardCode.toLowerCase() } : null;
  if (action !== "save" || typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 120 ||
    !integer(body.pointCost, 1) || !integer(body.stock, 0) || typeof body.isActive !== "boolean" ||
    (body.description !== null && (typeof body.description !== "string" || body.description.length > 2000)) ||
    (body.imageUrl !== null && (typeof body.imageUrl !== "string" || body.imageUrl.length > 2000 || !/^https:\/\/\S+$/.test(body.imageUrl)))) return null;
  if (body.id !== undefined && (!integer(body.id, 1, 2147483647) || !body.expected || typeof body.expected !== "object" || Array.isArray(body.expected))) return null;
  return { ...(body.id === undefined ? {} : { id: body.id, expected: body.expected }), title: body.title.trim(), description: body.description, imageUrl: body.imageUrl, pointCost: body.pointCost, stock: body.stock, isActive: body.isActive };
}

async function execute(action: string, key: string | null, payload: Record<string, unknown>) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Unauthorized");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
  const sql = neon(process.env.DATABASE_URL);
  const digest = createHash("sha256").update(token).digest("hex");
  for (let attempt = 0; ; attempt++) {
    try {
      const rows = await sql`SELECT real_rewards_action(${digest}, ${action}, ${key}::uuid, ${JSON.stringify(payload)}::jsonb) AS result`;
      return rows[0].result;
    } catch (error) {
      if (attempt >= 2 || !["40001", "40P01"].includes((error as { code?: string }).code ?? "")) throw error;
    }
  }
}

export async function readRealRewards(): Promise<RewardsData> {
  const member = await getCurrentMember();
  if (!member) throw new Error("Unauthorized");
  return execute("member", null, {});
}

export async function rewardsAction(request: Request, action: string) {
  if (!["member", "admin", "redeem", "deliver", "save"].includes(action)) return json({ error: "ไม่พบคำสั่ง" }, 404);
  const read = action === "member" || action === "admin";
  if (request.method !== (read ? "GET" : "POST")) return json({ error: "Method not allowed" }, 405);
  try {
    const member = await getCurrentMember();
    if (!member || member.status === "SUSPENDED") return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (["admin", "deliver", "save"].includes(action) && !["ADMIN", "OWNER"].includes(member.role)) return json({ error: "ไม่มีสิทธิ์" }, 403);
    if (read) return json({ data: await execute(action, null, {}) });
    const body = await readBody(request);
    if (!body || typeof body.requestKey !== "string" || !uuid.test(body.requestKey)) return json({ error: "ต้องระบุ requestKey UUID และ JSON จากเว็บไซต์เดียวกัน" }, 400);
    const payload = rewardPayload(action, body);
    if (!payload) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    return json({ data: await execute(action, body.requestKey.toLowerCase(), payload) });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "เซสชันหมดอายุหรือไม่มีสิทธิ์" }, 403);
    if (code === "22023") return json({ error: "ข้อมูลไม่ถูกต้อง หรือ requestKey ถูกใช้กับคำขออื่น" }, 409);
    if (code === "P0001") return json({ error: "ทำรายการไม่ได้: แต้ม/สต็อกไม่พอ ข้อมูลเปลี่ยน หรือผู้รับถูกระงับ กรุณาโหลดใหม่" }, 409);
    console.error("[rewards] operation failed", { code: code ?? "unknown" });
    return json({ error: "ยังยืนยันผลไม่ได้ กรุณาลองคำขอเดิมอีกครั้ง" }, 503);
  }
}
