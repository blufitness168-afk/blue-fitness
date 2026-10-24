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

`records` contains active manual entries plus exactly one row per PAID package order with a non-null paid_at. Package dates use Asia/Bangkok paid_at, and actual amount_satang already includes discounts. No joins to attempts/legacy payments, no synthetic income rows inserted for orders, and no browser mock imports. Package record IDs have `package:` prefixes and cannot be sent as editable UUID ledger IDs. Package rows are always read-only.

Deletion is audited soft cancellation, excluded from totals but retained with before/after snapshots and reason in audit. Edits are audited. Audit + request record + ledger mutation commit atomically. No payment, member points, or expiry writes occur.

Reads currently return the full ledger and audit (no silent truncation); large installations should add server-side pagination/aggregation before scale.

## Optional dashboard integration — not implemented here

An OWNER-only dashboard could call `readRealFinance()` and sum each active returned record exactly once using integer satang. Never combine this result with legacy/mock finance or an additional package-income query. Do not call it for ADMIN/MEMBER dashboard requests or expose its result to those roles. No dashboard files were changed.

## Isolated validation

`node --test src/lib/real-finance-server.test.mjs` mocks HTTP SQL calls and runs migration/CRUD assertions in the existing optional PGlite WASM harness. It never connects to DATABASE_URL. If that harness is unavailable, the SQL test explicitly skips. Run eslint on only the finance paths. Isolated TypeScript validation should include installed Next's `index.d.ts` ambient types along with the five finance TS/TSX entrypoints, with noEmit and incremental disabled.
