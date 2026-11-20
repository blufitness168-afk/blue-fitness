import "server-only";

// Enable only after the R4 paid read objects are deployed and available to the app role.
export function staffPaidReadsEnabled() {
  return process.env.ENABLE_STAFF_PAID_READS === "true";
}
