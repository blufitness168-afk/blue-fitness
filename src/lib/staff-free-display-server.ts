import "server-only";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { z } from "zod";
import { SESSION_COOKIE } from "./auth/server";
import { packageCatalogDailySlot } from "./package-catalog";

const termsSchema = z.array(z.object({
  packageName: z.string().min(1).max(200),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  dailySlot: z.string().refine(slot => packageCatalogDailySlot(slot) !== null),
  status: z.enum(["SCHEDULED", "ACTIVE", "BLOCKED", "SUPERSEDED"]),
  source: z.literal("STAFF_TRANSFER").optional(),
}).strict());
export type StaffFreeDisplayTerm = z.infer<typeof termsSchema>[number];

// No target is accepted from the member page. SQL binds self to this cookie,
// or rechecks ADMIN/OWNER authorization for a resolved admin detail target.
export async function readStaffFreeTerms(targetCode: string | null = null): Promise<StaffFreeDisplayTerm[]> {

  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return [];
    const digest = createHash("sha256").update(token).digest("hex");
    if (!process.env.DATABASE_URL) throw new Error("Database unavailable");
    const sql = neon(process.env.DATABASE_URL);
    const [row] = await sql`SELECT r4_staff_private.display_terms(${digest},${targetCode}::text) AS terms`;
    return termsSchema.parse(row?.terms).filter(term =>
      term.source === "STAFF_TRANSFER" || process.env.ENABLE_STAFF_FREE_DISPLAY === "true");
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    // Missing schema/function/table during a staged rollout, or a changed session.
    if (!["3F000", "42883", "42P01", "42501"].includes(code ?? "")) {
      console.error("Staff-free entitlement display unavailable");
    }
    return [];
  }
}
