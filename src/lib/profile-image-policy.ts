export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
// Multipart headers/boundaries have a separate, small allowance.
export const MAX_PROFILE_REQUEST_BYTES = MAX_PROFILE_IMAGE_BYTES + 64 * 1024;

export class ProfileImageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function readProfileForm(req: Request): Promise<FormData> {
  const reader = req.body?.getReader();
  if (!reader) throw new ProfileImageError(400, "Missing upload body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROFILE_REQUEST_BYTES) {
        await reader.cancel().catch(() => {});
        throw new ProfileImageError(413, "Upload exceeds 5MB limit");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { "Content-Type": req.headers.get("content-type") ?? "" } }).formData();
  } catch { throw new ProfileImageError(400, "Invalid multipart upload"); }
}

export function validateProfileImage(bytes: Buffer, mime: string): void {
  if (bytes.length > MAX_PROFILE_IMAGE_BYTES) throw new ProfileImageError(413, "Upload exceeds 5MB limit");
  const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString("ascii", 12, 16) === "IHDR";
  const webp = bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16)) && bytes.readUInt32LE(4) === bytes.length - 8;
  if (!((mime === "image/jpeg" && jpeg) || (mime === "image/png" && png) || (mime === "image/webp" && webp))) {
    throw new ProfileImageError(400, "รองรับ JPG, PNG หรือ WebP ที่มีชนิดไฟล์ตรงกับเนื้อหาเท่านั้น");
  }
}
