# Package catalog migration — review before apply

## Scope and findings

- Only `20261031_package_catalog.sql`; never run the general migration runner.
- Requires benefits, deployment security hardening, receiver-bank and currency-recheck already installed. Exactly 30 original ordinary public tables are required; partial/repeated deployments are rejected.
- The SQL has one permitted top-level INSERT: ten default packages into the NEW `package_catalog`. Function-body INSERT/UPDATE statements are definitions, not executed during deployment. No old-row writes or historical backfill are permitted.
- Adds `package_catalog`, `package_catalog_audit`, `package_catalog_public`, four named invoker functions and three guard triggers (plus supporting indexes).
- Changes only `issue_paid_package_benefits()` among existing functions. SQL compares its exact previous `prosrc`; deployment extracts both old and new source from reviewed SQL and checks owner, ACL, configuration, invoker status and all other function metadata unchanged.
- Existing catalog SQL tests cover exact code seeds, OWNER authentication, update validation, replay, authoritative prices, legacy paid order/coupons, points issuance, old/new snapshot bounds, rollback and source drift. These are isolated PGlite tests, not live concurrency/load tests.

## Commands

Run from the repository root with Node and installed pnpm dependencies. PGlite must already be installed at `.local-db/payment-sql-tests/node_modules`; no automatic download is performed.

```sh
node scripts/db-package-catalog-migrate.mjs
node scripts/db-package-catalog-migrate.mjs --test
```

Default mode only parses and hashes files: no environment loading, database connection or backup. SHA covers the deployment script, this runbook, SQL prerequisites, relevant tests/default catalog, safety helpers and dependency lockfile. Any reviewed-input change requires a fresh SHA.

Only the main operator should run the following after offline review:

```sh
node scripts/db-package-catalog-migrate.mjs --inspect
```

Inspection first runs mandatory isolated catalog SQL tests, then reads **only `.env.local`** for `DATABASE_URL`. This file now contains production configuration. It deliberately ignores inherited `DATABASE_URL`, `.env`, and the removed `.env.production`. Inspection uses read-only repeatable-read metadata queries, not migration or backup. It writes a protected local report and prints only hashes/path/count, never credentials or row data.

After reviewing the returned SHA and metadata fingerprint, the authorized main operator may run (replace the two tokens with actual reviewed 64-character hashes):

```sh
node scripts/db-package-catalog-migrate.mjs --apply --reviewed-sha REVIEWED_SHA --reviewed-db REVIEWED_METADATA_FINGERPRINT
```

This document does not authorize an apply during implementation/review. No live inspection or apply has been performed by the implementing agent.

## Apply safety

1. Validate exact CLI flags and SHA; mandatory isolated SQL tests must pass before creating a production client.
2. Capture read-only structural metadata and reject fingerprint/source/table-count drift.
3. Protect `.local-db` using existing POSIX permissions or Windows ACL helper. Back up **all 30 original tables**, not only payment tables. Verify file SHA, JSON, column coverage, row counts and PostgreSQL record conversion. Save reviewed metadata alongside the backup.
4. Start one serializable transaction, set bounded lock/statement timeouts, acquire transaction advisory lock and `SHARE ROW EXCLUSIVE` locks on every original table. Readers remain allowed; old-table writers block during deployment.
5. Recheck metadata and every original column/row against the verified snapshot under locks. Any intervening legitimate writes require a fresh backup/review attempt; do not bypass the drift guard.
6. Execute statements produced by `splitSql`, removing only outer BEGIN/COMMIT. Enforce ordered top-level allowlist; no arbitrary DML or transaction control. Function dollar bodies remain intact.
7. Before commit, verify all original rows again (including paid orders, point ledger and coupons), original schema/functions, exact expected replacement source with preserved privileges/owner/configuration, new relation/function set, pinned search paths, no PUBLIC grants, ten seeds equal to code defaults, and empty audit.
8. Any validation failure rolls back the transaction. No automatic retry and no destructive down migration. After an ambiguous connection/commit failure, inspect actual state manually before deciding next action; automatic reapply is intentionally rejected.

## Backup limitations / operational review

The existing backup is a protected logical table-data/schema snapshot, **not PITR or a full database restore**. Verification does not execute an actual restore. Its restore SQL does not recreate functions, triggers, roles, grants or RLS; retain the saved metadata and arrange provider/PITR coverage separately. Sequence state is not MVCC. Do not restore into production or share `.local-db` artifacts: they contain personal data and internal function definitions.

Catalog metadata guards cover public relations/columns/defaults/constraints/indexes/functions/triggers/policies/enums, schema grants, roles, memberships and default privileges. They do not lock administrators out of concurrent DDL or cover objects outside public; coordinate a deployment window with no concurrent schema/role changes. SQL behavior tests do not prove absence of every possible malicious change in a newly reviewed function body: review the SHA-bound SQL itself.
