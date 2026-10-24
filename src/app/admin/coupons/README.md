# Real benefits admin — prepared migration, not deployed

## Scope / deployment

- `/admin/coupons` and `/admin/promo-codes` use `/api/admin/benefits/[action]`; no browser mock/localStorage stores.
- Review `src/db/migrations/20261024_real_benefits_admin.sql` before applying manually. **The agent has not applied it.** Requires existing password/welcome, real payment, PromptPay and kiosk migrations, including `auth_sessions.mode`.
- Deploy migration together with `payment-server.ts` / `payment-policy.ts`. Until migrated, benefits fail closed (503) and order creation cannot use the new persisted promos. Never enable payments with mismatched DB/server versions. Stop writers while deploying; function rename/wrapper is transactional.
- SQL is SECURITY INVOKER. Use the server-owned database role; if using a different runtime role, explicitly grant required table/function permissions. Never expose DATABASE_URL/client SQL access. Public EXECUTE on the admin action and renamed legacy order function is revoked.
- No shared Drizzle schema changes, enum extensions, automatic backfill, fake PAID, SMS or provider calls. Existing payment settlement/evidence functions are untouched.

## Business rules (fail closed)

- ADMIN/OWNER, non-suspended, unexpired, non-revoked **NORMAL** session required, checked in server and again in SQL. KIOSK sessions cannot administer benefits.
- Immutable definitions: create or deactivate; do not rewrite benefits already issued. Deactivation blocks new grants/new promo orders, but does not revoke previously granted coupons or alter existing order snapshots. Cancel individual unused assignments explicitly.
- One assignment per definition/member, including cancelled assignments. To reissue intentionally, create a new definition. No bulk unsolicited grants.
- Coupon types use actual `FRIEND_PASS` and `EXTRA_DAYS` enum values. Welcome `FREE_ENTRY` remains untouched and consumed through kiosk/frontdesk, not this endpoint. Legacy FRIEND_PASS/EXTRA_DAYS in `coupons` can also be consumed safely.
- Coupon consumption locks member before coupon, checks expiry/status/quota/suspension, and appends actor audit plus consumption ledger atomically. UUID replay returns the original result; another UUID does not bypass exhausted quota.
- EXTRA_DAYS requires quota=1 and an ACTIVE, not-yet-expired membership. Add exact 24-hour days to the existing expiry once; never activate an inactive member or write a payment/points entry.
- FRIEND_PASS requires an explicit non-sensitive guest/visit reference. Each use writes `benefit_consumptions`. It does not create paid membership, points, a generic checkin or gate permission. Staff must verify guest admission/hours at the desk; automated guest gate integration is not included.
- Cancel unused assignments only. Consumed coupons and used/reserved promos cannot be retroactively cancelled. Coupon cancellation uses existing `EXPIRED` enum + explicit assignment cancellation metadata (not an invented CANCELLED enum).
- Promos must be assigned to the purchasing member. One successful/reserved order per assignment, plus definition-wide usage limit. FIXED values, minimums and caps are **integer satang**; PERCENT values are integer 1–100. Zero/negative payable orders are rejected.
- `payment-policy.ts` still uses the existing package catalog; only mock promo definitions are removed. `payment-server.ts` passes a normalized code, never a marketing discount. SQL resolves the persisted definition and rebuilds discount, payable amount and points under locks in the same transaction as order creation. It also enforces assignment, active flag, expiry, minimum, cap, global quota and same-key payload identity.
- `benefit_promo_reservations` records assignment, order and purchasing actor. Actual `package_payment_orders.status` is authoritative: PENDING is **not** paid. PAID consumes capacity; pending orders reserve until upload deadline, and PROCESSING/UNKNOWN/VERIFIED evidence continues to reserve after deadline. Safely REJECTED/expired-with-no-inflight orders release capacity. Existing provider finalization is the only settlement path.
- Existing pending mock-promo orders retain immutable snapshots; no retroactive rewriting. Existing orders with a reused code conservatively count toward global quota.
- Audit and consumption/reservation rows are append-only. UI retains the same request UUID after network/5xx uncertainty and offers an explicit retry. Do not issue a new request key just to bypass uncertain results.
- Admin lists display latest 500 coupons/assignments/promo reservations, latest 100 audit entries; definitions are listed completely. Server does not infer consumption from marketing counters.

## Validation

```sh
node --test src/lib/real-benefits-admin-server.test.mjs
pnpm exec eslint src/app/admin/coupons src/app/admin/promo-codes src/app/api/admin/benefits src/lib/real-benefits-admin-server.ts src/lib/payment-server.ts src/lib/payment-policy.ts
pnpm exec tsc --noEmit
```

Tests use the existing isolated PGlite harness at `.local-db/payment-sql-tests` and never connect to production, SMS or payment providers. They compile the actual payment/PromptPay/kiosk/benefits migrations against real coupon enums, and exercise auth, replay, one-time bonus expiry, guest tracking, cancellation, welcome isolation, authoritative pricing, quota and unresolved evidence reservation. The clock override exists only inside the disposable test database. Single-connection WASM proves transactional logic, **not** multi-connection race acceptance; run parallel-session PostgreSQL UAT before deployment.

Regression command `node --test src/lib/payment-policy.test.mjs src/lib/payment-server.test.mjs`: 24/26 passed at implementation. Two old assertions still expect mock discount behavior (policy SAVE100 and server-side pre-SQL discount). These test files are outside the owned scope and were not edited. New tests cover real persisted SQL pricing instead. Browser UAT and multi-connection PostgreSQL stress tests have not been run.
