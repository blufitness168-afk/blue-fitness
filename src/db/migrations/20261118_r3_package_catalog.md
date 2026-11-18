# R3 catalog / daily-slot rollout

Prepared implementation; this document is not permission to access/apply to a live database.

## Coupled application + SQL change

The R3 application opens only `/admin/packages` to ADMIN. Existing dashboard,
member and finance page guards remain restricted. Catalog payloads contain package
configuration/prices, not sales/order totals or financial reports.

After the existing October payment/benefit/security/catalog/order-guard migrations,
apply these new files in this exact order:

1. `20261118_r3_package_catalog.sql`
2. `20261118_r3_package_catalog_checkin.sql`

Coordinate with the matching application release. Do not open custom-time sales
between the two migrations. Both kiosk and frontdesk must be upgraded before new
slots are sold. The existing `scripts/db-package-catalog-migrate.mjs` is pinned to
the October migration and is **not** an R3 deployment runner. Do not repurpose its
old SHA/fingerprint or bypass its guards to run this upgrade.

Before any authorized rollout: back up the database and function definitions/ACLs,
review installed prerequisites, ownership, named app-role grants and source drift,
use bounded lock/statement timeouts and a no-concurrent-DDL maintenance window.
The functions remain SECURITY INVOKER with pinned search paths and no PUBLIC
execute grants. A non-owner app database role needs EXECUTE on the two new time
helpers as well as its existing catalog/checkin/table privileges; do not grant
these to anonymous/public roles. Replacement functions retain their named ACLs.

These migrations never rewrite payment, member, coupon or checkin history.
Catalog create/update and audit are atomic, and catalog identity is allocated
under a table lock. Do not rerun migrations after an ambiguous outcome without
checking installed state. Do not use a destructive down migration after custom
packages have been sold; an old application/checkin rollback cannot safely serve
custom slots. Prefer disabling new sales and a reviewed forward fix.

## Time and compatibility

- One canonical `HH:mm-HH:mm` interval, strictly increasing, no overnight.
- Bangkok local day, opening inclusive, closing exclusive. `24:00` is closing only.
- This also makes the exact old 14:00/22:00 closing instant exclusive for paid
  entry (previous SQL allowed the exact closing instant). No snapshots change.
- Paid entry uses the immutable latest-PAID snapshot, not the edited catalog.
- Welcome-registration coupons retain the old 07:00 through 22:00 gate.
- No IN/OUT, entitlement overrides, time supplements, refunds, bonus formula or
  entitlement-provenance redesign is included. The existing latest-PAID selection
  and aggregated member expiry model remain; this is not a fix for stacked or
  individually reversed entitlements.

## Offline regression

Run from the project root with installed pnpm dependencies and an existing local
PGlite installation (the R3 SQL test fails rather than skips if missing):

```sh
node --test src/lib/package-catalog-r3.test.mjs src/lib/package-catalog-ui.test.mjs src/lib/package-catalog-server.test.mjs src/lib/package-catalog-storefront.test.mjs src/lib/package-catalog-sql.test.mjs src/lib/package-catalog-order-guard.test.mjs src/lib/admin-permissions.test.mjs src/lib/payment-policy.test.mjs src/lib/payment-server.test.mjs src/lib/real-checkin-server.test.mjs src/lib/kiosk-server.test.mjs
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint src/app/admin/packages/PackageCatalogClient.tsx src/app/page.tsx src/components/PaymentModal.tsx src/lib/package-catalog.ts src/lib/package-catalog-server.ts src/lib/admin-permissions.ts src/lib/package-catalog-r3.test.mjs src/lib/package-catalog-ui.test.mjs src/lib/package-catalog-server.test.mjs src/lib/package-catalog-storefront.test.mjs src/lib/admin-permissions.test.mjs
```

SQL tests execute the incremental PostgreSQL migration chain on synthetic data in
PGlite, including source-drift rejection, preserved function ACLs, old pending/PAID
snapshots, server pricing/insert guard, atomic audit failure, settlement/benefits,
frontdesk/kiosk boundaries, replay/bounce/auth, expiry and welcome coupons. Only
the test copies of checkin functions use a fixed clock; production accepts no
client clock. These are not real multi-connection PostgreSQL/concurrency, browser,
provider, migration-on-production or restore tests.
