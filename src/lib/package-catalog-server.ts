import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { boundedBody } from "./payment-server";
import { satang } from "./payment-policy";

const updateSchema = z.object({
  requestKey: z.uuid(), id: z.number().int().min(1).max(10), expectedVersion: z.number().int().min(1).max(2147483647),
  name: z.string().trim().min(1).max(200), label: z.string().trim().min(1).max(100), description: z.string().max(2000),
  price: z.number().positive().max(1000000).refine(value => { try { return satang(value) > 0; } catch { return false; } }),
  durationDays: z.number().int().min(1).max(3660), timeSlot: z.enum(["07:00-14:00", "07:00-22:00"]),
  friendCoupons: z.number().int().min(0).max(100), bonusDays: z.number().int().min(0).max(365), isActive: z.boolean(),
}).strict();
const client = () => { if (!process.env.DATABASE_URL) throw Error("Database unavailable"); return neon(process.env.DATABASE_URL); };

export async function publicPackages() {
  try {
    const sql = client();
    const rows = await sql`SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) AS packages FROM package_catalog_public c`;
    return json({ packages: rows[0].packages });
  } catch { return json({ error: "โหลดแพ็กเกจจากฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่" }, 503); }
}

export async function adminPackages(request: Request) {
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
  if (request.method === "POST" && !sameOrigin(request)) return json({ error: "ไม่อนุญาตคำขอข้ามเว็บไซต์" }, 403);
  try {
    const member = await getCurrentMember();
    if (!member || member.status === "SUSPENDED") return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (member.role !== "OWNER") return json({ error: "เฉพาะเจ้าของเท่านั้น" }, 403);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    const digest = createHash("sha256").update(token).digest("hex"), sql = client();
    if (request.method === "GET") {
      const rows = await sql`SELECT package_catalog_action(${digest},'list',NULL,'{}'::jsonb) AS result`;
      return json({ data: { packages: rows[0].result } });
    }
    let body: unknown;
    try {
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw Error("JSON required");
      body = JSON.parse((await boundedBody(request, 16384)).toString("utf8"));
    } catch { return json({ error: "ต้องส่ง JSON ขนาดไม่เกิน 16 KB" }, 400); }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return json({ error: "ข้อมูลแพ็กเกจไม่ถูกต้อง ราคาต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง" }, 400);
    const { requestKey, price, ...fields } = parsed.data;
    const payload = { ...fields, priceSatang: satang(price) };
    const rows = await sql`SELECT package_catalog_action(${digest},'update',${requestKey.toLowerCase()}::uuid,${JSON.stringify(payload)}::jsonb) AS result`;
    return json({ data: { package: rows[0].result } });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "เซสชันหมดอายุหรือไม่มีสิทธิ์" }, 403);
    if (["P0001", "22023", "23505"].includes(code ?? "")) return json({ error: "ข้อมูลเปลี่ยนหรือ UUID ถูกใช้กับข้อมูลอื่น กรุณาโหลดใหม่" }, 409);
    if (["23514", "22003"].includes(code ?? "")) return json({ error: "ค่าแพ็กเกจอยู่นอกขอบเขตที่อนุญาต" }, 400);
    return json({ error: "ยังยืนยันผลไม่ได้ ให้ลองคำขอเดิมซ้ำ (ระบบฐานข้อมูลอาจยังไม่พร้อม)" }, 503);
  }
}
