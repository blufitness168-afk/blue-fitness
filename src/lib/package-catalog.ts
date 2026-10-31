import type { MockPackage } from "./mock-data";

export interface PackageCatalogItem extends MockPackage {
  version: number;
  catalogVersion?: number;
  priceSatang?: number;
}
