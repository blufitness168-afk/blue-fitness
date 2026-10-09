import "server-only";
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { authSessions, members } from "@/db/schema";
import { hashPassword, verifyPassword } from "./password";
import type { MemberProfileInput } from "./registration";
import { hasRole, type Role } from "./policy";

export const SESSION_COOKIE = "blu_session";
const sessionMs = 7 * 24 * 60 * 60 * 1000;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const hashSignupTicket = hashToken;
export type OtpPurpose = "REGISTER" | "PASSWORD_SETUP" | "PASSWORD_RESET";

function sqlClient() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
  return neon(process.env.DATABASE_URL);
}

function codeHash(challengeId: string, code: string) {
  const secret = process.env.SMS_API_SECRET;
  if (!secret) throw new Error("SMS_API_SECRET is missing");
  return createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex");
}

export async function sendOtp(phone: string, purpose: OtpPurpose): Promise<{ challengeId: string } | null> {
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
        INSERT INTO auth_otp_challenges (phone, challenge_id, code_hash, purpose, password_hash_at_issue, expires_at)
        SELECT ${phone}, ${challengeId}, ${codeHash(challengeId, code)}, ${purpose}, (SELECT password_hash FROM members WHERE phone = ${phone}), now() + interval '5 minutes'
        WHERE ((${purpose} IN ('PASSWORD_SETUP', 'PASSWORD_RESET') AND EXISTS (SELECT 1 FROM members WHERE phone = ${phone} AND status <> 'SUSPENDED' AND ((${purpose} = 'PASSWORD_SETUP' AND password_hash IS NULL) OR (${purpose} = 'PASSWORD_RESET' AND password_hash IS NOT NULL))))
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
        body: new URLSearchParams({ msisdn: phone, message: `[Blu Fitness] ${purpose === "REGISTER" ? "รหัสยืนยันสมัครสมาชิก" : "รหัสยืนยันตั้งรหัสผ่าน"} ${code} (หมดอายุใน 5 นาที)`, sender }),
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

export async function verifyOtp(challengeId: string, code: string): Promise<{ purpose: OtpPurpose; ticket: string } | null> {
  const sql = sqlClient();
  const ticket = randomBytes(32).toString("hex");
  const digest = codeHash(challengeId, code);
  const [rows] = await sql.transaction([sql`
    WITH verified AS (
      UPDATE auth_otp_challenges c SET attempts = c.attempts + 1,
        consumed_at = CASE WHEN c.code_hash = ${digest} THEN now() ELSE NULL END
      WHERE c.challenge_id = ${challengeId} AND c.purpose <> 'LOGIN'
        AND (c.purpose = 'REGISTER' OR EXISTS (
          SELECT 1 FROM members m WHERE m.phone = c.phone AND m.status <> 'SUSPENDED'
            AND m.password_hash IS NOT DISTINCT FROM c.password_hash_at_issue
            AND ((c.purpose = 'PASSWORD_SETUP' AND m.password_hash IS NULL) OR (c.purpose = 'PASSWORD_RESET' AND m.password_hash IS NOT NULL))
        ))
        AND c.consumed_at IS NULL AND c.expires_at > now() AND c.attempts < c.max_attempts
        AND NOT EXISTS (SELECT 1 FROM auth_otp_challenges newer WHERE newer.phone = c.phone AND newer.purpose = c.purpose AND newer.id > c.id)
      RETURNING c.phone, c.purpose, c.password_hash_at_issue, c.code_hash = ${digest} AS matched
    ), signup AS (
      INSERT INTO auth_signup_tickets (phone, token_hash, expires_at)
      SELECT phone, ${hashToken(ticket)}, now() + interval '15 minutes' FROM verified WHERE matched AND purpose = 'REGISTER' RETURNING 'REGISTER'::text AS purpose
    ), password AS (
      INSERT INTO auth_password_tickets (phone, purpose, password_hash_at_issue, token_hash, expires_at)
      SELECT v.phone, v.purpose, v.password_hash_at_issue, ${hashToken(ticket)}, now() + interval '10 minutes' FROM verified v JOIN members m ON m.phone = v.phone WHERE matched AND v.purpose IN ('PASSWORD_SETUP', 'PASSWORD_RESET') AND m.status <> 'SUSPENDED' AND m.password_hash IS NOT DISTINCT FROM v.password_hash_at_issue RETURNING purpose::text
    ) SELECT purpose FROM signup UNION ALL SELECT purpose FROM password
  `], { isolationLevel: "Serializable" });
  return rows.length === 1 ? { purpose: rows[0].purpose as OtpPurpose, ticket } : null;
}

export async function loginPassword(phone: string, password: string) {
  const sql = sqlClient();
  const reserved = await sql`
    INSERT INTO auth_login_limits (phone, attempts, window_start) VALUES (${phone}, 1, now())
    ON CONFLICT (phone) DO UPDATE SET
      attempts = CASE WHEN auth_login_limits.window_start <= now() - interval '15 minutes' THEN 1 ELSE auth_login_limits.attempts + 1 END,
      window_start = CASE WHEN auth_login_limits.window_start <= now() - interval '15 minutes' THEN now() ELSE auth_login_limits.window_start END
    WHERE auth_login_limits.window_start <= now() - interval '15 minutes' OR auth_login_limits.attempts < 5 RETURNING phone
  `;
  if (!reserved.length) return { limited: true } as const;
  const rows = await sql`SELECT id, password_hash, status FROM members WHERE phone = ${phone}`;
  const member = rows[0];
  const valid = await verifyPassword(password, member?.password_hash as string | null);
  if (!valid || !member || member.status === 'SUSPENDED') return null;
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionMs);
  const [inserted] = await sql.transaction([sql`INSERT INTO auth_sessions (member_id, token_hash, expires_at)
    SELECT id, ${hashToken(token)}, ${expiresAt} FROM members
    WHERE id = ${member.id as number} AND password_hash = ${member.password_hash as string} AND status <> 'SUSPENDED' RETURNING id`], { isolationLevel: "Serializable" });
  return inserted.length ? { token, expiresAt } : null;
}

export async function completePassword(ticket: string, purpose: "PASSWORD_SETUP" | "PASSWORD_RESET", password: string) {
  const sql = sqlClient();
  // Claim a valid ticket once before scrypt, so concurrent replays cannot fan out CPU work.
  const claimed = await sql`
    UPDATE auth_password_tickets t SET hash_started_at = now()
    WHERE t.token_hash = ${hashToken(ticket)} AND t.purpose = ${purpose}
      AND t.consumed_at IS NULL AND t.expires_at > now() AND t.hash_started_at IS NULL
      AND EXISTS (SELECT 1 FROM members m WHERE m.phone = t.phone AND m.status <> 'SUSPENDED'
        AND m.password_hash IS NOT DISTINCT FROM t.password_hash_at_issue
        AND ((${purpose} = 'PASSWORD_SETUP' AND m.password_hash IS NULL) OR (${purpose} = 'PASSWORD_RESET' AND m.password_hash IS NOT NULL)))
    RETURNING t.id
  `;
  if (claimed.length !== 1) return false;
  const digest = await hashPassword(password);
  const [rows] = await sql.transaction([sql`
    WITH consumed AS (
      UPDATE auth_password_tickets SET consumed_at = now()
      WHERE id = ${claimed[0].id as number} AND token_hash = ${hashToken(ticket)} AND purpose = ${purpose} AND hash_started_at IS NOT NULL AND consumed_at IS NULL AND expires_at > now() RETURNING phone, password_hash_at_issue
    ), changed AS (
      UPDATE members SET password_hash = ${digest}, updated_at = now()
      WHERE EXISTS (SELECT 1 FROM consumed c WHERE c.phone = members.phone AND members.password_hash IS NOT DISTINCT FROM c.password_hash_at_issue) AND status <> 'SUSPENDED'
        AND ((${purpose} = 'PASSWORD_SETUP' AND password_hash IS NULL) OR (${purpose} = 'PASSWORD_RESET' AND password_hash IS NOT NULL)) RETURNING id, phone
    ), revoked AS (
      UPDATE auth_sessions SET revoked_at = now() WHERE member_id IN (SELECT id FROM changed) AND revoked_at IS NULL RETURNING id
    ), invalidated_challenges AS (
      UPDATE auth_otp_challenges SET consumed_at = now()
      WHERE phone IN (SELECT phone FROM changed) AND purpose IN ('PASSWORD_SETUP', 'PASSWORD_RESET') AND consumed_at IS NULL RETURNING id
    ), invalidated_tickets AS (
      UPDATE auth_password_tickets SET consumed_at = now()
      WHERE phone IN (SELECT phone FROM changed) AND id <> ${claimed[0].id as number} AND consumed_at IS NULL RETURNING id
    ) SELECT id FROM changed
  `], { isolationLevel: "Serializable" });
  return rows.length === 1;
}

export async function completeRegistration(ticket: string, profile: MemberProfileInput): Promise<{ token: string; expiresAt: Date } | null> {
  const sql = sqlClient();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionMs);
  const claimed = await sql`
    UPDATE auth_signup_tickets t SET hash_started_at = now()
    WHERE t.token_hash = ${hashSignupTicket(ticket)} AND t.consumed_at IS NULL
      AND t.expires_at > now() AND t.hash_started_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM members WHERE phone = t.phone)
    RETURNING t.id
  `;
  if (claimed.length !== 1) return null;
  const passwordHash = await hashPassword(profile.password);
  let memberRows: Record<string, unknown>[];
  try {
    memberRows = await sql`
    WITH consumed AS (
      UPDATE auth_signup_tickets SET consumed_at = now()
      WHERE id = ${claimed[0].id as number} AND token_hash = ${hashSignupTicket(ticket)} AND hash_started_at IS NOT NULL AND consumed_at IS NULL AND expires_at > now()
      RETURNING phone
    ), allocated AS (
      SELECT phone, nextval(pg_get_serial_sequence('members', 'id'))::integer AS id FROM consumed
    ), inserted AS (
      INSERT INTO members (id, phone, password_hash, full_name, nickname, gender, birth_day, birth_month, emergency_name, emergency_phone, emergency_relation, member_code, status)
      SELECT id, phone, ${passwordHash}, ${profile.fullName}, ${profile.nickname || null}, ${profile.gender}, ${profile.birthDay}, ${profile.birthMonth},
        ${profile.emergencyName || null}, ${profile.emergencyPhone || null}, ${profile.emergencyRelation || null}, 'BLU-' || id::text, 'PENDING'
      FROM allocated RETURNING id
    ), welcome AS (
      INSERT INTO coupons (member_id, type, source, title, total_quota, expire_date)
      SELECT id, 'FREE_ENTRY', 'WELCOME_REGISTRATION', 'คูปองต้อนรับ เล่นฟรี 1 ครั้ง', 1, now() + interval '30 days' FROM inserted RETURNING id
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
    if (dbError.code === "23505") return null;
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
  if (!member || member.status === "SUSPENDED") return null;
  const { passwordHash: _passwordHash, ...safeMember } = member;
  void _passwordHash;
  return safeMember;
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
