import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { getCurrentMember, SESSION_COOKIE } from "./auth/server";
import { json, sameOrigin } from "./auth/http";
import { MAX_IMPORT_BYTES, parseFinanceImport, type ImportIssue, type ImportReceipt } from "./finance-import-csv";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HEX = /^[a-f0-9]{64}$/;

async function readCsv(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > MAX_IMPORT_BYTES) throw new RangeError("size");
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function financeImportRequest(request: Request) {
  if (process.env.FINANCE_IMPORT_ENABLED !== "1") return json({ error: "ยังไม่เปิดใช้งานการนำเข้า" }, 404);
  if (!sameOrigin(request)) return json({ error: "ต้องส่งจากเว็บไซต์เดียวกัน" }, 403);
  try {
    const member = await getCurrentMember();
    if (!member || member.status === "SUSPENDED") return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (member.role !== "OWNER") return json({ error: "เฉพาะเจ้าของเท่านั้น" }, 403);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !HEX.test(token)) return json({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    const action = new URL(request.url).searchParams.get("action");
    const key = request.headers.get("x-import-key") ?? "";
    if ((action !== "preview" && action !== "commit") || !UUID.test(key) ||
        request.headers.get("content-type")?.split(";")[0].trim() !== "text/csv") {
      return json({ error: "ต้องใช้แม่แบบ CSV และรหัสคำขอนำเข้า" }, 400);
    }
    if (Number(request.headers.get("content-length")) > MAX_IMPORT_BYTES) return json({ error: "ไฟล์เกิน 256 KiB" }, 413);
    let csv: string;
    try { csv = await readCsv(request); }
    catch (error) {
      return error instanceof RangeError ? json({ error: "ไฟล์เกิน 256 KiB" }, 413) : json({ error: "อ่าน CSV แบบ UTF-8 ไม่ได้" }, 400);
    }
    const { rows, issues } = parseFinanceImport(csv);
    if (issues.length) return json({ issues }, 422);
    const payload = JSON.stringify(rows);
    const proof = createHmac("sha256", token).update(`finance-import-v1\n${key}\n${payload}`).digest("hex");
    if (action === "commit") {
      const received = request.headers.get("x-import-preview") ?? "";
      if (request.headers.get("x-import-attested") !== "yes" || !HEX.test(received) ||
          !timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(proof, "hex"))) {
        return json({ error: "ต้องตรวจไฟล์ชุดเดิมและยืนยันว่าไม่ใช่รายการแพ็กเกจหรือรายการซ้ำ" }, 400);
      }
    }
    if (!process.env.DATABASE_URL) throw new Error("Missing database configuration");
    const digest = createHash("sha256").update(token).digest("hex");
    const sql = neon(process.env.DATABASE_URL);
    const [reply] = await sql`SELECT public.r5_finance_import(${digest}, ${action}, ${key}::uuid,
      ${payload}::jsonb, ${action === "commit"}::boolean) AS result`;
    const result = reply.result as { issues?: ImportIssue[]; receipt?: ImportReceipt };
    if (result.issues?.length) return json({ issues: result.issues }, action === "commit" ? 409 : 422);
    if (result.receipt) return json({ receipt: result.receipt });
    if (action === "preview" && Array.isArray(result.issues)) return json({ rows, proof });
    throw new Error("Invalid import result");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return json({ error: "เซสชันหมดอายุหรือไม่มีสิทธิ์" }, 403);
    if (code === "22023") return json({ error: "รหัสชุดนี้ถูกใช้กับข้อมูลอื่น หรือรูปแบบไม่ถูกต้อง" }, 409);
    console.error("[finance-import] operation failed", { code: code ?? "unknown" });
    return json({ error: "ยังยืนยันผลไม่ได้ กรุณาลองคำขอชุดเดิมอีกครั้ง" }, 503);
  }
}
