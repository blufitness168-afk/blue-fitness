# Real modules deployment — APPLIED TO TEST NEON 2026-10-24

## Latest result (supersedes historical findings below)

All three review blockers were corrected before deployment: PUBLIC EXECUTE revoked on rewards and payment wrapper; wrapper/helper search_path pinned to `public, pg_catalog`. Isolated chain, rollback, security and acceptance passed with zero findings. Applied the five migrations atomically with reviewed SHA `d2ac7bad8d7b3001b43cb1bd5b6b4646682a0a932b10bf9921091c46e0efb5f1` after read-only catalog/owner review. Runtime role owns the functions. Backup/report: `.local-db/backup-2026-10-24T11-34-08.894Z/real-modules-applied.json`. Every original column/row across 20 tables remained unchanged; historical eligibility NULL, no backfill or fixtures. No provider/SMS calls. Do not rerun apply; the runner intentionally rejects reapplication.

Post-apply browser/API: 54/54 checks, runtime errors 0, temporary OWNER/ADMIN/MEMBER accounts removed and original members/points/visits/coupons preserved. See `.local-db/real-modules-browser-2026-10-24T11-35-58.218Z/results.json`. Full tests 230/230, TypeScript/lint and isolated-copy webpack production build passed. This is a test environment, not production approval. Browser coverage is read flows/profile mutation, not full CRUD/load/concurrency coverage for every module.

## Historical review before fixes (not current blockers)

Owner scope: `scripts/db-real-modules-deploy.mjs` and this document only. No migration, runtime helper, application schema, or other agent's work was edited. No real DB connection, inspection, backup, or apply was performed during this review. User authorization to change the real modules is **not** an instruction to deploy now.

## Blocking findings to return to migration owners

1. **PUBLIC EXECUTE on rewards entrypoint.** `src/db/migrations/20261024_real_rewards.sql` creates `real_rewards_action(text,text,uuid,jsonb)` without revoking default PUBLIC EXECUTE. The PGlite catalog confirms this with ordinary PostgreSQL default privileges. Add an explicit revoke in that migration and review any required application-role grant. Session checks are not a replacement for DB privileges.
2. **PUBLIC EXECUTE on replacement payment entrypoint.** `src/db/migrations/20261024_real_benefits_admin.sql` revokes the renamed original function but not the newly created `create_package_payment_order(uuid,integer,text,uuid,jsonb,jsonb)`. Renaming retains the *old* function's ACL; it does not transfer that ACL to a different, newly created function. Revoke PUBLIC on the new wrapper and explicitly review ownership/EXECUTE for the actual server DB role. A separate application role may lose access after this replacement.
3. **Unpinned inherited helper search path.** The same migration renames `create_package_payment_order` to `create_package_payment_order_before_benefits` without pinning its `search_path`. The actual prerequisite chain leaves its `proconfig` NULL; the rename preserves that. Pin the renamed helper to `public,pg_catalog` in the benefits migration. This is SECURITY INVOKER, not a demonstrated privilege-escalation exploit, but the deploy security contract deliberately rejects an unpinned payment helper. Do not change the runner to silently accept it.

The runner does **not** inject missing REVOKE/ALTER statements to hide these issues. Current `--test` deliberately exits **1**, reporting these three findings after otherwise passing compile/rollback/functional acceptance. Current `--apply` is blocked before connecting to the real DB. After the owners revise migrations, rerun tests and prepare a **new SHA**.

Additional boundary to review, not a claim of an untrusted-user exploit: the renamed helper is still executable by its owner (and any retained explicit grantees) and does not enforce benefit assignment validation itself. This architecture assumes trusted server-only DB credentials, which also have direct table access. Never expose that role, session digests, or either payment function through a browser-accessible SQL/RPC interface. If the intended trust boundary is different, the wrapper/helper design needs redesign rather than just grants.

## Migration-by-migration review

Deployment order is explicit, not filename sorting:

1. `20261024_real_rewards.sql`: adds nullable redemption metadata, unique request/code indexes and empty request/spend ledgers. No point-balance backfill. Normal, live, unsuspended sessions required; admin/read-deliver-save additionally require ADMIN/OWNER. Member redemption locks actor/reward, decrements remaining stock/points, records redemption and spend in one transaction. PUBLIC ACL blocker above.
2. `20261024_real_finance.sql`: creates empty manual-entry/request/audit tables. Invoker function is OWNER-only, requires NORMAL/live/unsuspended sessions, uses request replay and version checks. Package income is read from PAID orders; no package/order/member mutation in manual CRUD. PUBLIC execution is revoked. It is not an import of legacy payments or browser mock finance. Reads currently return all finance/audit rows, so review pagination separately if volume is significant.
3. `20261024_real_frontdesk.sql`: adds a separate invoker function with NORMAL ADMIN/OWNER session checks. Does not replace kiosk authorization. Reuses station request/bounce tables and existing entitlement rules; consumes only eligible welcome FREE_ENTRY coupons at runtime, writes checkins with zero points. PUBLIC execution revoked. Station-wide replay is shared deliberately with kiosk. SQL parameter null/length validation relies partly on the trusted HTTP helper.
4. `20261024_real_benefits_admin.sql`: creates empty definitions, assignments, reservation/audit/consumption tables. Admin operations require NORMAL ADMIN/OWNER; coupon consumption locks member before coupon, tracks guests, and consumes bonus days only against active/unexpired membership. Append-only triggers protect audit/consumption/reservation UPDATE/DELETE (not against a privileged owner deliberately bypassing safeguards). Wrapper recalculates discounts from locked DB definitions, enforces member assignment and delegates global capacity to the original order creator. It replaces only order creation, **not** finalization/evidence handling. Two blockers above concern wrapper ACL/helper search path. Existing server role ownership/grants must be reviewed on the real DB before deployment.
5. `20261025_package_payment_benefits.sql`: adds a nullable version column **before** setting its default, leaving every historical order, including historical PENDING orders, NULL. No UPDATE/backfill. Guard makes eligibility immutable. Coupon trigger executes only on a PENDING → PAID transition with version 1. Already PAID rows do not receive grants; the unchanged existing terminal-order trigger still rejects historical paid-row mutations. Friend/bonus coupons are inserted inside the existing finalizer transaction. Issuance failure rolls back settlement, transfer claim, points and membership. Bonus-day coupons do not automatically extend membership; expiry is frozen at the order membership expiry. Unique source prevents duplicate issuance. The catalog values for quota/days are whitelisted independently, not checked as full catalog combinations: server quote remains part of the trusted boundary.

None of the five files has a top-level data DELETE/TRUNCATE/UPDATE/INSERT. No clearing existing members, legacy payments, package orders/attempts/ledgers, sessions, checkins, or coupons. Existing tables are compared on **every original column**, before and after migrations inside the locked transaction. New redemption metadata and historical order eligibility must remain NULL, and every newly created module table must remain empty.

All six reviewed entrypoints/helpers must be SECURITY INVOKER; no SECURITY DEFINER is introduced or accepted. Public execute on trigger-returning helpers is not equivalent to an RPC entrypoint (PostgreSQL does not allow ordinary direct calls to trigger functions); `benefit_append_only` still inherits a default ACL and can be explicitly revoked as defense in depth. The runner also rejects PUBLIC grants on newly created tables, including grants inherited from altered default privileges. It does not certify every named role as trusted: review the protected metadata's ownership, ACLs, role memberships and default ACLs.

Runtime review: `real-rewards-server.ts`, `real-finance-server.ts`, `real-checkin-server.ts`, and `real-benefits-admin-server.ts` use parameterized Neon tagged SQL calls to the matching function signatures and hashed session tokens. This is compatible with existing raw SQL/Drizzle coexistence; migrations deliberately do not require new Drizzle `schema.ts` mappings. No helper changes were made. Application-level tests verify canonical request validation and retry behavior; frontdesk currently returns 503 rather than retrying a deadlock. Single-connection WASM cannot validate real concurrent lock behavior.

## Commands — do these first, NOT apply

```sh
node --check scripts/db-real-modules-deploy.mjs
node scripts/db-real-modules-deploy.mjs
node scripts/db-real-modules-deploy.mjs --test
```

Default invocation is offline: it prints ordered file hashes, combined review SHA and the eventual apply command. It neither loads DB credentials nor connects. The combined SHA covers the runner itself, safety/backup/parser helpers, five migrations, prerequisites, package-benefits acceptance test and its catalog/policy/server dependencies, plus the project lockfile. It changes whenever a covered input changes. The PGlite install in ignored local storage is reused, not installed or modified by the runner; it is not part of the project lockfile and is not attested by this SHA.

`--test` reuses `@electric-sql/pglite` through `.local-db/payment-sql-tests/package.json`, creates only in-memory databases, and does not load DATABASE_URL or contact Neon, EasySlip, or SMS. It tests:

- Actual payment → PromptPay → kiosk prerequisites, followed by **all five** new files, including finance.
- The same stripped-envelope combined transaction used for deployment.
- Deliberate exception after the whole chain and rollback to identical baseline catalog.
- Full apply, followed by atomic rejection of a repeated apply with unchanged catalog.
- Function ACL/config checks and execution of the actual production metadata/security guard SQL.
- Missing sessions on all four new module entrypoints; successful read bodies and NORMAL/KIOSK/expired/revoked/suspended/role checks for rewards, finance and benefits.
- Existing `src/lib/package-payment-benefits.test.mjs`: all ten catalog price/benefit quotes, historical PAID/PENDING no-backfill, immutable eligibility, paid-only issuance, replay, rejected/duplicate payments, malformed snapshot failure, kiosk denial, deliberate coupon collision rolling back settlement, and idempotent extra-day/friend consumption.

Additional independent runtime validation command used in this review:

```sh
node --test src/lib/real-rewards-server.test.mjs src/lib/real-finance-server.test.mjs src/lib/real-checkin-server.test.mjs src/lib/real-benefits-admin-server.test.mjs
```

Results: those 21 tests and the 2 package-benefits tests passed. The runner's isolated compile, rollback, safe repeat rejection, metadata guard and auth/read checks pass; its overall security gate remains blocked by the findings above. This is not full production-schema or multi-connection acceptance, and no production build was run for these script/doc-only changes.

## Later, after blockers are fixed and explicitly approved

Stop web workers, cron jobs, kiosks and **all DB writers** for the maintenance window. Review the SHA and SQL independently again. No automatic deploy is performed by a build/start hook.

```sh
node scripts/db-real-modules-deploy.mjs --inspect
```

This opt-in command is SELECT-only against the configured real DB. It checks installed payment/kiosk prerequisites and refuses an already/partially applied baseline. It calls `protect()` before writing a metadata-only report beneath ignored `.local-db`; credentials and database names are not printed. Review that protected report locally; do not paste it into chat or commit it. Review actual DB identity, function owners/ACL/config, role memberships, public-schema permissions, columns/defaults, enum labels, indexes, constraints, policies/RLS, triggers and default privileges. Its fingerprint binds both DB identity/current role and catalog state. Do not run this step if production inspection is not wanted.

The prepare output supplies the SHA; inspect output supplies the database fingerprint. The template below is documentation, **not authorization to run**:

```text
node scripts/db-real-modules-deploy.mjs --apply --reviewed-sha <exact-prepare-sha> --reviewed-db <exact-inspect-fingerprint>
```

Unknown/missing/reordered flags and stale SHAs are rejected. Apply:

1. Protects ignored `.local-db` with restrictive permissions, runs isolated tests and stops on security findings **before connecting**.
2. Rechecks all reviewed file hashes, database metadata fingerprint and expected prerequisites. Rejects unsupported partitioned/foreign/materialized storage rather than silently omitting it from backup.
3. Calls existing `backup()` for all public ordinary tables, then `verify()` for hashes, JSON/column coverage, PostgreSQL record conversion and row counts. Captures original function definitions/ACLs and remaining metadata in `real-modules-metadata-before.json`, plus the reviewed hash manifest. No secrets/rows are printed beyond the existing backup helper's table counts.
4. In **one Serializable transaction**, sets lock/statement timeouts, takes a deployment advisory lock and ACCESS EXCLUSIVE locks on all original public tables, compares reviewed metadata again and compares backed-up data before changes. Backup/lock drift aborts rather than overwriting live changes.
5. Removes only each file's outer BEGIN/COMMIT. Nested transaction control and unexpected top-level DML are rejected. Runs all five bodies without intermediate COMMIT, then verifies every original row/column, untouched preexisting functions (except the intentionally renamed order creator), unchanged finalizer, NULL historical metadata/eligibility, empty new tables and function/table security before COMMIT.
6. Writes a protected local success report after commit. No fixtures, provider requests, fake PAID transitions or SMS occur on the real DB.

The SQL/parser hashes and strict flag protocol are review gates, not signatures proving who performed a review. Review must happen outside the runner. The app DB role is expected to own these invoker functions/tables or have explicitly reviewed grants; this runner does not grant broad runtime privileges automatically. Keep the metadata fingerprint tied to the exact connection being deployed.

## Rollback, idempotency and failure handling

**Before COMMIT:** any statement, lock timeout, security/data/metadata guard or Serializable error rolls back the **entire chain**, restoring original function naming and schema together. Proven with an injected exception in the isolated chain. The script does not disable existing triggers or use session replication role. Existing sequence values are not altered by top-level migrations; PostgreSQL sequences are generally not transactional.

**Repeated apply:** deliberately fails closed at baseline checks (or rolls back if raced), rather than treating `IF NOT EXISTS` as proof of a compatible schema. These source migrations are not independently idempotent. No automatic partial installation repair, function wrapping twice, or second coupon grant is allowed. This is safe reapplication rejection, **not** a replay-success deployment ledger.

**After COMMIT:** no automatic destructive down migration. Revert/disable application module access as operationally appropriate and keep the installed schema/data. A forward fix requires a separate review. Dropping new tables after users have created benefits/redemptions/audit would lose data and is forbidden here.

**Network error/unknown commit result or failure writing the local report:** the script emits only a redacted failure, never connection URLs, parameters or row contents. A failed exit does not prove the DB rolled back. Do not retry blindly. Inspect the real catalog read-only, reconcile all five migrations with the saved plan/metadata, and escalate partial/unexpected states. A fresh install should be all-or-nothing; an unknown commit should be treated as unknown, not repaired automatically.

**Backup limits:** the inherited backup is not pg_dump/PITR, excludes other schemas and does not restore roles/grants/RLS/triggers/functions/extensions. Extra metadata captures aid review, not a complete executable restore. `verify()` does not execute an isolated restore or certify its constraint semantics. `restore-empty.sql` is for a separately reviewed **empty isolated DB only**, never a down migration against live data. Obtain a provider snapshot/PITR point and review recovery separately before an eventual production apply. Never clear live tables to force a restore.
