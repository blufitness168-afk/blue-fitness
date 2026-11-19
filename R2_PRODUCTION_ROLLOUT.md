# R2 production database rollout — PROFILE / CONTACT APPLIED

Executed 2026-11-18, UTC. Replaces the earlier blocked report. **Profile and contact email schema migrations committed and independently verified. Password migration remains unapplied.** Database-only scope; no application deployment, auth/session fixture creation, password reset, contact/profile edits, provider call, commit or push. Existing working-tree changes and every migration file remain untouched.

## 1. Exact original restore mismatch — resolved, not ignored

Original protected backup: `.local-db/backup-2026-11-18T12-57-00.360Z`.

- All **32 tables** restored; every table's row count matched.
- **357 timestamp cells in 24 tables** differed as strings. The only affected SQL type was `timestamp with time zone`: source JSON used `+00:00`, PGlite's session rendered `+07:00`.
- PostgreSQL declared-type conversion and **canonical whole-row JSONB text, `COLLATE "C"`, `EXCEPT ALL` in both directions** verified **0 missing / 0 extra rows**. No numeric, enum, text or JSON data-loss mismatch was found.
- Normalization is performed by PostgreSQL using each actual table type. It does not use JavaScript Date/Number, truncate timestamps, round numbers, strip offsets from arbitrary strings, ignore columns or convert multisets to sets. Microseconds and duplicate multiplicity remain significant.
- Actual PGlite replay of the original backup was rerun with the final comparator and passed all 32 tables. Sanitized per-table/column evidence is in the successful rollout artifact directory's `original-mismatch-diagnosis.json`; no real row values are printed.

Affected tables (names only):

`auth_login_limits`, `auth_otp_challenges`, `auth_password_tickets`, `auth_sessions`, `auth_signup_tickets`, `benefit_action_audit`, `benefit_assignments`, `benefit_definitions`, `checkins`, `coupons`, `finance_action_requests`, `finance_audit`, `finance_entries`, `kiosk_member_bounce`, `kiosk_requests`, `members`, `package_catalog_audit`, `package_payment_attempts`, `package_payment_orders`, `package_payment_point_ledger`, `package_payment_resolution_audit`, `payment_transfer_refs`, `reward_action_requests`, `rewards`.

A synthetic precision regression also caught an SQL alias ambiguity: with a column literally named `t`, `to_jsonb(t)` can serialize that column instead of the whole row. The comparator now explicitly serializes `ROW(t.*)`; its bigint/numeric/enum/text/JSON tests verify every field participates. This was a harness bug found by synthetic tests, not evidence of production data loss.

## 2. Verified native PostgreSQL recovery

Installed portable native PostgreSQL18 tooling was discovered under `.local-db/portable-postgres-uat/package/native/bin`; no dependency download/install was needed. The runner creates a fresh protected cluster/database, listens on **127.0.0.1 only**, uses a bounded libpq bridge (not stock psql), and shuts the cluster down in `finally`.

Successful pre-mutation backup/rehearsal and audit artifacts:

`.local-db/r2-rollout-2026-11-18T13-19-44.356Z/`

| Artifact | Evidence |
| --- | --- |
| `snapshot.json` | One production read-only Repeatable Read transaction captures catalog and all 32 ordinary public tables; SHA256 `c9a9a0bea5cb14470166159a323c798bebcd3f497ee7a69383b0157f8bf19878` |
| `restore-complete.sql` | Executed into fresh native PostgreSQL; SHA256 `69a3e8df1f5c058167183d1a2d4365ce7c69a91fec6204c9877411d08936be8a` |
| `manifest.json` | File checksums and per-table counts, verified before restore |
| `rehearsal-scope.json` | Exact expected post-migration public object definitions/owners/ACLs derived from native rehearsal |
| `report.json` | Confirmed commit + successful postflight, native server stopped |
| `independent-audit-2026-11-18T13-21-25.371Z.json` | Separate production read-only audit passed |
| `original-mismatch-diagnosis.json` | Final comparator's original-backup replay evidence, schema names/counts/types only |

Recovery verified:

- Exact typed multiset equality for **all 32 tables**, preserving full timestamp/numeric/bigint precision.
- **19 catalog sections** match: database ACLs, columns, relations, function definitions/configuration/owners, constraints, triggers, role attributes, role memberships including grantor/admin/inherit/set options, policies, schema ownership/ACL, default ACLs, enums/ownership, indexes, sequences/ownership/configuration, views, relation ACLs, function ACLs, schema ACLs, expanded default ACLs.
- Sequence `last_value` **and `is_called`** were restored and compared separately. Unused sequences legitimately have `pg_sequences.last_value=NULL`; this is not missing sequence state. The direct sequence state distinguishes uncalled from called sequences.
- Identity generation, serial sequence ownership, existing constraints/indexes, all stored public functions and trigger enablement are retained.
- Native bootstrap and database ownership reproduce source ownership semantics, including `pg_database_owner` and original membership grantors. No privilege relaxation was used to make migration rehearsal pass.
- Profile/contact migrations compiled and ran under the restored **actual application principal**, not a substituted superuser, and left existing table data unchanged.

Security/limits: `.local-db` is ignored and Windows ACL-protected before sensitive writes; snapshots, native cluster data, SQL and logs must never be printed, attached, committed or published. Role **passwords**/`pg_authid`, Neon control-plane state and PITR are not exported. Sequences are inherently non-MVCC; their captured state is recorded exactly, not a claim of transactional/PITR recovery. The native portable engine is an isolated PostgreSQL18 recovery rehearsal, not proof of Neon infrastructure recovery or multi-connection application race safety. The recovery export is authorized backup validation, not functional UAT against customer accounts.

## 3. Production apply and independent audit

Transaction started after fresh backup and recovery checks; confirmed outcome at **2026-11-18T13:20:11.603Z**:

| Migration | Reviewed source SHA256 | Actual result |
| --- | --- | --- |
| `20261118_R2_admin_member_profile.sql` | `9d3b5f4722113fcae20513928ccba52876b90ed0029059d8009a5e0247c12cdc` | **APPLIED** |
| `20261118_R2_member_contact_email.sql` | `865febf7807952fcf2c68a71e4c7e4f15272a32235d0d61b05add1ad558aaccd` | **APPLIED** |
| `20261118_R2_admin_member_password.sql` | `1e2122644fffd107dcd6c359320b1a67b2fc43f37ddebf5b3a5e3402136b3e08` | **NOT APPLIED** — coordinated auth deployment/drain gate remains |

Production execution uses one Neon Serializable transaction with bounded lock/statement timeouts, a transaction advisory lock, and SHARE locks on existing tables. Before schema installation it verifies all backed-up data fingerprints and existing catalog snapshots; before COMMIT it rechecks existing data, exact native-rehearsed object definitions, and effective permissions. Both approved migration records are inserted into new `public.r2_schema_rollouts` atomically with the schema. No existing application row is updated.

Installed: **3 application tables, 8 functions, their sequences/indexes/constraints/triggers, plus the restricted two-row migration metadata table**. PUBLIC access to new objects is revoked according to the reviewed migrations/runner. Effective function access is limited to principals already capable of trusted baseline access; per-operation new table privileges are checked against matching existing `members`/`auth_sessions` privileges. Intrinsic `pg_read_all_data`/`pg_write_all_data` access is compared per privilege, not misclassified as a newly introduced grant. No guessed role grants were added.

Independent read-only audit at **13:21:25.371Z** verified:

- **32 existing table fingerprints unchanged**; **19 existing catalog sections unchanged** after excluding only newly created R2/metadata objects.
- Exactly **2** inventory records, approved source checksums and current schema matching the rehearsed definitions.
- `admin_member_profile_audit=0`, `member_contact_details=0`, `member_contact_email_audit=0`.
- Unexpected privilege expansion **0**; password tables/functions **0**.
- Scope definition fingerprint: `cafcf5cd7f38b1b65dc3e0e083ae6dcf1429aeee9df07718e49d491dbcdb9f7d`.
- Authorized UAT role checks: BLU-3 MEMBER matches **1**, BLU-4 ADMIN matches **1**. No profile/contact/password/session writes or other account UAT took place.

A final `--dry-run` at **13:22:21.864Z** reconciled exact approved inventory/current definitions and returned **already applied; no replay**.

Database fingerprint: `693fe5919fc229a2cf404ad99e03e8e9277fa4a6d34e88a0d4224d81b0b057a8`.
Principal fingerprint: `6f198191100386e1f0c093fc1c902c0520c6382059d75fb4743ec1ec75cc7842`.

## 4. Guard failures diagnosed before the successful commit

Earlier attempts are retained in protected artifacts, not hidden:

1. Recovery export initially stopped on unused sequences. Added explicit `last_value/is_called` capture rather than inventing sequence state.
2. Native role-grantor and public-schema checks exposed missing bootstrap/database-owner recovery semantics. Restored the actual ownership context; did not grant extra rights to the app principal.
3. Sequence catalog comparison exposed transport `int8` strings versus JSON numeric rendering. Those catalog fields are explicitly cast to text on **both** engines, preserving all digits rather than converting through JavaScript Number.
4. An initial table ACL checker over-grouped read/write privileges. It now compares each operation against the same operation on existing baseline tables, preserving built-in global-data-role semantics.
5. At **13:17–13:18Z**, production guard returned **SQLSTATE 22012** and the entire transaction rolled back. A separate production read-only audit found **no data mismatches and 0 R2/metadata relations**; only raw relation/function/schema/default ACL representations differed. Root cause: transport returned PostgreSQL ACL arrays as array-literal strings while the guard used JSON arrays. Capture now serializes catalog rows to JSON **inside PostgreSQL**, identically to the native comparator and transaction guards. Conditions were not removed or bypassed. Fresh backup/recovery/rehearsal preceded the successful retry.

No failed attempt was treated as a successful commit; no blind retry followed an unconfirmed outcome.

## 5. Runner / validation

Only these new files are in this work's write scope:

- `scripts/r2-production-rollout.mjs`
- `scripts/r2-production-rollout.test.mjs`
- `R2_PRODUCTION_ROLLOUT.md`

Commands/contracts:

```sh
node scripts/r2-production-rollout.mjs --dry-run
node scripts/r2-production-rollout.mjs --dry-run --backup
node scripts/r2-production-rollout.mjs --apply
node --test scripts/r2-production-rollout.test.mjs
```

- `--dry-run`: production read-only inspection and exact existing-inventory reconciliation.
- `--backup`: protected coherent backup, native recovery and migration rehearsal; no production mutation.
- `--apply`: **profile/contact only**, hard-pinned reviewed sources. Requires successful recovery/rehearsal/ACL/drift checks. Existing objects without exact recorded source/schema inventory abort; matching applied objects are not replayed. Password is unconditionally excluded.
- `auditApplied(protectedDirectory)` provides a separate production read-only integrity/data/catalog/privilege audit; `diagnoseOriginalBackup(protectedDirectory)` replays an original protected backup on installed PGlite without production access.
- Split SQL uses the existing dollar-quote-aware parser, never naive semicolon splitting.

Validation run: **6/6 new runner tests passed, 0 skipped**. Covers scope/password exclusion, pinned sources, unsafe flags, collision refusal, exact timestamp microseconds, bigint beyond JavaScript safe integer range, numeric precision, enum/text differences, duplicate multiplicity and safe quoting. Scoped ESLint passed with zero errors/warnings via the installed ESLint API. `pnpm exec eslint` CLI attempts timed out (30/60-second bounded commands); the same installed ESLint was then run successfully through its API. No full app build/test suite or browser feature acceptance is claimed; app/auth files were not changed.

## 6. Card/avatar follow-up — offline rehearsal only

```sh
node scripts/r2-production-rollout.mjs --rehearse-card-avatar .local-db/<sanitized-baseline-dir>
```

Pass an explicitly prepared, trusted `sanitized-snapshot.json` (existing runner snapshot format) from **after profile/contact** and **before card/avatar**. It must preserve the two profile/contact inventory records and matching catalog definitions, the application principal/ownership, and the existing card admission prerequisites. Table data must be synthetic or sanitized; do not supply a production dump or include credentials, tokens, or real customer data. The documented historical backup predates profile/contact and is not this baseline. No baseline is selected automatically. This command does not call the production client, load `.env` files or accept `--apply`.

The runner restores to disposable loopback native PostgreSQL, checks restored catalog and data, reconciles the exact old inventory before and after rehearsal, and runs only the pinned card/avatar migrations as the restored principal. All existing tables are compared as typed multisets; for `members` this comparison uses every pre-existing column. Separately, `members.avatar_version` must be `integer NOT NULL DEFAULT 0` and all pre-existing rows must have `0`. Old column definitions must match, new tables must be empty, and new relation/function ACLs must not expose objects to `PUBLIC`. Production selection is unchanged.

Validation: runner **7/7 passed**, including a synthetic native baseline, refusal on missing inventory rows, wrong checksum and schema drift before DDL, and preservation of old data with the new column. Existing native card/avatar SQL suites: **29/29 passed**, PostgreSQL 18.4. Running the offline command without a baseline returned `BLOCKED` (exit 1). No sanitized post-rollout baseline was supplied or verified in this round; these results are not a rehearsal against the actual post-rollout catalog, nor approval to apply.

### Follow-up: actual post-rollout catalog, without production application rows

Use `--capture-only` to write a single checksummed snapshot and manifest to protected, ignored `.local-db` using the existing read-only Repeatable Read capture. It does not generate a raw restore script or run migration SQL. Use `--rehearse-card-avatar-catalog <protected-capture-dir>` offline to check the checksum and project the snapshot in memory: all ordinary table rows are dropped except the two validated rollout inventory records. No sanitized snapshot file is exported. Catalog definitions and sequence state are retained in the disposable protected native cluster.

Verified on `.local-db/r2-capture-ORPEIJ`: 36 captured tables; SHA256 `85417368e7f4510c8eb00b05967fec6678949750e5ede00f43969d18e38a459c`. The native rehearsal matched 19 catalog sections and reconciled both existing inventory entries before and after running the pinned card/avatar migrations as the restored application principal. It compared all 36 existing tables in the projected baseline, verified `members.avatar_version` as `integer NOT NULL DEFAULT 0`, found 5 new empty tables, and passed the new-object PUBLIC ACL guard. The default-value check against existing production member rows was vacuous: no member rows were restored. This verifies catalog compatibility and inventory preservation, not production row fidelity, populated-table migration behavior, or production readiness. No production apply.

### Follow-up: authorized full-data rehearsal

```sh
pnpm exec node scripts/r2-production-rollout.mjs --rehearse-card-avatar-protected .local-db/r2-capture-ORPEIJ
```

This offline-only mode accepts only the named protected capture, with the pinned SHA256 above and a matching manifest. The directory and files were verified Git-ignored and ACL-restricted to the current account and SYSTEM. The disposable native cluster uses SCRAM on `127.0.0.1` and lives under `.local-db`. No rows or credentials are printed, and no restore script is exported.

**Verified:** 19 catalog sections, both profile/contact inventory entries, and typed row multisets for all 36 original tables against the capture, after restore, after explicit `ROLLBACK` of the complete card/avatar batch, and after replay with local `COMMIT`. Comparison retains duplicate multiplicity and uses all old `members` columns; `avatar_version` was separately verified as `integer NOT NULL DEFAULT 0` and `0` on every restored member. Rollback restored the catalog and left existing sequence states unchanged; the commit also preserved those states. Five new tables were empty and the new-object PUBLIC ACL check passed. Runner tests: **7 passed, 0 failed, 0 skipped**. This proves pre-commit transactional rollback on the captured baseline, not post-commit recovery or behavior under live traffic.

## 7. Authorized card/avatar apply attempt — BLOCKED before production DDL

`pnpm exec node scripts/r2-production-rollout.mjs --apply-card-avatar` selects only the two pinned card/avatar migrations. It does not change the legacy `--apply` selection or append to or replace the existing profile/contact inventory. The new mode requires the pinned protected rehearsal, live identity/catalog agreement, fresh native recovery, and an effective ACL check before submitting the migration transaction. The transaction is guarded by locked before/after catalog and typed data comparisons, sequence checks, the avatar default check, and empty-new-table checks. A read-only postflight is required after a confirmed commit.

- Protected rehearsal rerun: 36 old tables, 19 catalog sections, both inventory rows, rollback and local replay verified; 5 new empty tables and `avatar_version = 0` on existing members. Live read-only identity/catalog comparison found no drift.
- First attempt stopped because native recovery encoded the database ACL differently. Local diagnosis confirmed the database owner and expanded ACL rows matched exactly. The runner now compares those rather than the raw ACL encoding.
- Second attempt verified the fresh snapshot through native restore and replay: all 36 old tables, 19 catalog sections, existing sequence states and both inventory rows. Protected report: `.local-db/r2-card-avatar-apply-LS0wPM/report.json`.
- **Blocking ACL:** the restored production `neon_service` login had effective access to new tables/sequences directly and through reachable `pg_read_all_data`, `pg_write_all_data` and `neon_superuser` role contexts. No unexpected function execution or extra avatar-column rights were found by this check. PUBLIC revocation alone does not remove these rights. No managed-service exception was established, so the runner failed closed (exit 1; `commitOutcome: not-attempted`). No production migration transaction or postflight ran, no grants were changed, and no password/R3+ migration, git write, or external avatar-provider action occurred.
- Runner tests: **7 passed, 0 failed, 0 skipped**, including effective sequence access via a non-inherited `SET ROLE` path. Before a retry, verify the service-role trust policy or restrict the access; do not bypass the guard based on a role name alone.

## 8. Remaining scope / rollback

- Card/avatar: resolve the effective ACL blocker and rerun all gates against a fresh recovery point. Review cross-feature contention and coordinate schema-before-app deployment with feature enablement held until UAT.
- Card UAT: browser role flows and real USB CARD scans for expired/off-slot/valid paid memberships and supplements, using approved evidence rather than fabricated payment records. Avatar UAT: browser staff role/target flows and an authorized real provider upload; existing provider success evidence is stub-only.

- Password remains blocked until coordinated auth deployment/drain and its own race/secret/logging gates are evidenced. Do not enable staff reset merely because profile/contact DB migrations now exist.
- Profile/contact browser role/functional UAT and application deployment remain separate work. This is schema rollout/recovery verification, not completion of all R2 acceptance.
- No old migration/bootstrap, R3–R7 rerun, db:push, auth fixture, customer mutation, paid API, commit, push, deployment, TODO or current app/auth edit was performed.
- Roll back feature availability at the application layer first if needed. Retain profile/contact data, append-only audit, migration records and recovery artifacts. Do not drop audit, undo member values from snapshots, resurrect sessions or automatically restore this backup over production. Any destructive recovery/data correction needs separate approval.
