import "server-only";
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { authSessions, members } from "@/db/schema";
import type { MemberProfileInput } from "./registration";
import { hasRole, type Role } from "./policy";

export const SESSION_COOKIE = "blu_session";
const sessionMs = 7 * 24 * 60 * 60 * 1000;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const hashSignupTicket = hashToken;
export type OtpPurpose = "LOGIN" | "REGISTER";

function sqlClient() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
  return neon(process.env.DATABASE_URL);
}

function codeHash(challengeId: string, code: string) {
  const secret = process.env.SMS_API_SECRET;
  if (!secret) throw new Error("SMS_API_SECRET is missing");
  return createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex");
}

export async function sendOtp(phone: string, purpose: OtpPurpose = "LOGIN"): Promise<{ challengeId: string } | null> {
  const key = process.env.SMS_API_KEY;
  const secret = process.env.SMS_API_SECRET;
  const sender = process.env.SMS_SENDER_NAME;
  if (!key || !secret || !sender) throw new Error("SMS unavailable");
  const challengeId = randomBytes(16).toString("hex");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const sql = sqlClient();
  // Serializable predicate reads prevent concurrent requests from bypassing the per-phone quota.
  let rows: Record<string, unknown>[] = [];
  for (let retry = 0; retry < 3; retry++) {
    try {
      const [reserved] = await sql.transaction([sql`
        INSERT INTO auth_otp_challenges (phone, challenge_id, code_hash, purpose, expires_at)
        SELECT ${phone}, ${challengeId}, ${codeHash(challengeId, code)}, ${purpose}, now() + interval '5 minutes'
        WHERE ((${purpose} = 'LOGIN' AND EXISTS (SELECT 1 FROM members WHERE phone = ${phone} AND status <> 'SUSPENDED'))
          OR (${purpose} = 'REGISTER' AND NOT EXISTS (SELECT 1 FROM members WHERE phone = ${phone})))
          AND (SELECT count(*) FROM auth_otp_challenges WHERE phone = ${phone} AND created_at > now() - interval '1 minute') = 0
          AND (SELECT count(*) FROM auth_otp_challenges WHERE phone = ${phone} AND created_at > now() - interval '1 hour') < 3
          AND (SELECT count(*) FROM auth_otp_challenges WHERE phone = ${phone} AND created_at > now() - interval '1 day') < 10
          AND (SELECT count(*) FROM auth_otp_challenges WHERE created_at > now() - interval '1 hour') < 3000
        RETURNING id
      `], { isolationLevel: "Serializable" });
      rows = reserved;
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "40001" || retry === 2) throw error;
    }
  }
  if (rows.length === 0) return null;

  try {
    // Same documented ThaiBulkSMS v2 payload as /api/test-services; never log the body or provider response.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("https://api-v2.thaibulksms.com/sms", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ msisdn: phone, message: `[Blu Fitness] ${purpose === "REGISTER" ? "รหัสยืนยันสมัครสมาชิก" : "รหัสเข้าสู่ระบบ"} ${code} (หมดอายุใน 5 นาที)`, sender }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("SMS unavailable");
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || "error" in result || ("success" in result && result.success === false)) {
        throw new Error("SMS unavailable");
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // A timeout may mean the provider accepted the message. In all cases the code is invalidated.
    await sql`UPDATE auth_otp_challenges SET consumed_at = now() WHERE challenge_id = ${challengeId} AND consumed_at IS NULL`;
    throw new Error("SMS unavailable");
  }
  return { challengeId };
}

export async function verifyOtp(challengeId: string, code: string): Promise<{ purpose: "LOGIN"; token: string; expiresAt: Date } | { purpose: "REGISTER"; ticket: string } | null> {
  const sql = sqlClient();
  const digest = codeHash(challengeId, code);
  // One conditional UPDATE counts every guess and consumes a matching code exactly once.
  const rows = await sql`
    UPDATE auth_otp_challenges AS c
    SET attempts = c.attempts + 1,
        consumed_at = CASE WHEN c.code_hash = ${digest} THEN now() ELSE NULL END
    WHERE c.challenge_id = ${challengeId}
      AND c.consumed_at IS NULL AND c.expires_at > now() AND c.attempts < c.max_attempts
      AND NOT EXISTS (
        SELECT 1 FROM auth_otp_challenges newer
        WHERE newer.phone = c.phone AND newer.id > c.id
      )
    RETURNING c.phone, c.purpose, (c.code_hash = ${digest}) AS matched
  `;
  if (rows.length !== 1 || rows[0].matched !== true) return null;
  if (rows[0].purpose === "REGISTER") {
    const ticket = randomBytes(32).toString("hex");
    const sql = sqlClient();
    await sql`INSERT INTO auth_signup_tickets (phone, token_hash, expires_at) VALUES (${rows[0].phone as string}, ${hashSignupTicket(ticket)}, now() + interval '15 minutes')`;
    return { purpose: "REGISTER", ticket };
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionMs);
  const inserted = await sql`
    INSERT INTO auth_sessions (member_id, token_hash, expires_at)
    SELECT id, ${hashToken(token)}, ${expiresAt}
    FROM members WHERE phone = ${rows[0].phone as string} AND status <> 'SUSPENDED'
    RETURNING id
  `;
  return inserted.length === 1 ? { purpose: "LOGIN", token, expiresAt } : null;
}

export async function completeRegistration(ticket: string, profile: MemberProfileInput): Promise<{ token: string; expiresAt: Date } | null> {
  const sql = sqlClient();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionMs);
  let memberRows: Record<string, unknown>[];
  try {
    memberRows = await sql`
    WITH consumed AS (
      UPDATE auth_signup_tickets SET consumed_at = now()
      WHERE token_hash = ${hashSignupTicket(ticket)} AND consumed_at IS NULL AND expires_at > now()
      RETURNING phone
    ), allocated AS (
      SELECT phone, nextval(pg_get_serial_sequence('members', 'id'))::integer AS id FROM consumed
    ), inserted AS (
      INSERT INTO members (id, phone, full_name, nickname, gender, birth_day, birth_month, emergency_name, emergency_phone, emergency_relation, member_code, status)
      SELECT id, phone, ${profile.fullName}, ${profile.nickname || null}, ${profile.gender}, ${profile.birthDay}, ${profile.birthMonth},
        ${profile.emergencyName || null}, ${profile.emergencyPhone || null}, ${profile.emergencyRelation || null}, 'BLU-' || id::text, 'PENDING'
      FROM allocated RETURNING id
    ), created_session AS (
      INSERT INTO auth_sessions (member_id, token_hash, expires_at)
      SELECT id, ${hashToken(token)}, ${expiresAt} FROM inserted RETURNING member_id
    )
    SELECT member_id FROM created_session
  `;
  } catch (error) {
    const dbError = error as { code?: unknown; constraint?: unknown };
    console.error("[auth/register/complete] member insert failed", {
      code: typeof dbError.code === "string" ? dbError.code : "unknown",
      constraint: typeof dbError.constraint === "string" ? dbError.constraint : undefined,
    });
    throw error;
  }
  return memberRows.length === 1 ? { token, expiresAt } : null;
}

export async function getCurrentMember() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const rows = await db.select({ member: members }).from(authSessions)
    .innerJoin(members, eq(authSessions.memberId, members.id))
    .where(and(eq(authSessions.tokenHash, hashToken(token)), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date())))
    .limit(1);
  const member = rows[0]?.member;
  return member && member.status !== "SUSPENDED" ? member : null;
}

// Use in server layouts/pages; throws if unauthenticated or lacking the requested persisted role.
export async function requireRole(allowed: readonly Role[]) {
  const member = await getCurrentMember();
  if (!member || !hasRole(member.role, allowed)) throw new Error("Forbidden");
  return member;
}

export async function revokeCurrentSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
  await db.update(authSessions).set({ revokedAt: new Date() })
    .where(and(eq(authSessions.tokenHash, hashToken(token)), isNull(authSessions.revokedAt)));
}
