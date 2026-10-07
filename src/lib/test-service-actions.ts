import "server-only";
import { json, readBody } from "@/lib/auth/http";

const MAX_IMAGE = 4 * 1024 * 1024;

async function provider(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000) });
  const data = await response.json();
  return { response, data };
}

export async function serviceBalance(service: "sms" | "slip") {
  try {
    if (service === "sms") {
      const key = process.env.SMS_API_KEY;
      const secret = process.env.SMS_API_SECRET;
      if (!key || !secret) return { available: false, message: "ยังไม่ได้ตั้งค่า SMS credentials" };
      const { response, data } = await provider("https://api-v2.thaibulksms.com/credit", { headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` } });
      if (!response.ok || data.error) return { available: false, message: "อ่านเครดิต SMS ไม่สำเร็จ", status: response.status };
      return { available: true, standard: numeric(data.remaining_credit?.standard), corporate: numeric(data.remaining_credit?.corporate) };
    }
    const key = process.env.EASYSLIP_API_KEY;
    if (!key) return { available: false, message: "ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY" };
    const { response, data } = await provider("https://api.easyslip.com/v1/me", { headers: { Authorization: `Bearer ${key}` } });
    if (!response.ok || data.status !== 200) return { available: false, message: "อ่านเครดิต/โควตา EasySlip ไม่สำเร็จ", status: response.status };
    return { available: true, currentCredit: numeric(data.data?.currentCredit), usedQuota: numeric(data.data?.usedQuota), remainingQuota: numeric(data.data?.remainingQuota) };
  } catch {
    return { available: false, message: "อ่านยอดไม่สำเร็จหรือหมดเวลา" };
  }
}

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function comparison(before: object, after: object) {
  const delta: Record<string, number> = {};
  for (const [key, value] of Object.entries(before)) {
    const next = (after as Record<string, unknown>)[key];
    if (typeof value === "number" && typeof next === "number") delta[key] = next - value;
  }
  return { before, after, delta, note: "ผลต่าง = หลัง − ก่อน อาจมีรายการอื่นหรือยอดอัปเดตช้า ไม่ยืนยันแพ็กเกจฟรี/เสียเงินหรือค่าใช้จ่ายต่อรายการ" };
}

// Called only after the route's OWNER and same-origin checks.
export async function testServiceAction(request: Request) {
  let service: "sms" | "slip";
  let init: RequestInit;
  let url: string;
  try {
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      if (Number(request.headers.get("content-length")) > MAX_IMAGE + 65536) return json({ error: "ไฟล์ใหญ่เกิน 4 MB" }, 413);
      // Bound the actual body as well, including chunked requests.
      const reader = request.body?.getReader();
      if (!reader) return json({ error: "ไม่พบไฟล์" }, 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_IMAGE + 65536) { await reader.cancel(); return json({ error: "ไฟล์ใหญ่เกิน 4 MB" }, 413); }
        chunks.push(part.value);
      }
      const bytes = Buffer.concat(chunks);
      const form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
      const file = form.get("file");
      if (form.get("action") !== "verify-test-slip" || form.get("confirmed") !== "true") return json({ error: "กรุณายืนยันการเรียกบริการจริง" }, 400);
      if (!(file instanceof File) || file.size === 0 || file.size > MAX_IMAGE || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) return json({ error: "รองรับ JPG, PNG, WebP, GIF ขนาดไม่เกิน 4 MB" }, 400);
      const signature = Buffer.from(await file.slice(0, 12).arrayBuffer());
      const valid = file.type === "image/jpeg" ? signature.subarray(0, 3).equals(Buffer.from([255, 216, 255])) : file.type === "image/png" ? signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : file.type === "image/gif" ? /^GIF8[79]a/.test(signature.toString("ascii")) : signature.toString("ascii", 0, 4) === "RIFF" && signature.toString("ascii", 8, 12) === "WEBP";
      if (!valid) return json({ error: "ชนิดไฟล์ไม่ตรงกับข้อมูลรูป" }, 400);
      const key = process.env.EASYSLIP_API_KEY;
      if (!key) return json({ error: "ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY" }, 400);
      const upload = new FormData();
      upload.append("file", file, `slip.${file.type.split("/")[1]}`);
      upload.append("checkDuplicate", "false");
      service = "slip";
      url = "https://api.easyslip.com/v1/verify";
      init = { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: upload };
    } else {
      const body = await readBody(request);
      if (body?.action !== "send-test-sms" || body.confirmed !== true) return json({ error: "กรุณายืนยันการเรียกบริการจริง" }, 400);
      if (typeof body.phone !== "string" || !/^0[689]\d{8}$/.test(body.phone)) return json({ error: "กรอกเบอร์มือถือไทย 10 หลัก เริ่มด้วย 06, 08 หรือ 09" }, 400);
      const key = process.env.SMS_API_KEY;
      const secret = process.env.SMS_API_SECRET;
      if (!key || !secret) return json({ error: "ยังไม่ได้ตั้งค่า SMS credentials" }, 400);
      service = "sms";
      url = "https://api-v2.thaibulksms.com/sms";
      init = { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ msisdn: body.phone, message: "[Blu Fitness] ข้อความทดสอบระบบ SMS เท่านั้น ไม่ใช่ OTP", sender: process.env.SMS_SENDER_NAME || "Demo" }) };
    }
  } catch {
    return json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, 400);
  }
  const before = await serviceBalance(service);
  let result: Record<string, unknown>;
  try {
    const { response, data } = await provider(url, init);
    const success = response.ok && (service === "slip" ? data.status === 200 && !!data.data?.transRef : !data.error);
    result = { success, status: response.status, message: success ? service === "sms" ? "ผู้ให้บริการรับคำขอแล้ว ไม่ใช่หลักฐานว่ามือถือได้รับ SMS" : "EasySlip ตรวจพบข้อมูลสลิป ไม่ได้ยืนยันการซื้อหรือผู้รับเงินของร้าน" : "ผู้ให้บริการปฏิเสธคำขอ", providerStatus: data.status ?? null, providerMessage: typeof data.message === "string" ? data.message.slice(0, 200) : null, slip: success && service === "slip" ? { transRef: data.data.transRef, date: data.data.date, amount: data.data.amount?.amount } : null };
  } catch {
    result = { success: false, message: "ไม่ได้รับผลตอบกลับหรือหมดเวลา รายการอาจถูกดำเนินการและหักเครดิตแล้ว ห้ามกดซ้ำโดยไม่ตรวจสอบ" };
  }
  const after = await serviceBalance(service);
  return json({ ...result, balance: comparison(before, after) });
}
