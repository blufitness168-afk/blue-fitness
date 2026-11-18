import { v2 as cloudinary } from "cloudinary";
import { getCurrentMember } from "@/lib/auth/server";
import { json, sameOrigin } from "@/lib/auth/http";
import { MAX_REWARD_IMAGE_BYTES, RewardImageError, readRewardForm, validateRewardImage } from "@/lib/reward-image-policy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!request.headers.get("origin") || !sameOrigin(request)) return json({ error: "ไม่มีสิทธิ์" }, 403);
  try {
    // getCurrentMember accepts only unexpired, non-revoked NORMAL sessions.
    const member = await getCurrentMember();
    if (!member || member.status === "SUSPENDED") return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (!["OWNER", "ADMIN"].includes(member.role)) return json({ error: "ไม่มีสิทธิ์" }, 403);
    const form = await readRewardForm(request);
    const entries = [...form.entries()];
    const file = form.get("file");
    if (entries.length !== 1 || entries[0][0] !== "file" || !(file instanceof File)) throw new RewardImageError(400, "กรุณาเลือกไฟล์รูปหนึ่งไฟล์");
    if (file.size > MAX_REWARD_IMAGE_BYTES) throw new RewardImageError(413, "รูปต้องไม่เกิน 5MB");
    const bytes = Buffer.from(await file.arrayBuffer());
    validateRewardImage(bytes, file.type);
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) return json({ error: "ระบบอัปโหลดยังไม่พร้อม" }, 503);
    cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
    const url = await new Promise<string>((resolve, reject) => {
      cloudinary.uploader.upload_stream({ folder: "blue-fitness/rewards", resource_type: "image", allowed_formats: ["jpg", "png", "webp"], timeout: 60000 }, (error, result) => {
        if (error || !result?.secure_url?.startsWith("https://")) reject(new Error("Upload failed"));
        else resolve(result.secure_url);
      }).end(bytes);
    });
    return json({ url });
  } catch (error) {
    if (error instanceof RewardImageError) return json({ error: error.message }, error.status);
    return json({ error: "อัปโหลดไม่ได้ กรุณาลองใหม่" }, 503);
  }
}
