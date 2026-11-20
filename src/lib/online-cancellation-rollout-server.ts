import "server-only";
import type { NeonQueryFunction } from "@neondatabase/serverless";

export function onlineCancellationEnabled() {
  return process.env.ENABLE_ONLINE_CANCELLATION === "true" && process.env.ENABLE_ONLINE_CANCELLATION_READS === "true";
}

export async function onlineCancellationReads(sql: NeonQueryFunction<false, false>) {
  if (process.env.ENABLE_ONLINE_CANCELLATION_READS !== "true") return false;
  // Detect an unmigrated DB, not the writer switch. Never fall back on a partial install or a failed read.
  const [row] = await sql`SELECT to_regclass('r4_online_private.cancellations') IS NOT NULL AS history,
    to_regclass('r4_online_private.active_paid_orders') IS NOT NULL AS active,
    to_regclass('r4_online_private.point_reversals') IS NOT NULL AS points,
    to_regclass('r4_online_private.reader_cutover') IS NOT NULL AS cutover`;
  if (row?.history === false && row.active === false && row.points === false && row.cutover === false) return false;
  if (!row?.history || !row.active || !row.points || !row.cutover) throw Error("Incomplete online cancellation reader stack");
  return true;
}
