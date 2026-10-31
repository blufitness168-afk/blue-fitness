# Bangkok receiver isolated UAT

## Latest result after fix — 2026-10-31

Added incremental `20261031_payment_receiver_bank.sql`. The isolated script now reproduces the old failure first, validates deployment hardening, applies the ninth migration, then verifies BBL BANK_ACCOUNT, KBank BANK_ACCOUNT and BBL PROMPTPAY settle exactly once. SQL negative tests cover bank/account/name/order/amount, invalid/missing bank snapshot, KIOSK and global duplicate transfer references. Exact function rewrite, preserved ACL/NORMAL guard and safe repeat rejection pass. Deployment runner regression tests cover literal JavaScript dollar replacement. Full project suite: **234/234 PASS**, TypeScript/lint/diff-check pass.

Applied to the DB selected explicitly from `.env.production` after independent review and backup `.local-db/backup-2026-10-31T09-20-54.249Z/`. Data in all **30 original public tables unchanged**, function owner/ACL/search_path and all other function definitions unchanged. Only the obsolete bank guard changed. Transfers remain disabled. No provider/SMS/funds or synthetic PAID on the live DB. This fixes settlement compatibility but is not final real-slip acceptance or proof that Vercel has deployed the latest web code.

## Historical defect reproduction

Run: 2026-10-31
Command: `node scripts/bangkok-receiver-uat.mjs`
Result: completed successfully; assertions detected the expected defect. **Not a production readiness pass.**

## Scope and safety

- In-memory PGlite only; no persistent/live database connection, environment file reading, provider requests, SMS or funds.
- Synthetic receiver/account/name and provider response. Evidence is produced by the actual TypeScript `validateSlip()`; this does not certify a real provider response.
- Reuses the prerequisite schema from `src/lib/package-payment-benefits.test.mjs` without running that test module.
- Calls actual create/claim/finalize functions. Only isolated attempt evidence is injected after claiming a provider lease; orders are never directly set to PAID.
- No production code, migrations or environment configuration changed.

## Actual migration chain

1. `20261009_real_package_payments.sql`
2. `20261010_payment_promptpay.sql`
3. `20261024_kiosk.sql`
4. `20261024_real_benefits_admin.sql`
5. `20261024_real_rewards.sql`
6. `20261024_real_frontdesk.sql`
7. `20261024_real_finance.sql`
8. `20261025_package_payment_benefits.sql`

The installed finalizer definition is asserted to include the current NORMAL-session guard and literal BANK_ACCOUNT bank-code restriction. This run verifies repository migrations, not the deployment state of any live database.

## Results

| Case | Actual outcome |
| --- | --- |
| Bangkok bank `002`, BANK_ACCOUNT | Actual TS validation accepts; SQL raises exactly `Invalid payment evidence` |
| Effects after BANK_ACCOUNT exception | Complete member/order snapshots unchanged; order stays PENDING, attempt stays VERIFIED; amount unchanged, paid amount 0; no points credit, membership extension, checkin, coupon, point-ledger entry or transfer-ref claim |
| Bangkok bank `002`, PROMPTPAY | Actual TS validation accepts; SQL finalizer returns PAID |
| PROMPTPAY settlement | Paid amount equals server quote; points increase exactly by quote; membership increases by package duration (bonus days remain a separate coupon); two AVAILABLE coupons with exact quota/bonus/expiry; one ledger entry and one transfer reference; no checkin |
| PROMPTPAY replay | Complete order/member/count snapshots and coupon rows identical; no duplicate credit or benefits |

BANK_ACCOUNT rejection is an exception, **not** a terminal REJECTED order. Assertions explicitly require that exception; unexpected errors or missing rejection fail the script. Exit success means the reproduction and safety assertions passed, not that Bangkok BANK_ACCOUNT works.

## Root cause and limits

`src/db/migrations/20261010_payment_promptpay.sql:68` requires evidence `bankCode='004'` in the BANK_ACCOUNT branch even when the immutable receiver snapshot and both evidence bank codes correctly contain `002`. The PROMPTPAY branch instead uses PROMPTPAY identity codes while retaining `002` at the top level to match the receiver snapshot.

Account/name/mask negative TypeScript cases are outside this script's scope. No production fix or live verification was performed.
