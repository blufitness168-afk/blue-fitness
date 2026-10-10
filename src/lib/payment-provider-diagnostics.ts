import "server-only";
import { z } from "zod";
import { boundedBody } from "./payment-server";

const infoSchema = z.object({ success: z.literal(true), data: z.object({ branch: z.object({ isActive: z.boolean() }) }) });
const accountsSchema = z.object({ success: z.literal(true), data: z.object({ items: z.array(z.object({ bankCode: z.string(), bankNumber: z.string() })).max(100), total: z.number().int().nonnegative(), page: z.literal(1) }) });
const limits = { automaticV2: false, strongReceiverContractConfirmed: false, matchingPolicy: "NAME_SIMILARITY_85_PERCENT_NOT_PAYMENT_EVIDENCE" } as const;

// No verify endpoint, POST, branch mutation or payment state change exists here.
export async function readV2Diagnostics() {
  const key = process.env.EASYSLIP_V2_API_KEY || process.env.EASYSLIP_API_KEY;
  const bankCode = process.env.PAYMENT_RECEIVER_BANK_CODE;
  const account = process.env.PAYMENT_RECEIVER_BANK_ACCOUNT;
  if (!key) return { ...limits, keyConfigured: false, keyAccepted: null, branchActive: null, receiverLinkedToBranch: null, blocker: "ยังไม่ตั้งค่า EasySlip key" };
  async function get(path: "/info" | "/bank-accounts?bankCode=" ) {
    const url = path === "/info" ? "https://api.easyslip.com/v2/info" : `https://api.easyslip.com/v2/bank-accounts?bankCode=${bankCode}&page=1&limit=100`;
    const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${key}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
    const value: unknown = JSON.parse((await boundedBody(response, 65536, 12_000)).toString("utf8"));
    return { ok: response.ok, status: response.status, value };
  }
  try {
    const response = await get("/info");
    const info = infoSchema.safeParse(response.value);
    if (!response.ok || !info.success) return { ...limits, keyConfigured: true, keyAccepted: response.status === 401 ? false : null, branchActive: null, receiverLinkedToBranch: null, blocker: "v2 info ไม่ยืนยัน key/branch", providerHttpStatus: response.status };
    if (!bankCode || !/^\d{3}$/.test(bankCode) || !account || !/^\d{10}$/.test(account)) return { ...limits, keyConfigured: true, keyAccepted: true, branchActive: info.data.data.branch.isActive, receiverLinkedToBranch: null, blocker: "receiver config ไม่ครบ" };
    const linkedResponse = await get("/bank-accounts?bankCode=");
    const linked = accountsSchema.safeParse(linkedResponse.value);
    const matching = linkedResponse.ok && linked.success ? linked.data.data.items.some(a => a.bankCode === bankCode && /^[0-9 -]+$/.test(a.bankNumber) && a.bankNumber.replace(/[ -]/g, "") === account) : null;
    const complete = linkedResponse.ok && linked.success && linked.data.data.total <= linked.data.data.items.length;
    return { ...limits, keyConfigured: true, keyAccepted: true, branchActive: info.data.data.branch.isActive,
      branchAccountsReadable: linkedResponse.ok && linked.success,
      receiverLinkedToBranch: matching === true ? true : complete ? false : null,
      resultComplete: complete, blocker: "แม้บัญชีผูก branch และ key ใช้ได้ ก็ไม่พิสูจน์ผู้รับสลิป: matchAccount ใช้ชื่อคล้าย 85% ต้องรอ provider ยืนยัน strong contract" };
  } catch {
    return { ...limits, keyConfigured: true, keyAccepted: null, branchActive: null, receiverLinkedToBranch: null, blocker: "อ่าน diagnostics ไม่สำเร็จหรือหมดเวลา ไม่เปิดรับโอน" };
  }
}
