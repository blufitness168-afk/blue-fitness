# Payment v2 deployment

## Incremental PromptPay deployment — applied 2026-10-10

Dedicated helper: `node scripts/db-payments-incremental.mjs --apply` (without `--apply`: preflight only). Original deploy remains additive-only and refuses an existing schema. Incremental helper refuses repeat application and pins both SQL hashes; allows only the reviewed constraint replacement, five functions and revocations. No core or migration SQL was modified.

- Incremental SHA256: `ca3e8e319e2cbc61e783fd8aa052e270dac5ccd306fe5bc37559428f8f2ff771`.
- Protected backup: `.local-db/backup-2026-10-10T12-06-10.847Z`; includes verified public-table snapshot/restore metadata plus `functions-before.sql` (hash in deployment report).
- Report: `.local-db/payments-incremental-2026-10-10T12-06-15.105Z.json`.
- All 18 public tables unchanged under pre/post snapshot guards inside one Serializable Neon transaction. Lock timeout 5 seconds; statement timeout 60 seconds; duplicate legacy reference and baseline guards checked again under locks. No automatic retry.
- Five functions validated as SECURITY INVOKER, fixed `public,pg_catalog` search path and no PUBLIC execution; updated finalizer contains PromptPay matching and recovery function permits the original failed provider attempt.
- Real order remains PENDING; its one attempt remains REJECTED with null evidence. No recovery executed, credit granted, provider request or SMS sent. **Owner must explicitly click the recovery UI after deployment.**
- Validation passed: original then incremental PGlite payment/recovery fixtures; full live table/type/constraint/index metadata acceptance without live rows; backup SHA256/count/column/PostgreSQL record conversion; transaction data-preservation and function guards. Backup is not PITR or a full roles/triggers/RLS restore drill.

Use `node scripts/db-payments-deploy.mjs` for preflight and `node scripts/db-payments-deploy.mjs --apply` for the authorized one-time additive deployment. DATABASE_URL is loaded from .env.local then .env; credentials and row contents are never logged. Existing payment core/schema files are not edited by this tool.

## Safety gates

- Protect ignored `.local-db` with restricted filesystem permissions before backup.
- Reject existing payment objects, duplicate non-null legacy transfer references, PUBLIC write grants, and additional unreviewed login roles with member/payment write privileges. Neon infrastructure roles cloud_admin/neon_service/neon_superuser and postgres are recognized; current connection owns the server-side migration. This checks database grants, not whether credentials were leaked to browser/client bundles.
- Snapshot **all existing public tables**, covering members, auth, payments, packages and public FK dependencies, in a repeatable-read transaction. Capture types, columns/defaults, constraints, indexes, supported integer-id sequences and every row. Verify SHA256, counts, column coverage and PostgreSQL record conversion.
- Run migration and rollback fixtures against full production table/type/constraint/index metadata in isolated PostgreSQL WASM. Never copy live rows or invoke fixtures against Neon. Requires the existing `.local-db/payment-sql-tests` PGlite installation. This is not a multi-connection Neon concurrency test.
- Pin exact migration SHA256. Parse PostgreSQL dollar quotes, escaped quotes, line comments and nested block comments; peel BEGIN/COMMIT and reject non-additive top-level statements. Unsupported backslash string syntax fails closed.
- One Neon Serializable transaction sets lock_timeout=5s and statement_timeout=60s, locks all backed-up public tables in SHARE ROW EXCLUSIVE mode, rechecks absence/duplicates, compares MD5 of sorted row JSON with backup before and after migration. Any drift/error rolls back; no automatic retries. Reads continue; writes may briefly wait. No Next process is stopped.
- New functions remain SECURITY INVOKER, receive fixed public/pg_catalog search_path, and lose PUBLIC execute privileges. The current owner can execute them. Review explicit grants before adopting another application database role.

A backup is affected/public-schema data plus metadata, **not** whole-database/PITR: no roles/grants, triggers, RLS, extensions or cross-schema dependencies. Integer-id sequence capture does not cover every possible custom sequence. Sequence values are not MVCC transactional. Restore SQL is only for an empty isolated database, never production. Hash/record verification is not an actual restore drill.

## Applied deployment

Applied on 2026-10-10 with migration SHA256:
`f25634355d4935628e043cfab03d6e176af2e41eb3f97d39c2d11c5d12e1a779`

Backup: `.local-db/backup-2026-10-10T11-39-17.293Z` (restricted, gitignored).
All 13 pre-existing public tables were unchanged at the migration transaction's final check. Created five payment tables and nine functions; legacy refs/orders/attempts were zero. No real transfer, provider, SMS, or fixture account was used. Runtime enablement and API keys are separate concerns.

Validation: `node --test scripts/db-payments.test.mjs scripts/db-tools.test.mjs src/lib/payment-policy.test.mjs src/lib/payment-server.test.mjs src/lib/payment-provider-diagnostics.test.mjs` (35 pass); `node scripts/payment-sql-tests.mjs --run-memory`; full-schema isolated acceptance; `pnpm exec tsc --noEmit`.
