# Real finance integration contract

## Deployment (manual only)

Review `src/db/migrations/20261024_real_finance.sql` and apply separately after auth and real package payments migrations. No application startup migration or historical/browser import. The page intentionally fails closed if migration is missing; it never falls back to mock data.

The SQL function uses INVOKER permissions. PUBLIC execution is revoked. If the application connects as a different role from the migration owner, an operator must grant that trusted role EXECUTE on `real_finance_action(text,text,uuid,jsonb)` plus required table/sequence permissions. Never give application credentials to a browser. Database credentials remain a trusted administrative boundary (not an end-user SQL sandbox).

## HTTP and server reads

- `GET /api/admin/finance/read` -> `{ data: { records: FinanceRecord[], audit: FinanceAudit[] } }` (no-store).
- Server consumers: `readRealFinance()` returns the same data, not an HTTP envelope. It revalidates a NORMAL, non-suspended OWNER session in SQL as well as application auth.
- `POST /api/admin/finance/create`: `{ requestKey, date, type, category, amount, note }`.
- `POST /api/admin/finance/update`: same fields plus `{ id, version }`.
- `POST /api/admin/finance/delete`: `{ requestKey, id, version, reason }`.
- Successful mutations return `{ data: { id, version } }`; refresh the read endpoint afterwards.
- JSON mutations must be same-origin and <=4096 bytes. Use UUID request keys; retry the exact action/body/key after an ambiguous failure. A key is scoped to its actor and cannot be reused with different canonical payloads/actions. Versions prevent lost updates across owners.
- `401`: absent/suspended login; `403`: non-owner/invalid SQL session; `400`: bad input; `409`: stale entry or request conflict; `503`: ambiguous/unavailable, retry identical request.

Amounts sent over HTTP are baht (up to two decimals); database mutations use integer satang. See `types.ts` for categories and public data shapes. Manual income must be explicitly non-package income and have an explanatory note. Operators must not manually re-enter package sales. This category rule cannot detect deliberately mislabeled notes.

## Accounting rules

With the R5 finance baseline, `records` contains active manual entries plus exactly one income row per PAID online order with non-null `confirmed_at`, dated in Asia/Bangkok. PAID rows without that timestamp are counted separately, not dated from `paid_at`. The amount is the actual `amount_satang` after discounts. The optional R4 stack adds its own staff renewals and cancellation/refund events. Package records are read-only; no order amount is inserted as a manual entry.

`20261204_R5_finance_lifecycle.sql` is prepared for the R5 finance reader **after** the complete R4 settlement/cancellation chain. It changes only the online income category. Where locked settlement evidence matches the order and the prior expiry matches a positively evidenced online term, `ต่อสมาชิก` includes purchases made while active and up to exactly 90 days after expiry; `สมัครใหม่` means a return more than 90 days after expiry. A prior term cancelled by the time of purchase or a staff term that could supersede the captured expiry prevents classification. A NULL expiry does not prove a first purchase. Legacy, unproved prior terms, and other ambiguous rows stay `แพ็กเกจ`. The original income and its category are retained on cancellation; the cancellation/refund has its own row. The existing Excel export reads the same categories with no writer changes.

Apply only after approved rehearsal using the actual backend principal; the invoker also needs read access to the referenced R4 evidence/staff relations. The migration grants nothing and refuses other reader definitions (including standalone October/R5). No backfill is needed or performed.

Deletion is audited soft cancellation, excluded from totals but retained with before/after snapshots and reason in audit. Edits are audited. Audit + request record + ledger mutation commit atomically. No payment, member points, or expiry writes occur.

Reads currently return the full ledger and audit (no silent truncation); large installations should add server-side pagination/aggregation before scale.

## Optional dashboard integration — not implemented here

An OWNER-only dashboard could call `readRealFinance()` and sum each active returned record exactly once using integer satang. Never combine this result with legacy/mock finance or an additional package-income query. Do not call it for ADMIN/MEMBER dashboard requests or expose its result to those roles. No dashboard files were changed.

## Isolated validation

`node --test src/lib/real-finance-server.test.mjs` mocks HTTP SQL calls and runs migration/CRUD assertions in the existing optional PGlite WASM harness. It never connects to DATABASE_URL. If that harness is unavailable, the SQL test explicitly skips. Run eslint on only the finance paths. Isolated TypeScript validation should include installed Next's `index.d.ts` ambient types along with the five finance TS/TSX entrypoints, with noEmit and incremental disabled.

### R4 online cancellation (default off)

Only for the October/R5 finance variants with the complete staff/evidence stack
required by `20261125_R4_online_cancellation.sql`. Do not assume an R6/R7
installation is supported by this migration. Under a separately approved rollout:

1. Install the pending database changes on the supported stack and deploy the app
   with `ENABLE_ONLINE_CANCELLATION_READS=true` and the writer still disabled.
2. Rehearse current package/history, wallet, and OWNER finance/XLSX with the actual
   backend role. Once **all serving app instances** use the cutover readers, the
   trusted migration/backend owner must insert the exact writer interlock:
   `INSERT INTO r4_online_private.reader_cutover (version) VALUES (1);`
3. Set `ENABLE_ONLINE_CANCELLATION=true` to expose preview/record to NORMAL OWNER
   sessions. The record action attests to a full refund already completed outside
   the app. No provider request is made. For an unconfirmed response, resend the
   same request rather than refunding again.

To pause new records, turn off `ENABLE_ONLINE_CANCELLATION` and, if pausing at the
DB, delete `version = 1` from `r4_online_private.reader_cutover`. Keep
`ENABLE_ONLINE_CANCELLATION_READS=true` and the database reader changes in place
once there are cancellations. Original income stays; `ONLINE_REFUND` is a
separate immutable expense and is exported from the same SQL ledger.
