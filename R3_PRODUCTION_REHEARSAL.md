# R3 production rollout — schema applied, custom sales held

On 19 Nov 2026, the four R3 migrations committed together on production PostgreSQL 18.7. A separate read-only postflight passed. Do not rerun apply against this installation. No app deploy or feature enablement was performed.

## Exact pinned order

| Order | Migration | SHA-256 |
|---|---|---|
| 1 | `20261118_r3_package_catalog.sql` | `dab6b9996948f8d22718daadcb4a18eb1902500db750e306713d0ea511ae9395` |
| 2 | `20261118_r3_package_catalog_checkin.sql` | `d28adb069893222ffed042e835357b522fe6e87671a4e126169cc676afb3e2a2` |
| 3 | `20261119_r3_package_bonus_points.sql` | `f07bb7aec2490ebdb32885ee6df7dd894a9ebaa2916ae26ef3c3ef1d613e28a2` |
| 4 | `20261119_r3_member_time_override.sql` | `2285ca3137e5632cec52e4e1be90ffd2e154b2543ac8492a2b76627c5d8f62d5` |

Catalog requires the October catalog/order guard. Checkin requires catalog and the installed October checkin source anchors. Bonus requires catalog, the October payment/benefits code and the old points formula. Override requires catalog/checkin and checks installed checkin source hashes; it does not depend on bonus. No later migration ran.

## Executed gates and results

1. **Preflight and fresh backup:** configured production identity matched; no URL override, partial R3, enabled event trigger, later checkin stack, or unexpected prerequisite drift. Metadata discovery was repeated in the read-only Repeatable Read backup transaction, with `row_security=off` and sequence state bracket checks. Snapshot was written under a verified Windows ACL (current account and SYSTEM), then re-read and checksum verified. The historical R2 artifact was a catalog drift reference only; all rows and sequence states came from the fresh capture. Native data checks found neither reserved `bonusPoints` nor `r3HalfOpenTimeSlot` in historical snapshots, and exactly one validated legacy points formula.
2. **Native recovery and guards:** loopback/SCRAM PostgreSQL 18.4 restored and verified **43 tables, 21 sequences, 24 catalog sections**. Rehearsed full production pre/post guards on restored data with rollback. A separate local commit matched the expected catalog, preserved old row multisets and sequence states, left the override journal empty, and left every existing catalog bonus at zero. Native fixtures proved prior CARD/replay and PENDING replay, a legacy exact-close admission and `CLOSED` outside hours, the new snapshot marker and bonus formula, and override set/read/replay/clear. Existing ACLs were preserved; effective rights and grant options were checked across role contexts, with no PUBLIC grants on new objects. Native cluster stopped and temporary cluster files/logs were removed.
3. **Single production transaction:** verified migration pins again, then used a transaction advisory lock, `SHARE` locks on all existing public tables, a 5s lock timeout, 30s per-statement timeout and 90s transaction timeout. Before DDL, checked identity, normalized catalog/ACL fingerprints, old-row counts and SHA-256 and exact `last_value`/`is_called`. After DDL, checked the rehearsed catalog fingerprints, same row and sequence checks (excluding only the new bonus column from the old row projection), effective ACL, zero bonuses and empty journal. Sent no backup row payloads back to production. Exactly the four pinned migrations committed.
4. **Independent read-only postflight passed:** **43 old tables, 21 sequences, 24 compared catalog sections**, effective ACL, zero bonuses and empty journal matched the guarded expectations. Anonymous `/api/packages` returned **200**, legacy slots only, no nonzero bonus; it now exposes the zero-valued `bonusPoints` field. Existing price and slot values were verified unchanged by the row guards.

Tests run in this pass: Node syntax check and targeted runner/catalog/kiosk/frontdesk tests **24/24, no skips**. Protected evidence: `.local-db/r3-rehearsal-2CkF34/report.json`, `manifest.json` and `transaction-intent.json`. Never attach, print or publish the snapshot or metadata. No SQL/app edits, Git operations, paid provider calls, production fixture writes or R4+ migrations in this pass.

## Compatibility and enablement

The previously blocked pending SQL was revised before apply. Unmarked existing legacy PAID snapshots keep their exact 14:00/22:00 closing instant and `CLOSED` reason; no historical snapshots were backfilled. New orders are stamped at insert, and marked orders and explicit overrides use opening-inclusive/closing-exclusive windows. The welcome coupon gate is unchanged.

Keep custom-time sales and nonzero bonuses off until matching deployed storefront, quote, kiosk and frontdesk revisions and authenticated browser/station paths are verified. This rollout was schema-only; no production customer-card scan, browser/hardware UAT, or app deploy was performed. The earlier anonymous override 404 and anonymous GET checkin probes did not establish deployed app readiness. A native pre-commit rollback result is not an authorized production downgrade plan.

For pre-apply baselines the runner uses `--metadata` (no business rows), `--rehearse` (fresh protected capture and native rehearsal) or the explicit `--apply-r3-schema` mode (same gates, production transaction and independent read-only postflight). An unknown commit outcome must be reconciled read-only; never blindly retry. Do not run apply on this already migrated production database.
