import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { getCurrentMember } from "@/lib/auth/server";
import { sameOrigin } from "@/lib/auth/http";
import { db } from "@/db";
import { members } from "@/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { MAX_PROFILE_IMAGE_BYTES, ProfileImageError, readProfileForm, validateProfileImage } from "@/lib/profile-image-policy";

// Configure Cloudinary
if (
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const member = await getCurrentMember();
  // This endpoint uploads member profiles, not staff-managed rewards or coupons.
  if (!member || (member.role !== "OWNER" && member.role !== "MEMBER")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (member.role === "MEMBER" && (member.avatarUrl || member.avatarChanged)) return NextResponse.json({ error: "ติดต่อเจ้าหน้าที่เพื่อเปลี่ยนรูปโปรไฟล์" }, { status: 403 });
  try {
    const formData = await readProfileForm(req);
        // Owners retain the upload-only workflow; target assignment belongs to the
        // separately authorized admin member update, never to this endpoint.
        if (member.role !== "OWNER" && [...formData.keys()].some(key => key !== "file")) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ success: false, message: "No file provided" }, { status: 400 });
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_PROFILE_IMAGE_BYTES) {
      return NextResponse.json({ success: false, message: "รองรับ JPG, PNG หรือ WebP ขนาดไม่เกิน 5MB" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    validateProfileImage(buffer, file.type);
    const folder = `blue-fitness/profiles/${member.memberCode}`;


    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return NextResponse.json(
        { success: false, message: "Cloudinary credentials not configured" },
        { status: 500 }
      );
    }



    // Upload using stream to avoid ECONNRESET and memory overhead
    const result = await new Promise<{ secure_url: string; public_id: string; width: number; height: number; format: string }>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: "image",
          timeout: 60000,
          allowed_formats: ["jpg", "png", "webp"],
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else if (result) {
            resolve(result);
          } else {
            reject(new Error("Cloudinary returned no upload result"));
          }
        }
      );

      uploadStream.end(buffer);
    });

    if (member.role === "MEMBER") {
      let saved = false;
      try {
        const rows = await db.update(members)
          .set({ avatarUrl: result.secure_url, avatarChanged: true, updatedAt: new Date() })
          .where(and(eq(members.id, member.id), eq(members.role, "MEMBER"), eq(members.avatarChanged, false), or(isNull(members.avatarUrl), eq(members.avatarUrl, ""))))
          .returning({ id: members.id });
        saved = rows.length === 1;
      } finally {
        if (!saved) {
          // Delete only this request's new asset, never the member's current photo.
          await cloudinary.uploader.destroy(result.public_id, { resource_type: "image" }).catch(() => {});
        }
      }
      if (!saved) return NextResponse.json({ error: "ติดต่อเจ้าหน้าที่เพื่อเปลี่ยนรูปโปรไฟล์" }, { status: 409 });
    }
    return NextResponse.json({
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
    });
  } catch (error) {
    if (error instanceof ProfileImageError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to upload image",
      },
      { status: 500 }
    );
  }
}
