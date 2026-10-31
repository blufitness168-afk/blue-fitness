import { mockPackages } from "./mock-data";
import { z } from "zod";

export const ORDER_MINUTES = 15;
export const UPLOAD_GRACE_MINUTES = 30;
export const PROVIDER_STRATEGY = "EASYSLIP_V2_REGISTERED_ACCOUNT" as const;
export const RECEIVER_BLOCKER = "ยังไม่เปิดรับโอน: ต้อง apply payment migration และตั้งค่า EasySlip v2 registered account ก่อนเปิด PAYMENT_TRANSFERS_ENABLED";
export function paymentReadiness(env: Record<string, string | undefined>) {
  const configured = env.PAYMENT_PROVIDER_STRATEGY === PROVIDER_STRATEGY;
  const enabled = env.PAYMENT_TRANSFERS_ENABLED === "true" && configured;
  return { transfersEnabled: enabled, blocker: enabled ? null : RECEIVER_BLOCKER, automaticV2: configured, providerStrategy: configured ? PROVIDER_STRATEGY : null };
}
export const SLIP_TOLERANCE_MS = 60_000;
export const MAX_SLIP_BYTES = 4 * 1024 * 1024;
export type Receiver = { promptpay: string; bankCode: string; bankAccount: string; name: string };
export type PaymentQuote = ReturnType<typeof quotePackage>;

export function satang(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") throw Error("ยอดเงินไม่ถูกต้อง");
  const text = String(value);
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) throw Error("ยอดเงินไม่ถูกต้อง");
  const [whole, decimal = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 2_147_483_647) throw Error("ยอดเงินไม่ถูกต้อง");
  return result;
}

export function quotePackage(packageId: number, code: string, now = Date.now()) {
  const pkg = mockPackages.find(p => p.id === packageId && p.isActive);
  if (!pkg) throw Error("ไม่พบแพ็กเกจที่เปิดขาย");
  const subtotalSatang = satang(pkg.price);
  const normalized = code.trim().toUpperCase();
  // Real promos are resolved and reserved atomically by order creation in PostgreSQL.
  // Never fall back to browser/mock marketing definitions.
  void now;
  if (normalized) throw Error("ต้องตรวจโค้ดส่วนลดผ่านระบบชำระเงินจริง");
  const promo: { code: string } | null = null;
  const discountSatang = 0;
  const amountSatang = subtotalSatang - discountSatang;
  if (amountSatang <= 0) throw Error("ส่วนลดต้องไม่ทำให้ยอดชำระเป็นศูนย์");
  return { package: { ...pkg }, subtotalSatang, discountSatang, amountSatang, promo, pointsEarned: Math.floor(amountSatang / 2000) };
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function fullDigits(value: unknown): string | null {
  // Strip separators only. Never erase masking characters to manufacture a match.
  if (typeof value !== "string" || !/^[0-9 -]+$/.test(value)) return null;
  return value.replace(/[ -]/g, "");
}
export function normalizeReceiverName(value: string): string {
  return value.normalize("NFKC").trim().replace(/^(?:นาย|นางสาว|นาง|MRS\.?|MR\.?|MISS)\s*/iu, "").replace(/\s+/gu, "").toUpperCase();
}

export type PaymentEvidence = {
  transRef: string; paidAt: string; amountSatang: number; receiverEvidence: "REGISTERED_ACCOUNT_V2";
  providerStrategy: typeof PROVIDER_STRATEGY; bankCode: string; orderId: string;
  receiverIdentity: { matchingType: "BANK_ACCOUNT" | "PROMPTPAY"; providerBankCode: string; promptpay?: string; bankAccount: string; name: string; expectedName: string; normalizedName: string; bankCode: string };
};

export function mobile(value: unknown) {
  const digits = fullDigits(value);
  if (!digits) return null;
  if (/^0[689]\d{8}$/.test(digits)) return digits;
  if (/^66[689]\d{8}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^0066[689]\d{8}$/.test(digits)) return `0${digits.slice(4)}`;
  return null;
}

function isThaiBahtCurrency(value: unknown): boolean {
  return value === "THB" || value === "764" || value === 764;
}

export function validateSlip(result: unknown, order: { id: string; amount_satang: number; receiver_snapshot: Receiver; created_at: string; expires_at: string }, now = Date.now()): PaymentEvidence {
  const envelope = object(result), details = object(envelope.data), data = object(details.rawSlip), amount = object(data.amount), local = object(amount.local);
  if (envelope.success !== true || typeof data.transRef !== "string" || !/^[A-Za-z0-9._:/-]{1,100}$/.test(data.transRef)) throw Error("ผู้ให้บริการไม่ได้ยืนยันสลิป");
  // Cached duplicate results can omit request echoes. Binding is the server-owned
  // request and immutable order evidence, not an optional provider remark.
  if (details.isDuplicate !== undefined && typeof details.isDuplicate !== "boolean") throw Error("ผลตรวจรายการซ้ำไม่ถูกต้อง");
  if ((details.isAmountMatched !== undefined && details.isAmountMatched !== true) || [details.amountInSlip, details.amountInOrder, details.requestedAmount].some(v => v !== undefined && satang(v) !== order.amount_satang)) throw Error("ยอดตรวจสอบไม่ตรงกับคำสั่งซื้อ");
  // Domestic rawSlip amounts are THB; reject any explicit foreign currency.
  if ((data.countryCode !== undefined && data.countryCode !== "TH") || [local.currency, amount.currency, details.currency].some(c => c !== undefined && c !== "" && !isThaiBahtCurrency(c))) throw Error("รองรับการชำระเงินบาทในประเทศไทยเท่านั้น");
  if (satang(amount.amount) !== order.amount_satang || (local.amount !== undefined && isThaiBahtCurrency(local.currency) && satang(local.amount) !== order.amount_satang)) throw Error("ยอดโอนไม่ตรงกับคำสั่งซื้อ");
  if (typeof data.date !== "string" || !z.iso.datetime({ offset: true }).safeParse(data.date).success || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(data.date)) throw Error("เวลาสลิปไม่ถูกต้อง");
  const paidAt = Date.parse(data.date);
  if (!Number.isFinite(paidAt) || paidAt < Date.parse(order.created_at) - SLIP_TOLERANCE_MS || paidAt > Date.parse(order.expires_at) || paidAt > now + SLIP_TOLERANCE_MS) throw Error("เวลาการโอนอยู่นอกช่วงคำสั่งซื้อ");
  const receiver = object(data.receiver), bank = object(receiver.bank), account = object(receiver.account);
  const bankAccount = object(account.bank), proxy = object(account.proxy), expected = order.receiver_snapshot;
  const matched = object(details.matchedAccount), matchedBank = object(matched.bank);
  const expectedNumber = fullDigits(expected.bankAccount);
  const matchedNumber = fullDigits(matched.bankNumber);
  const matchedName = typeof matched.nameTh === "string" ? matched.nameTh : typeof matched.name === "string" ? matched.name : "";
  if (matchedBank.code === "PROMPTPAY") {
    const number = mobile(matched.bankNumber), expectedMobile = mobile(expected.promptpay);
    if (!number || number !== expectedMobile || !matchedName || normalizeReceiverName(matchedName) !== normalizeReceiverName(expected.name)) throw Error("PromptPay ที่ลงทะเบียนไม่ตรงกับผู้รับคำสั่งซื้อ");
    const mask = typeof proxy.account === "string" ? proxy.account.replace(/[ -]/g, "") : "";
    const full = mobile(proxy.account);
    if (proxy.type !== "MSISDN" || (full ? full !== number : !/^[0-9xX*]+$/.test(mask) || mask.length !== number.length || [...mask].some((c, i) => /[0-9]/.test(c) && c !== number[i]))) throw Error("PromptPay บนสลิปขัดกับผู้รับ");
    if (bank.id !== undefined && bank.id !== expected.bankCode) throw Error("ธนาคารบนสลิปขัดกับผู้รับ");
    if (bankAccount.account !== undefined || bankAccount.type !== undefined) {
      const raw = typeof bankAccount.account === "string" ? bankAccount.account.replace(/[ -]/g, "") : "";
      if (!expectedNumber || bankAccount.type !== "BANKAC" || !/^[0-9xX*]+$/.test(raw) || raw.length !== expectedNumber.length || [...raw].some((c, i) => /[0-9]/.test(c) && c !== expectedNumber[i])) throw Error("บัญชีบนสลิปขัดกับผู้รับ");
    }
    return { transRef: data.transRef, paidAt: new Date(paidAt).toISOString(), amountSatang: order.amount_satang, receiverEvidence: "REGISTERED_ACCOUNT_V2", providerStrategy: PROVIDER_STRATEGY, orderId: order.id, bankCode: expected.bankCode, receiverIdentity: { matchingType: "PROMPTPAY", providerBankCode: "PROMPTPAY", promptpay: number, bankAccount: "", name: matchedName, expectedName: expected.name, normalizedName: normalizeReceiverName(matchedName), bankCode: "PROMPTPAY" } };
  }
  if (!/^\d{3}$/.test(expected.bankCode) || bank.id !== expected.bankCode || matchedBank.code !== expected.bankCode) throw Error("ธนาคารผู้รับไม่ตรง");
  if (!expectedNumber || matchedNumber !== expectedNumber || !matchedName || normalizeReceiverName(matchedName) !== normalizeReceiverName(expected.name)) throw Error("บัญชีที่ลงทะเบียนไม่ตรงกับผู้รับคำสั่งซื้อ");
  // A mask is only a contradiction check, never proof of recipient identity.
  const visible = typeof bankAccount.account === "string" ? bankAccount.account.replace(/[ -]/g, "") : "";
  if (bankAccount.type !== "BANKAC" || !/^[0-9xX*]+$/.test(visible) || visible.length !== expectedNumber.length || [...visible].some((c, i) => /[0-9]/.test(c) && c !== expectedNumber[i])) throw Error("เลขบัญชีบนสลิปขัดกับบัญชีที่กำหนด");
  const fullProxy = proxy.type === "MSISDN" ? mobile(proxy.account) : null;
  if (fullProxy && fullProxy !== expected.promptpay) throw Error("ข้อมูลผู้รับเต็มขัดกับบัญชีที่กำหนด");
  return { transRef: data.transRef, paidAt: new Date(paidAt).toISOString(), amountSatang: order.amount_satang, receiverEvidence: "REGISTERED_ACCOUNT_V2", providerStrategy: PROVIDER_STRATEGY, orderId: order.id, bankCode: expected.bankCode, receiverIdentity: { matchingType: "BANK_ACCOUNT", providerBankCode: expected.bankCode, bankAccount: matchedNumber, name: matchedName, expectedName: expected.name, normalizedName: normalizeReceiverName(matchedName), bankCode: expected.bankCode } };
}

export function validImageSignature(type: string, bytes: Uint8Array): boolean {
  const b = Buffer.from(bytes);
  if (type === "image/jpeg") return b.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (type === "image/png") return b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/gif") return /^GIF8[79]a/.test(b.toString("ascii", 0, 6));
  return type === "image/webp" && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
}
