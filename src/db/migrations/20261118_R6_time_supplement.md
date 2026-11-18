# R6/R3 time supplement — conservative standalone-main implementation

18 November 2026. PREPARE ONLY; not applied/deployed; not production acceptance.

## Scope

Read AGENTS, TODO R0/R3/R6, CLIENT_BRIEF_HANDOFF, R1 matrix, R4 handoff,
R3 migrations and installed Next 16.3.3 route/server-client guides before writing.
No existing migrations, TODO, finance/catalog/provenance implementation or
`real-benefits-admin-server*` edits. The only existing file edited is
`src/app/member/AccountClient.tsx` (one wallet navigation link).

New migration: `20261118_R6_time_supplement.sql`.
New API/helper: `src/lib/time-supplement-server.ts`,
`/api/admin/time-supplement` POST grant, `/api/member/time-supplement` GET own
coupons / POST activate. UI: `/member/time-supplement`, staff grant form visible
only to ADMIN/OWNER; SQL rechecks NORMAL live sessions and role independently.
No new admin navigation/permissions change; staff can open that member URL.
No money fields, report payloads, mock grants, sales, provider calls or price API.

## Deliberately restricted main authority

R3 checkin still selects latest PAID and reads aggregate member expiry; R4 online
observations explicitly are not entitlement intervals. Do not pretend this fixes
that model or infer current entitlement from expiry minus duration.

Allow only **exactly one lifetime PAID online order**, active member, valid paid
snapshot slot, confirmation not in the future, future order expiry, member expiry
exactly equal to order expiry, and order expiry exactly equal to confirmed_at plus
snapshot durationDays. All conditions are mandatory at grant, activation and
checkin. This is a conservative sufficient condition, not reconciliation.

Reject stacked renewals, staff/legacy-only main, aggregate carryover, changed
aggregate expiry and ambiguous history. Even a valid renewal after an earlier
expired order is intentionally unsupported. No backfill, manual main assertion,
order rewriting or provenance authority changes. Catalog edits do not change
paid snapshot selection. The granted main order/snapshot/expiry binding must
still match when checking access.

A subsequent purchase or aggregate/status/snapshot change can make the supplement
ineligible immediately, even if its recorded activation expiry is later. It does
not refund/reissue a spent coupon. This fails closed rather than guessing a new
main; extending eligibility/refunds requires a separate approved entitlement
model/policy. No cancel/revoke/refund/deactivate endpoint or negative points/
aggregate-day subtraction is introduced. R0 withdrawal decisions remain blocked.

## One-shot and time semantics

Reuse existing `coupons` CUSTOM type; source `TIME_SUPPLEMENT:<coupon_id>`, quota
1, used 0 -> 1, bonus_days_value=0. Grants bind immutable main snapshot, source
order, actor and reason. Each grant request issues one explicit recipient coupon;
no campaign distribution, automatic package gifts, targeting or bulk quota engine.
Coupon issuance expiry is the proven main end; no new general coupon expiry policy.
Existing generic benefits consumption rejects CUSTOM; no benefit_assignment is
created, so existing assignment cancel cannot target these grants.

Activation uses server clock after member lock. Opening inclusive, closing
exclusive, same Bangkok calendar day, canonical slot including closing 24:00,
no overnight interval. Expiry = earliest of that day's closing time, bound main
expiry and coupon expiry. No member time input/backdate, stacking, extra days,
price changes, main changes, checkin points or hourly timer.

Member locking serializes activation across coupons; actor advisory lock prevents
same-actor share-lock upgrade races, request advisory lock protects UUID identity.
Same UUID/payload returns original result (even later, never reactivating); reuse
with changed payload/action fails. A different request/coupon while an eligible
activation is running returns that active result without consuming another coupon.
A requested coupon must belong to the caller even for active-result convergence.
All coupon consumption, activation and request audit insert are one statement /
transaction; failure rolls everything back. Audit tables reject update/delete/
truncate and PUBLIC table/function grants are revoked. Functions are SECURITY
INVOKER; the authenticated backend database role must have reviewed privileges.

API retries only 40001/40P01 up to three attempts with identical UUID/payload.
Unknown connection outcomes return 503, not a new grant attempt. UI stores unresolved
request payload/UUID in sessionStorage per logged-in member and action, including
across refresh; retry explicitly confirms that saved request. Success clears it;
definitive 4xx clears it. sessionStorage is only a retry token, not entitlement state.

Checkin migration uses exact single source anchors on both R3-installed kiosk and
frontdesk functions; drift aborts transaction. It adds an OR supplement eligibility
check only inside the existing active-main branch. Original actual PAID snapshot,
main slot, auth, replay, bounce, welcome-entry behavior and checkin insert remain.
Checkin does not consume another coupon. This is ENTRY_ONLY access, not single
physical visit consumption or the separate R7 IN/OUT project.

## Local validation actually run

- `node --test src/lib/time-supplement.test.mjs src/lib/time-supplement-server.test.mjs src/lib/package-catalog-r3.test.mjs src/lib/real-member-wallet-server.test.mjs src/lib/payment-server.test.mjs src/lib/package-payment-benefits.test.mjs`: **42 passed, 0 skipped**.
- `pnpm exec tsc --noEmit --incremental false`: passed.
- ESLint on new R6 helper/tests/routes/UI: passed.
- `pnpm lint`: fails existing `src/app/member/AccountClient.tsx:78` react-hooks/set-state-in-effect. Not changed outside the one wallet link.

SQL tests run the actual payment/benefits/catalog/R3 checkin migration chain in a
synthetic in-memory PGlite, then the new R6 migration. Test standalone paid main
through real finalizer with locally fabricated verification evidence (no provider),
no-history/backfill writes, catalog-independent paid snapshot, auth/role/revoked/
kiosk/expired sessions, grant UUID/payload identity, no-main/stacked/aggregate
mismatch/expired main, expired coupon, wrong owner, no client clock/price/day input,
outside-window rejection, Bangkok opening/closing/day crossing/24:00/earliest end,
injected post-consume failure rollback, activation retry and Promise.all callers,
only one consumed coupon, active-result convergence, unchanged paid/main/points,
legacy CUSTOM consume rejection, append-only audit and no PUBLIC table grants.

Actual kiosk/frontdesk integration tests use rollback-only synthetic snapshot
changes with fixture triggers disabled to deterministically force OFF_PEAK at the
real runtime clock, prove stale main binding denies access, then bind the synthetic
grant for accepted supplement access, replay and bounce. These fixture bypasses
are never used in application code or the migration. Deterministic temporal
boundary assertions call the actual SQL window helper, not a fake production clock.

**Limitations:** PGlite queues operations on one engine; Promise.all is retry /
interleaving regression evidence, NOT PostgreSQL multi-connection lock scheduling
proof. Must still test real isolated PostgreSQL concurrent grant/activate/checkin/
settlement transactions, deadlock rollback retry, lock waiting across window/main
expiry, non-owner backend ACLs, complete installed migration/finalizer chain, and
browser/sessionStorage UAT. No browser/production auth integration was run.
R4/R5 migrations are not part of this R6 fixture chain; no combined rollout claim.

## Rollout and rollback (requires separate approval)

1. Inspect deployed definitions/ACLs and schema history with explicit DB approval;
   this task did not connect to any database service or load env credentials.
2. Backup and prove restore. Apply required legacy and R3 migrations in reviewed
   order, then this migration via a history-tracked runner. No raw repeated apply;
   no IF NOT EXISTS masking drift; BEGIN/COMMIT must remain intact.
3. Deploy matching API/UI only after migration succeeds. Old wallet remains usable
   if new migration is absent; new endpoints fail unavailable, never fake success.
4. Before production approval, complete missing concurrency/ACL/browser tests and
   accept the standalone-main limitation explicitly. No general R3/R6 completion.
5. To roll back access behavior, pause R6 writers, remove/disable the new UI/API and
   restore reviewed original R3 checkin definitions under separate approval. Keep
   grants, activation and request audit/coupons; do not delete/refund/reissue spent
   coupons, restore over audit or guess withdrawn entitlements. Restoring earlier
   code must not mean reapplying historical migrations blindly.

No DB-real/network/provider/install/commit/branch/deploy actions were performed.
