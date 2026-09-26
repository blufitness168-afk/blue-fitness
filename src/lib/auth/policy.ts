export const roles = ["MEMBER", "ADMIN", "OWNER"] as const;
export type Role = (typeof roles)[number];

export function hasRole(actual: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(actual);
}

export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 30) return null;
  const phone = input.replace(/[\s()-]/g, "");
  if (/^\+66[689]\d{8}$/.test(phone)) return `0${phone.slice(3)}`;
  if (/^66[689]\d{8}$/.test(phone)) return `0${phone.slice(2)}`;
  return /^0[689]\d{8}$/.test(phone) ? phone : null;
}

export function validCode(input: unknown): input is string {
  return typeof input === "string" && /^\d{6}$/.test(input);
}

export function validChallengeId(input: unknown): input is string {
  return typeof input === "string" && /^[a-f0-9]{32}$/.test(input);
}

export function canAttempt(attempts: number, maxAttempts: number, expiresAt: Date, consumedAt: Date | null, now: Date): boolean {
  return !consumedAt && attempts >= 0 && attempts < maxAttempts && expiresAt.getTime() > now.getTime();
}
