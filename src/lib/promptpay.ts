/**
 * EMVCo PromptPay QR Code Payload Generator
 * Supports Thai mobile numbers and Tax IDs with exact amount
 */

function formatTLV(id: string, value: string): string {
  const len = ("00" + value.length).slice(-2);
  return id + len + value;
}

function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    let x = ((crc >> 8) ^ data.charCodeAt(i)) & 0xff;
    x ^= x >> 4;
    crc = ((crc << 8) ^ (x << 12) ^ (x << 5) ^ x) & 0xffff;
  }
  return ("0000" + crc.toString(16).toUpperCase()).slice(-4);
}

export function generatePromptPayPayload(
  target: string, // phone: "0897720282" or "089-772-0282"
  amount?: number
): string {
  // Clean phone number
  const cleanTarget = target.replace(/[^0-9]/g, "");
  let formattedTarget = cleanTarget;

  // Phone number (10 digits)
  if (cleanTarget.length === 10 && cleanTarget.startsWith("0")) {
    formattedTarget = "0066" + cleanTarget.slice(1);
  }

  // Tag 29: Merchant Account Information - PromptPay
  let tag29 = "";
  if (formattedTarget.length === 13) {
    // 01: Mobile Number
    tag29 =
      formatTLV("00", "A000000677010111") +
      formatTLV("01", formattedTarget);
  } else {
    // 02: Tax ID / National ID (13 digits)
    tag29 =
      formatTLV("00", "A000000677010111") +
      formatTLV("02", formattedTarget);
  }

  let payload =
    formatTLV("00", "01") + // Payload Format Indicator
    formatTLV("01", amount ? "12" : "11") + // Point of Initiation Method (12: Dynamic, 11: Static)
    formatTLV("29", tag29) +
    formatTLV("53", "764") + // Transaction Currency: THB
    formatTLV("58", "TH"); // Country Code: TH

  if (amount && amount > 0) {
    payload += formatTLV("54", amount.toFixed(2)); // Transaction Amount
  }

  payload += "6304"; // CRC Tag
  const checksum = crc16(payload);
  return payload + checksum;
}
