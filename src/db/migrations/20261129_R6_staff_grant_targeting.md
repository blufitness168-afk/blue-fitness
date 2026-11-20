# R6 — Staff grant targeting (prepare only)

ADMIN/OWNER previews one recipient by a typed or scanner-entered BLU/CARD code, then confirms the resulting BLU member. Both coupon and promo pages use this flow. This is not a bulk job or a campaign rule for future signups. Promo checkout scope (the package being purchased) is separate from recipient scope (the member's current package).

## Eligibility and history

- Reuse `r3_override_current_order`: an ACTIVE MEMBER with a single standalone PAID online term, a valid paid snapshot, matching ledger and transfer reference, and member expiry matching the still-live term exactly. Reject pending orders and multiple PAIDs (including refunded PAID history), staff-sale history, a refunded source order, invalid or expired terms and aggregate drift. Staff-only, mixed, legacy-only and renewed memberships are intentionally unsupported until there is a reviewed authority for them. This technical restriction is not a customer policy.
- Specific groups are exact immutable snapshot durations of 1, 30, 90, 180 or 365 days (the existing catalog groups). `ALL` means any provable live term, not all ACTIVE rows. Other catalog durations are not bucketed into a new group. Live catalog edits and deactivation do not alter a paid snapshot. The daily admission window is not a grant time window.
- Preview writes no coupon, assignment or audit. Confirm binds the actor, definition, recipient, requested group and source term; the fingerprint is a stale-preview check, not an authorization credential. SQL rechecks eligibility under the recipient and definition locks at `READ COMMITTED`, with a database clock after waits. Confirm uses the existing issuance, assignment uniqueness and audit transaction. It returns the original receipt on an exact request replay even if eligibility has changed.
- No data backfill, auto-grants, revocation, or changes to wallet/use/cancel, promo reservation, membership, payment or admission. Existing direct SQL `grant` receipts still replay, but no new SQL `grant` is allowed; the HTTP `grant` route now requires the preview payload and never falls back to legacy SQL. A pre-migration DB rejects the new actions and the UI disables new grants without its readiness marker.

## Review and validation

Requires the R2 CARD table, the post-R3 override proof (stock or the reviewed R4 online-cancellation variant), and `20261127_R6_coupon_activation.sql`. Compatible with `20261128_R6_promo_scope.sql`; it does not patch the promo entry point. The migration checks reviewed function-body hashes and invoker settings, verifies every patch anchor, and preserves the benefits function ACL via `CREATE OR REPLACE`. Review the actual installed stack, locking, RLS, and trusted app-role privileges separately before any deployment. No additional ACLs are created. The app principal needs the existing benefits privileges plus CARD/R3 proof reads and execute, and if installed, private schema usage and read permission on staff sales and online refund evidence. A missing privilege does not broaden eligibility.

Native scratch run (no app DB credentials):

```sh
python -B scripts/r6-staff-grant-targeting-postgres-test.py --bin-dir .local-db/portable-postgres-uat/package/native/bin --psql .local-db/portable-postgres-uat/psql.exe
```

The test uses disposable PostgreSQL fixtures, actual R3/R4 and R6 migrations, real SQL settlement and grant paths, and separate PostgreSQL clients for the grant race. It is not a production role audit, browser/scanner UAT, or the full R6 checkpoint. For rollback, pause issuance and preserve coupons, assignments and audit. Do not blindly restore the old writer: doing so would reopen unfiltered direct grants. Prefer a forward fix or keep grants disabled while a reviewed rollback is prepared.
