import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { ProfileImageError, readProfileForm, validateProfileImage } from "./profile-image-policy";

const snapshot = z.object({ avatarUrl: z.string().nullable(), version: z.number().int().nonnegative(), source: z.enum(["LEGACY", "STAFF_UPLOAD"]) }).strict();
export type StaffAvatarSnapshot = z.infer<typeof snapshot>;
const input = z.object({ requestKey: z.string().uuid(), expectedVersion: z.string().regex(/^(0|[1-9][0-9]{0,9})$/).transform(Number).pipe(z.number().int().max(2147483646)), reason: z.string().trim().min(1).max(240) }).strict();
class Denied extends Error { constructor(public status: number) { super("Avatar denied"); } }
async function connection() {
  const actor = await getCurrentMember();
  if (!actor) throw new Denied(401);
  if (actor.status === "SUSPENDED" || !["ADMIN", "OWNER"].includes(actor.role)) throw new Denied(403);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Denied(401);
  if (!process.env.DATABASE_URL) throw Error("Unavailable");
  return { sql: neon(process.env.DATABASE_URL), digest: createHash("sha256").update(token).digest("hex") };
}
export async function getStaffAvatar(memberCode: string): Promise<StaffAvatarSnapshot> {
  if (!memberCode || memberCode.length > 50) throw new Denied(400);
  const { sql, digest } = await connection();
  const rows = await sql`SELECT staff_avatar_read(${digest},${memberCode}) AS avatar`;
  return snapshot.parse(rows[0]?.avatar);
}
// Only server-generated IDs and provider responses enter this boundary. No client URL attach API.
async function managedUpload(bytes: Buffer, publicId: string, contentHash: string, recover: boolean): Promise<string> {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloud || !/^[a-z0-9_-]+$/.test(cloud) || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) throw Error("Unavailable");
  cloudinary.config({ cloud_name: cloud, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
  type Asset = { public_id: string; secure_url: string; version: number; format: string; context?: { custom?: { sha256?: string } } };
  const check = (asset: Asset) => {
    if (asset.public_id !== publicId || asset.context?.custom?.sha256 !== contentHash || !Number.isSafeInteger(asset.version) || !["jpg", "png", "webp"].includes(asset.format)
      || asset.secure_url !== `https://res.cloudinary.com/${cloud}/image/upload/v${asset.version}/${publicId}.${asset.format}`) throw Error("Unconfirmed asset");
    return asset.secure_url;
  };
  if (recover) {
    try { return check(await cloudinary.api.resource(publicId, { resource_type: "image", type: "upload", context: true })); }
    catch (error) { if ((error as { error?: { http_code?: number }; http_code?: number }).error?.http_code !== 404 && (error as { http_code?: number }).http_code !== 404) throw Error("Recovery unavailable"); }
  }
  const asset = await new Promise<Asset>((resolve, reject) => {
    cloudinary.uploader.upload_stream({ public_id: publicId, resource_type: "image", type: "upload", overwrite: false, unique_filename: false,
      allowed_formats: ["jpg", "png", "webp"], context: { sha256: contentHash }, timeout: 60000 }, (error, result) => {
      if (error || !result) reject(Error("Unconfirmed upload")); else resolve(result as Asset);
    }).end(bytes);
  });
  return check(asset);
}
export async function staffAvatarRequest(request: Request, memberCode: string) {
  if (!["GET", "POST"].includes(request.method)) return json({ error: "ไม่รองรับวิธีเรียกนี้" }, 405);
  if (!sameOrigin(request) || (request.method === "POST" && !request.headers.get("origin"))) return json({ error: "ไม่อนุญาตคำขอจากเว็บไซต์อื่น" }, 403);
  try {
    if (!memberCode || memberCode.length > 50 || new URL(request.url).search) throw new Denied(400);
    if (request.method === "GET") return json({ avatar: await getStaffAvatar(memberCode) });
    const { sql, digest } = await connection();
    // Live SQL policy before body parsing or any external provider operation.
    await sql`SELECT staff_avatar_read(${digest},${memberCode}) AS avatar`;
    const form = await readProfileForm(request);
    const fields = ["file", "requestKey", "expectedVersion", "reason"];
    if ([...form.keys()].some(key => !fields.includes(key)) || fields.some(key => form.getAll(key).length !== 1)) throw new Denied(400);
    const parsed = input.safeParse(Object.fromEntries(fields.filter(key => key !== "file").map(key => [key, form.get(key)])));
    const file = form.get("file");
    if (!parsed.success || !(file instanceof File)) throw new Denied(400);
    const bytes = Buffer.from(await file.arrayBuffer());
    validateProfileImage(bytes, file.type);
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const { requestKey, ...data } = parsed.data;
    const lease = randomUUID();
    const payload = JSON.stringify({ memberCode, ...data, contentHash, mime: file.type });
    const rows = await sql`SELECT staff_avatar_claim(${digest},${requestKey}::uuid,${payload}::jsonb,${lease}::uuid) AS claim`;
    const claim = z.union([z.object({ done: z.literal(true) }).strict(), z.object({ done: z.literal(false), publicId: z.string().regex(/^blue-fitness\/staff-avatars\/[0-9]+\/[0-9]+\/[a-f0-9-]{36}$/), recover: z.boolean() }).strict()]).parse(rows[0]?.claim);
    if (claim.done) return json({ ok: true });
    const url = await managedUpload(bytes, claim.publicId, contentHash, claim.recover);
    const saved = await sql`SELECT staff_avatar_finish(${digest},${memberCode},${requestKey}::uuid,${lease}::uuid,${url}) AS result`;
    if (saved[0]?.result?.ok !== true) throw Error("Unconfirmed write");
    return json({ ok: true });
  } catch (error) {
    if (error instanceof ProfileImageError) return json({ error: error.message }, error.status);
    if (error instanceof Denied) return json({ error: "คำขอไม่ถูกต้องหรือไม่มีสิทธิ์" }, error.status);
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "สิทธิ์หรือ session เปลี่ยน กรุณาโหลดใหม่" }, 403);
    if (code === "22023") return json({ error: "ข้อมูลรูปไม่ถูกต้อง" }, 400);
    if (code === "P0001" || code === "23505") return json({ error: "คำขอซ้ำกำลังทำงานหรือข้อมูลเปลี่ยนแล้ว รออย่างน้อย 90 วินาทีแล้วส่งคำขอเดิมซ้ำ หรือโหลดใหม่เพื่อตรวจสอบ" }, 409);
    // Never destroy assets: a timeout may have committed the upload or DB transaction.
    return json({ error: "ยังยืนยันผลไม่ได้ รออย่างน้อย 90 วินาทีแล้วส่งคำขอเดิมซ้ำ หรือโหลดใหม่เพื่อตรวจสอบ" }, 503);
  }
}
