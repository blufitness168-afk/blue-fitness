import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export class PasswordWorkLimitError extends Error {
  constructor() { super("Password hashing is busy"); }
}
const runtime = globalThis as typeof globalThis & { __bluPasswordWork?: { activeJobs: number } };
const work = runtime.__bluPasswordWork ??= { activeJobs: 0 };
const maxJobs = 2;

async function derive(password: string, salt: string): Promise<Buffer> {
  // Fail closed without a queue: attacker-controlled requests cannot accumulate scrypt jobs.
  if (work.activeJobs >= maxJobs) throw new PasswordWorkLimitError();
  work.activeJobs++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally {
    work.activeJobs--;
  }
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$32768$8$1$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string | null | undefined) {
  const parts = encoded?.split("$");
  const valid = parts?.length === 6 && parts[0] === "scrypt" && parts[1] === "32768" && parts[2] === "8" && parts[3] === "1" && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  const key = await derive(password, valid ? parts![4] : "00000000000000000000000000000000");
  const expected = valid ? Buffer.from(parts![5], "hex") : Buffer.alloc(64);
  return timingSafeEqual(key, expected) && Boolean(valid);
}
