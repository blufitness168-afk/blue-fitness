import type { MockPackage } from "./mock-data";

// Minutes from midnight; 24:00 is valid only as the exclusive closing bound.
// Kept independent of Date/time zones for catalog input and Bangkok local checks.
export function packageCatalogDailySlot(value: unknown): { startMinute: number; endMinute: number } | null {
  if (typeof value !== "string" || value.length !== 11 || !/^([01]\d|2[0-3]):[0-5]\d-(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(value)) return null;
  const [start, end] = value.split("-").map(time => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  });
  return start < end ? { startMinute: start, endMinute: end } : null;
}

export const PACKAGE_BONUS_POINTS_MAX = 1_000_000;

export interface PackageCatalogItem extends Omit<MockPackage, "timeSlot"> {
  timeSlot: string;
  version: number;
  catalogVersion?: number;
  priceSatang?: number;
  bonusPoints?: number; // Older catalog responses and order snapshots omit it.
}
